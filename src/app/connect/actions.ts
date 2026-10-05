"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasAiConsent } from "@/lib/ai-consent";
import { getLmsConnection, readCredentials, runLmsSync, type NonCanvasProvider, type SchoologyCredentials } from "@/lib/lms/connections";
import { summarizeReport } from "@/lib/lms/report";
import { SchoologyClient } from "@/lib/lms/schoology";
import { schoologyMaterialsSource } from "@/lib/lms/schoology-materials";
import { advanceMaterialSync, queueCourseMaterialSync, type CourseSyncProgress } from "@/lib/materials-sync";

// Sync and disconnect for Schoology, Brightspace and Blackboard (Canvas has
// its own, in connect/canvas/actions.ts). Every export here is a public
// endpoint, so the provider argument is checked, never trusted.

function asProvider(value: unknown): NonCanvasProvider | null {
  return value === "schoology" || value === "brightspace" || value === "blackboard" ? value : null;
}

/** Everything a sync can change. */
function revalidateSyncedPages(provider: NonCanvasProvider) {
  revalidatePath(`/connect/${provider}`);
  revalidatePath("/connect");
  revalidatePath("/dashboard");
  revalidatePath("/assignments");
  revalidatePath("/classes");
  revalidatePath("/schedule");
}

export async function syncLmsAction(provider: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const p = asProvider(provider);
  if (!p) return { ok: false, message: "Unknown connection." };
  const report = await runLmsSync(user.id, p, user.timezone);
  revalidateSyncedPages(p);
  return { ok: !report.error, message: summarizeReport(report) };
}

/** Removes the connection and its stored key or links. Classes and assignments already synced stay. */
export async function disconnectLmsAction(provider: string): Promise<void> {
  const user = await requireUser();
  const p = asProvider(provider);
  if (!p) return;
  await prisma.lmsConnection.deleteMany({ where: { userId: user.id, provider: p } });
  // The navigation names the connected LMS, so every page changes.
  revalidatePath("/", "layout");
}

async function schoologySource(userId: string) {
  const connection = await getLmsConnection(userId, "schoology");
  if (!connection) return null;
  const credentials = readCredentials<SchoologyCredentials>(connection.credentialsEnc);
  return schoologyMaterialsSource(new SchoologyClient({ ...credentials, domain: connection.baseUrl }));
}

/** "Go fetch materials" for Schoology: the same engine as Canvas's (src/lib/materials-sync.ts). */
export async function startSchoologyMaterialSyncAction(): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!(await getLmsConnection(user.id, "schoology"))) return { error: "Schoology isn't connected." };
  await queueCourseMaterialSync(prisma, user.id, "schoology");
  revalidatePath("/connect/schoology");
  return {};
}

export async function continueSchoologyMaterialSyncAction(): Promise<CourseSyncProgress[]> {
  const user = await requireUser();
  const source = await schoologySource(user.id);
  if (!source) return [];
  const progress = await advanceMaterialSync(prisma, source, user.id, { readScansWithAi: hasAiConsent(user) });
  revalidatePath("/classes");
  return progress;
}
