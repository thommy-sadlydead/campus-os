"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { revokeGoogleToken } from "@/lib/google-oauth";
import { getValidAccessToken, listMessageIds, getMessage, type GmailMessageSummary } from "@/lib/gmail";
import { classifyEmail, type ClassificationResult, type ExtractedFact } from "@/lib/email-intelligence";
import { looksLikeNewsletter, SPECIFIC_CATEGORIES } from "@/lib/email-classify-heuristic";
import { proposeChange, resolvePendingChange, type EntityType } from "@/lib/pending-changes";

/** Best-effort match of an extracted fact's free-text hint to an existing record in the class. */
async function findEntityId(entityType: EntityType, classId: string, hint: string | null): Promise<string | null> {
  if (entityType === "Class") return classId;
  if (!hint) return null;

  const words = hint
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  if (entityType === "Exam") {
    const exams = await prisma.exam.findMany({ where: { classId } });
    const match = exams.find((e) => {
      const name = e.name.toLowerCase();
      return name.includes(hint.toLowerCase()) || words.some((w) => name.includes(w));
    });
    return match?.id ?? null;
  }
  if (entityType === "Assignment") {
    const assignments = await prisma.assignment.findMany({ where: { classId } });
    const match = assignments.find((a) => {
      const name = a.name.toLowerCase();
      return name.includes(hint.toLowerCase()) || words.some((w) => name.includes(w));
    });
    return match?.id ?? null;
  }
  if (entityType === "ScheduleEvent") {
    const first = await prisma.scheduleEvent.findFirst({ where: { classId } });
    return first?.id ?? null;
  }
  return null;
}

async function processFacts(userId: string, classId: string, sourceEmailId: string, sourceLabel: string, facts: ExtractedFact[]) {
  for (const fact of facts) {
    try {
      if (fact.isNewRecord) {
        await proposeChange({
          userId,
          classId,
          sourceEmailId,
          sourceLabel,
          entityType: fact.entityType,
          entityId: null,
          field: fact.field,
          newValueText: fact.newValue,
          newRecordName: fact.newRecordName,
        });
        continue;
      }
      const entityId = await findEntityId(fact.entityType, classId, fact.entityMatchHint);
      if (!entityId) continue; // couldn't confidently find what it's referring to — skip rather than guess
      await proposeChange({
        userId,
        classId,
        sourceEmailId,
        sourceLabel,
        entityType: fact.entityType,
        entityId,
        field: fact.field,
        newValueText: fact.newValue,
      });
    } catch {
      // One malformed fact shouldn't stop the rest of the sync.
      continue;
    }
  }
}

export interface SyncEmailResult {
  ok: boolean;
  message: string;
  /** Messages read and saved by this sync. */
  fetched?: number;
  /** New messages still waiting for a later sync (see MAX_NEW_PER_SYNC). */
  remaining?: number;
  relevant?: number;
  changesProposed?: number;
}

// Each sync looks at every inbox message from the last 60 days and reads
// the ones it hasn't saved yet, newest first, instead of only the newest 40
// (anything past those used to be missed for good). Reading and classifying
// a message takes a few seconds, so one sync reads at most
// MAX_NEW_PER_SYNC, several at a time, and stops starting new ones near the
// page's time limit (maxDuration in email/page.tsx). SyncButton runs it
// again while messages remain.
const SYNC_QUERY = "in:inbox newer_than:60d";
const MAX_LISTED = 2000;
const MAX_NEW_PER_SYNC = 60;
const READ_CONCURRENCY = 4;
const SYNC_TIME_BUDGET_MS = 200_000;

