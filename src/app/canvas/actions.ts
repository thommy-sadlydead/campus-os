"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { fetchActiveCourses, type CanvasConfig } from "@/lib/canvas";
import { syncCanvasForUser } from "@/lib/canvas-sync";

function revalidateSyncedPages() {
  revalidatePath("/canvas");
  revalidatePath("/dashboard");
  revalidatePath("/assignments");
  revalidatePath("/classes");
  revalidatePath("/schedule");
}

export type ConnectCanvasState = { error?: string } | undefined;

export async function connectCanvasAction(
  _prev: ConnectCanvasState,
  formData: FormData
): Promise<ConnectCanvasState> {
  const user = await requireUser();

  const baseUrl = String(formData.get("baseUrl") ?? "").trim().replace(/\/$/, "");
  const token = String(formData.get("accessToken") ?? "").trim();

  if (!baseUrl || !/^https?:\/\/.+/.test(baseUrl)) {
    return { error: "Enter your school's full Canvas URL, e.g. https://cedarville.instructure.com" };
  }
  if (!token) {
    return { error: "Paste the access token you generated in Canvas." };
  }

  const cfg: CanvasConfig = { baseUrl, token };

  // Verify the token actually works before saving anything — a typo'd URL
  // or an expired/revoked token should fail right here with a clear
  // message, not get saved and only fail later on the first "Sync now".
  try {
    await fetchActiveCourses(cfg);
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Couldn't connect to Canvas: ${err.message}`
          : "Couldn't connect to Canvas — double check the URL and token.",
    };
  }

  await prisma.canvasAccount.upsert({
    where: { userId: user.id },
    update: { baseUrl, accessTokenEnc: encryptSecret(token) },
    create: { userId: user.id, baseUrl, accessTokenEnc: encryptSecret(token) },
  });

  // Kick off the first sync immediately so "Connect" already leaves real
  // data behind, rather than requiring a separate "Sync now" click right
  // after connecting. The connection itself is already saved and verified
  // above, so a failure here doesn't undo it — it just means the first
  // sync needs a retry from the Canvas page.
  try {
    await syncCanvasForUser(prisma, user.id, cfg);
    await prisma.canvasAccount.update({ where: { userId: user.id }, data: { lastSyncedAt: new Date() } });
  } catch {
    // Surfaced on the Canvas page via "Never synced yet" — not a reason to
    // fail the connect step, since the credential itself is good.
  }

  revalidateSyncedPages();
  return undefined;
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

  let result;
  try {
    result = await syncCanvasForUser(prisma, user.id, cfg);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Sync failed." };
  }

  await prisma.canvasAccount.update({ where: { userId: user.id }, data: { lastSyncedAt: new Date() } });

  revalidateSyncedPages();

  return {
    ok: true,
    message: `Synced ${result.assignmentsSynced} assignment(s) across ${result.courses} course(s).`,
  };
}

export async function disconnectCanvasAction(): Promise<void> {
  const user = await requireUser();
  await prisma.canvasAccount.delete({ where: { userId: user.id } }).catch(() => {});
  revalidatePath("/canvas");
}
