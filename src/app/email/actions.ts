"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, listRecentMessageIds, getMessage } from "@/lib/gmail";
import { classifyEmail, type ExtractedFact } from "@/lib/email-intelligence";
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
  fetched?: number;
  relevant?: number;
  changesProposed?: number;
}

export async function syncEmailAction(): Promise<SyncEmailResult> {
  const user = await requireUser();
  const account = await prisma.emailAccount.findUnique({ where: { userId: user.id } });
  if (!account) return { ok: false, message: "No Gmail account connected." };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(user.id);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't access Gmail." };
  }

  const classes = await prisma.class.findMany({ where: { userId: user.id, archived: false } });

  let ids: string[];
  try {
    ids = await listRecentMessageIds(accessToken, "in:inbox newer_than:60d", 40);
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

  for (const id of newIds) {
    let msg;
    try {
      msg = await getMessage(accessToken, id);
    } catch {
      continue;
    }

    const result = await classifyEmail(msg, classes);
    const email = await prisma.email.create({
      data: {
        userId: user.id,
        classId: result.classId,
        gmailMessageId: msg.id,
        fromAddress: msg.fromAddress,
        fromName: msg.fromName,
        subject: msg.subject,
        snippet: result.summary || msg.snippet,
        bodyText: msg.bodyText,
        receivedAt: msg.receivedAt,
        category: result.relevant ? result.category : "IRRELEVANT",
        extractedJson: JSON.stringify({ facts: result.facts, confidence: result.confidence, usedAi: result.usedAi }),
        confidence: result.confidence,
      },
    });

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

  await prisma.emailAccount.update({ where: { userId: user.id }, data: { lastSyncedAt: new Date() } });

  revalidatePath("/email");
  revalidatePath("/dashboard");
  revalidatePath("/classes");
  revalidatePath("/schedule");

  return {
    ok: true,
    message: newIds.length === 0 ? "Already up to date." : `Synced ${newIds.length} new message(s).`,
    fetched: newIds.length,
    relevant: relevantCount,
    changesProposed,
  };
}

export async function disconnectEmailAction(): Promise<void> {
  const user = await requireUser();
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