export async function syncEmailAction(): Promise<SyncEmailResult> {
  const user = await requireUser();
  const account = await prisma.emailAccount.findUnique({ where: { userId: user.id } });
  if (!account) return { ok: false, message: "No Gmail account connected." };

  // Non-school email saved before the sync stopped keeping its text (see
  // the create below) still has it; clear it, as the privacy page promises.
  // Only rows that still have text match, so after the first sync this is
  // a no-op.
  await prisma.email.updateMany({
    where: { userId: user.id, category: "IRRELEVANT", OR: [{ bodyText: { not: null } }, { snippet: { not: null } }] },
    data: { bodyText: null, snippet: null },
  });

  // Newsletters an earlier version filed as an exam, assignment or class
  // change (see looksLikeNewsletter) become announcements, without the
  // class tag a word in passing gave them. After one sync this finds none.
  const labeled = await prisma.email.findMany({
    where: { userId: user.id, category: { in: [...SPECIFIC_CATEGORIES] } },
    select: { id: true, subject: true, fromName: true },
  });
  const newsletterIds = labeled
    .filter((e) => looksLikeNewsletter({ subject: e.subject, fromName: e.fromName, snippet: "", bodyText: "" }, null))
    .map((e) => e.id);
  if (newsletterIds.length > 0) {
    await prisma.email.updateMany({ where: { id: { in: newsletterIds } }, data: { category: "ANNOUNCEMENT", classId: null } });
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(user.id);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't access Gmail." };
  }

  const classes = await prisma.class.findMany({ where: { userId: user.id, archived: false } });

  let ids: string[];
  try {
    ids = await listMessageIds(accessToken, SYNC_QUERY, MAX_LISTED);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't list Gmail messages." };
  }

  const already = await prisma.email.findMany({
    where: { userId: user.id, gmailMessageId: { in: ids } },
    select: { gmailMessageId: true },
  });
  const alreadySet = new Set(already.map((e) => e.gmailMessageId));
  const newIds = ids.filter((id) => !alreadySet.has(id));

  let relevantCount = 0;
  let changesProposed = 0;
  let saved = 0;
  let attempted = 0;
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS;
  const toRead = newIds.slice(0, MAX_NEW_PER_SYNC);

  // Read and classify a few at a time; save one at a time, so two emails
  // proposing the same change can't race each other in processFacts.
  while (attempted < toRead.length && Date.now() < deadline) {
    const chunk = toRead.slice(attempted, attempted + READ_CONCURRENCY);
    attempted += chunk.length;
    const read = await Promise.all(
      chunk.map(async (id): Promise<{ msg: GmailMessageSummary; result: ClassificationResult } | null> => {
        try {
          const msg = await getMessage(accessToken, id);
          return { msg, result: await classifyEmail(msg, classes) };
        } catch {
          return null; // not saved, so the next sync tries it again
        }
      })
    );

    for (const item of read) {
      if (!item) continue;
      const { msg, result } = item;
      const email = await prisma.email.create({
        data: {
          userId: user.id,
          classId: result.classId,
          gmailMessageId: msg.id,
          fromAddress: msg.fromAddress,
          fromName: msg.fromName,
          subject: msg.subject,
          // Only school-related mail keeps its preview and full text. Anything
          // else keeps just its sender, subject and date (enough to skip it on
          // the next sync), so the contents of personal email aren't stored.
          snippet: result.relevant ? result.summary || msg.snippet : null,
          bodyText: result.relevant ? msg.bodyText : null,
          receivedAt: msg.receivedAt,
          category: result.relevant ? result.category : "IRRELEVANT",
          extractedJson: JSON.stringify({ facts: result.facts, confidence: result.confidence, usedAi: result.usedAi }),
          confidence: result.confidence,
        },
      });
      saved += 1;

      if (result.relevant) relevantCount += 1;

      // Only apply facts when we're reasonably confident AND we know which
      // class this is about — an unattributed or low-confidence fact isn't
      // acted on, just left visible in the feed for the student to read.
      if (result.relevant && result.classId && result.confidence >= 0.55 && result.facts.length > 0) {
        const sourceLabel = `an email from ${msg.fromName || msg.fromAddress}`;
        const before = await prisma.pendingChange.count({ where: { sourceEmailId: email.id } });
        await processFacts(user.id, result.classId, email.id, sourceLabel, result.facts);
        const after = await prisma.pendingChange.count({ where: { sourceEmailId: email.id } });
        changesProposed += after - before;
      }
    }
  }

  await prisma.emailAccount.update({ where: { userId: user.id }, data: { lastSyncedAt: new Date() } });

  revalidatePath("/email");
  revalidatePath("/dashboard");
  revalidatePath("/classes");
  revalidatePath("/schedule");

  const remaining = newIds.length - saved;
  let message: string;
  if (newIds.length === 0) message = "Already up to date.";
  else if (saved === 0) message = `Couldn't read ${remaining} new message(s) from Gmail. Try again in a minute.`;
  else if (remaining > 0) message = `Synced ${saved} new message(s), ${remaining} more to go. Sync again to continue.`;
  else message = `Synced ${saved} new message(s).`;

  return { ok: true, message, fetched: saved, remaining, relevant: relevantCount, changesProposed };
}

export async function disconnectEmailAction(): Promise<void> {
  const user = await requireUser();
  const account = await prisma.emailAccount.findUnique({ where: { userId: user.id } });
  if (account) {
    // Revoke at Google too, so Campus OS no longer shows up as having access
    // in the user's Google account. Best effort: the local token is deleted
    // either way.
    try {
      await revokeGoogleToken(decryptSecret(account.refreshTokenEnc));
    } catch (err) {
      console.error("Gmail revoke on disconnect failed:", err);
    }
  }
  await prisma.emailAccount.delete({ where: { userId: user.id } }).catch(() => {});
  revalidatePath("/email");
}

export async function resolvePendingChangeAction(id: string, decision: "accept" | "reject"): Promise<void> {
  const user = await requireUser();
  await resolvePendingChange(id, user.id, decision);
  revalidatePath("/email");
  revalidatePath("/dashboard");
  revalidatePath("/classes");
  revalidatePath("/schedule");
}
