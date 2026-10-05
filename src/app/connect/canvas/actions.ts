"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { describeCanvasConnectError, describeCanvasSyncError, fetchActiveCourses, type CanvasConfig } from "@/lib/canvas";
import { syncCanvasForUser } from "@/lib/canvas-sync";
import { canvasMaterialsSource } from "@/lib/canvas-materials-sync";
import { advanceMaterialSync, queueCourseMaterialSync, type CourseSyncProgress } from "@/lib/materials-sync";
import { failedReport, summarizeReport, type SyncReport } from "@/lib/lms/report";
import { hasAiConsent } from "@/lib/ai-consent";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertPublicHost, SafeFetchError } from "@/lib/lms/safe-fetch";

export type { CourseSyncProgress };

function revalidateSyncedPages() {
  revalidatePath("/connect/canvas");
  revalidatePath("/connect");
  revalidatePath("/dashboard");
  revalidatePath("/assignments");
  revalidatePath("/classes");
  revalidatePath("/schedule");
}

// `baseUrl` is echoed back so the form keeps it after an error: React 19
// resets a form once its action finishes, even when the action fails.
export type ConnectCanvasState = { error?: string; baseUrl?: string } | undefined;

export async function connectCanvasAction(
  _prev: ConnectCanvasState,
  formData: FormData
): Promise<ConnectCanvasState> {
  const user = await requireUser();

  const typed = String(formData.get("baseUrl") ?? "").trim();
  const token = String(formData.get("accessToken") ?? "").trim();

  // Just the school's address: "school.instructure.com/courses" becomes
  // "https://school.instructure.com".
  let baseUrl: string;
  try {
    const url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`);
    if (!typed || !url.hostname.includes(".")) throw new Error("no host");
    baseUrl = url.origin;
  } catch {
    return { error: "Enter your school's Canvas address, like yourschool.instructure.com.", baseUrl: typed };
  }
  if (!token) {
    return { error: "Paste the access token you generated in Canvas.", baseUrl };
  }
  if (!(await consumeRateLimit(`lms-connect:${user.id}`, RATE_LIMITS.lmsConnect))) {
    return { error: "That's a lot of tries in a short time. Wait a bit and try again.", baseUrl };
  }
  // The server calls this address from now on, so it has to be a public one.
  try {
    await assertPublicHost(baseUrl);
  } catch (err) {
    return { error: err instanceof SafeFetchError ? err.message : "Couldn't check that address.", baseUrl };
  }

  const cfg: CanvasConfig = { baseUrl, token };

  // Verify the token actually works before saving anything — a typo'd URL
  // or an expired/revoked token should fail right here with a clear
  // message, not get saved and only fail later on the first "Sync now".
  try {
    await fetchActiveCourses(cfg);
  } catch (err) {
    console.error("Canvas connect check failed:", err);
    return { error: describeCanvasConnectError(err), baseUrl };
  }

  await prisma.canvasAccount.upsert({
    where: { userId: user.id },
    update: { baseUrl, accessTokenEnc: encryptSecret(token) },
    create: { userId: user.id, baseUrl, accessTokenEnc: encryptSecret(token) },
  });

  // Kick off the first sync immediately so "Connect" already leaves real
  // data behind, rather than requiring a separate "Sync now" click right
  // after connecting. The connection itself is already saved and verified
  // above, so a failure here doesn't undo it: its report says what went
  // wrong on the Canvas page, and "Sync now" retries.
  const report = await runCanvasSync(user.id, cfg);
  if (!report.error) {
    // Classes now exist — queue each one for a materials sync (books,
    // slides, syllabi). This only creates PENDING tracking rows; it does
    // NOT itself do any discovery or downloading, so it returns
    // immediately and doesn't block the connect request. The client starts
    // polling continueCanvasMaterialSyncAction right after connect
    // succeeds (see MaterialSyncPanel) to actually advance it.
    await queueCourseMaterialSync(prisma, user.id, "canvas").catch((err) =>
      console.error("Canvas materials couldn't be queued:", err)
    );
  }

  // The navigation names the connected LMS, so every page changes.
  revalidatePath("/", "layout");
  return undefined;
}

/**
 * Syncs and saves what the sync found on the account, for the Canvas
 * page. Never throws: a failed sync is a report with an error, and the
 * last good sync time stays.
 */
async function runCanvasSync(userId: string, cfg: CanvasConfig): Promise<SyncReport> {
  let report: SyncReport;
  try {
    report = await syncCanvasForUser(prisma, userId, cfg);
  } catch (err) {
    console.error(`Canvas sync failed for user ${userId}:`, err);
    report = failedReport("canvas", new Date(), describeCanvasSyncError(err));
  }
  await prisma.canvasAccount.update({
    where: { userId },
    data: { lastSyncReport: JSON.stringify(report), ...(report.error ? {} : { lastSyncedAt: new Date() }) },
  });
  return report;
}

export interface SyncCanvasResult {
  ok: boolean;
  message: string;
}

export async function syncCanvasAction(): Promise<SyncCanvasResult> {
  const user = await requireUser();
  const account = await prisma.canvasAccount.findUnique({ where: { userId: user.id } });
  if (!account) return { ok: false, message: "No Canvas account connected." };

  const cfg: CanvasConfig = { baseUrl: account.baseUrl, token: decryptSecret(account.accessTokenEnc) };
  const report = await runCanvasSync(user.id, cfg);
  revalidateSyncedPages();
  return { ok: !report.error, message: summarizeReport(report) };
}

/**
 * The manual "go fetch" button — (re)queues every Canvas-linked class for a
 * materials scan. Uses the exact same queueCourseMaterialSync as the
 * automatic post-connect kickoff (see connectCanvasAction above), so a
 * re-run is genuinely the same engine as the first run, just triggered by
 * hand: any course already mid-sync is left alone, and any course in a
 * terminal state is reset to PENDING to pick up anything new or changed
 * since the last sync.
 */
export async function startCanvasMaterialSyncAction(): Promise<{ error?: string }> {
  const user = await requireUser();
  const account = await prisma.canvasAccount.findUnique({ where: { userId: user.id } });
  if (!account) return { error: "No Canvas account connected." };

  await queueCourseMaterialSync(prisma, user.id, "canvas");
  revalidatePath("/connect/canvas");
  return {};
}

/**
 * Advances the materials sync by one bounded chunk and returns fresh
 * per-course progress — polled on an interval by MaterialSyncPanel until
 * every course reaches a terminal status. See advanceCanvasMaterialSync
 * for why this is safe to call repeatedly and cheap per call regardless of
 * how much total work remains.
 */
export async function continueCanvasMaterialSyncAction(): Promise<CourseSyncProgress[]> {
  const user = await requireUser();
  const account = await prisma.canvasAccount.findUnique({ where: { userId: user.id } });
  if (!account) return [];

  const cfg: CanvasConfig = { baseUrl: account.baseUrl, token: decryptSecret(account.accessTokenEnc) };
  const progress = await advanceMaterialSync(prisma, canvasMaterialsSource(cfg), user.id, {
    readScansWithAi: hasAiConsent(user),
  });
  // So a class page opened after (or during) a sync shows newly-imported
  // materials right away instead of a stale cached render.
  revalidatePath("/classes");
  return progress;
}

export async function disconnectCanvasAction(): Promise<void> {
  const user = await requireUser();
  await prisma.canvasAccount.delete({ where: { userId: user.id } }).catch(() => {});
  revalidatePath("/", "layout");
}
