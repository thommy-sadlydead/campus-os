"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rate-limit";
import { createPairingCode, revokeExtensionTokens } from "@/lib/lms/extension-auth";
import { importSummary } from "@/lib/lms/extension-import";
import { EXTENSION_PROVIDERS, type ExtensionProvider } from "@/lib/lms/extension-protocol";
import { parseReport } from "@/lib/lms/report";

// The Connect pages' side of the Chrome extension (Brightspace, Blackboard).

const isExtensionProvider = (p: unknown): p is ExtensionProvider =>
  typeof p === "string" && (EXTENSION_PROVIDERS as readonly string[]).includes(p);

/** A one-time code the page hands the extension (through its bridge script) to pair with this account. */
export async function createExtensionPairingAction(): Promise<{ code?: string; error?: string }> {
  const user = await requireUser();
  if (!(await consumeRateLimit(`extension-pair-user:${user.id}`, RATE_LIMITS.extensionPair))) {
    return { error: "Too many tries. Wait a few minutes and try again." };
  }
  return { code: await createPairingCode(user.id) };
}

export interface ExtensionProgress {
  lastSyncedAt: string | null;
  error: string | null;
  courses: Awaited<ReturnType<typeof importSummary>>;
}

/** What's in Campus OS from this LMS so far, course by course, for the Connect page while a sync runs. */
export async function extensionProgressAction(provider: string): Promise<ExtensionProgress | null> {
  const user = await requireUser();
  if (!isExtensionProvider(provider)) return null;
  const connection = await prisma.lmsConnection.findUnique({ where: { userId_provider: { userId: user.id, provider } } });
  if (!connection || connection.method !== "extension") return null;
  return {
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    error: parseReport(connection.lastSyncReport)?.error ?? null,
    courses: await importSummary(user.id, provider),
  };
}

/**
 * Stops syncing this LMS. Classes and what came in stay, like any other
 * disconnect. The extension's token is revoked once no LMS uses it.
 */
export async function disconnectExtensionAction(provider: string): Promise<void> {
  const user = await requireUser();
  if (!isExtensionProvider(provider)) return;
  await prisma.lmsConnection.deleteMany({ where: { userId: user.id, provider } });
  const others = await prisma.lmsConnection.count({ where: { userId: user.id, method: "extension" } });
  if (others === 0) await revokeExtensionTokens(user.id);
  revalidatePath("/", "layout");
}
