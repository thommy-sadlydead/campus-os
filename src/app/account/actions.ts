"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { destroyOtherSessions, destroySession, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { revokeAllGrants, revokeApp } from "@/lib/oauth/oauth-server";
import { changePasswordSchema, DELETE_CONFIRMATION_WORD } from "@/lib/account-forms";
import { deleteUserAndData } from "@/lib/account-deletion";
import { RATE_LIMITS, clearRateLimit, consumeRateLimit, isRateLimited, recordRateLimitEvent } from "@/lib/rate-limit";
import { freeAccessCodeMatches, isAppRequest, paymentsEnabled } from "@/lib/billing-server";
import { normalizeFeatures } from "@/lib/features";
import { availableFeatures, featuresFor } from "@/lib/features-server";

export type AccountActionState = { error?: string; success?: string } | undefined;

const TOO_MANY_ATTEMPTS = "Too many wrong passwords. Wait 15 minutes and try again.";

// Both actions below re-check the current password, and a wrong one counts
// toward the same limit as a failed login, so a hijacked session can't be
// used to guess the password here instead.
async function checkCurrentPassword(
  user: { email: string; passwordHash: string },
  attempt: string
): Promise<AccountActionState> {
  const key = `login-email:${user.email.toLowerCase()}`;
  if (await isRateLimited(key, RATE_LIMITS.loginEmail)) return { error: TOO_MANY_ATTEMPTS };
  if (!(await verifyPassword(attempt, user.passwordHash))) {
    await recordRateLimitEvent(key);
    return { error: "That password isn't right." };
  }
  await clearRateLimit(key);
  return undefined;
}

export async function changePasswordAction(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const user = await requireUser({ allowWithoutAccess: true });
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const failure = await checkCurrentPassword(user, parsed.data.currentPassword);
  if (failure) return failure;

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });
  await destroyOtherSessions(user.id);
  await revokeAllGrants(user.id);
  return { success: "Password changed. Any other devices and connected apps were signed out." };
}

export async function deleteAccountAction(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const user = await requireUser({ allowWithoutAccess: true });
  if (String(formData.get("confirmation") ?? "").trim() !== DELETE_CONFIRMATION_WORD) {
    return { error: `Type ${DELETE_CONFIRMATION_WORD} to confirm.` };
  }

  const failure = await checkCurrentPassword(user, String(formData.get("password") ?? ""));
  if (failure) return failure;

  try {
    await deleteUserAndData(user.id);
  } catch (err) {
    console.error("Account deletion failed:", err);
    return { error: "Something went wrong and your account wasn't deleted. Please try again." };
  }

  await destroySession();
  redirect("/login?deleted=1");
}

/** Allows or turns off AI features (User.aiConsentAt; see src/lib/ai-consent.ts). */
export async function setAiConsentAction(allow: boolean): Promise<void> {
  const user = await requireUser({ allowWithoutAccess: true });
  await prisma.user.update({ where: { id: user.id }, data: { aiConsentAt: allow ? new Date() : null } });
  revalidatePath("/", "layout");
}

/**
 * Website only: FREE_ACCESS_CODE (Reece hands it to friends) makes the
 * account free for good. Apple doesn't allow unlocking features with a code
 * inside the iPhone app, so the app never shows this; an account unlocked
 * here is unlocked in the app too.
 */
export async function redeemFreeAccessCodeAction(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const user = await requireUser({ allowWithoutAccess: true });
  if (!paymentsEnabled()) return { error: "Codes aren't needed right now." };
  if (await isAppRequest()) return { error: "Enter codes on the Campus OS website." };
  if (!(await consumeRateLimit(`free-code:${user.id}`, RATE_LIMITS.freeAccessCode))) {
    return { error: "Too many tries. Wait an hour and try again." };
  }
  if (!freeAccessCodeMatches(String(formData.get("code") ?? ""))) return { error: "That code isn't right." };

  await prisma.user.update({ where: { id: user.id }, data: { freeAccessAt: new Date() } });
  revalidatePath("/", "layout");
  return { success: "Code accepted. Campus OS is free on this account." };
}

/** Account → Connected apps: stops an app (ChatGPT) from reading the account. */
export async function disconnectAppAction(formData: FormData): Promise<void> {
  const user = await requireUser({ allowWithoutAccess: true });
  await revokeApp(user.id, String(formData.get("clientId") ?? ""));
  revalidatePath("/account");
}

export type FeaturesActionResult = { error?: string } | undefined;

/** Saves the features picked at sign-up (/welcome) or under Account → Features. */
export async function saveFeaturesAction(features: unknown): Promise<FeaturesActionResult> {
  const user = await requireUser({ allowWithoutAccess: true });
  if (!Array.isArray(features) || features.length > 50) return { error: "Pick the features you want and try again." };
  const list = normalizeFeatures(features, await availableFeatures(user));
  await prisma.user.update({ where: { id: user.id }, data: { features: list, featuresChosenAt: new Date() } });
  revalidatePath("/", "layout");
  return undefined;
}

/** For an account from before the picker: keeps what it has, and stops asking. */
export async function keepCurrentFeaturesAction(): Promise<void> {
  const user = await requireUser({ allowWithoutAccess: true });
  if (user.featuresChosenAt) return;
  await prisma.user.update({ where: { id: user.id }, data: { features: [...(await featuresFor(user))], featuresChosenAt: new Date() } });
  revalidatePath("/", "layout");
}
