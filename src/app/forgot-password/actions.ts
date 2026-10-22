"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSession, destroyAllSessions, hashPassword, hashToken } from "@/lib/auth";
import { forgotPasswordSchema, resetPasswordSchema } from "@/lib/account-forms";
import { RATE_LIMITS, clearRateLimit, clientIp, consumeRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email-send";
import { resetLinkOrigin } from "@/lib/password-reset-server";
import {
  RESET_LINK_INVALID_MESSAGE,
  RESET_SENT_MESSAGE,
  resetEmail,
  resetLinkExpiry,
  resetLinkUrl,
} from "@/lib/password-reset";

// Both actions are public on purpose (no sign-in): they're for people who
// can't sign in. Neither one says whether an email has an account.

export type ForgotPasswordState = { error?: string; sent?: string; email?: string } | undefined;
export type ResetPasswordState = { error?: string } | undefined;

const TOO_MANY = "Too many reset requests. Wait an hour and try again.";

export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a valid email address.", email };

  const origin = await resetLinkOrigin();
  if (!origin) return { error: "Password reset by email isn't available right now. Contact support.", email };

  const ipOk = await consumeRateLimit(`password-reset-ip:${await clientIp()}`, RATE_LIMITS.passwordResetIp);
  const emailOk = ipOk && (await consumeRateLimit(`password-reset-email:${email.toLowerCase()}`, RATE_LIMITS.passwordResetEmail));
  if (!ipOk || !emailOk) return { error: TOO_MANY, email };

  // Accounts keep the email as typed at sign-up, so match it in any case.
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    // One live link at a time: asking again replaces any earlier link.
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: resetLinkExpiry(now) },
    });
    const sent = await sendEmail({ to: user.email, ...resetEmail(user.email, resetLinkUrl(origin, token)) });
    if (!sent) return { error: "We couldn't send the email just now. Try again in a few minutes.", email };
  }
  return { sent: RESET_SENT_MESSAGE, email };
}

export async function resetPasswordAction(
  token: string,
  _prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const parsed = resetPasswordSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };

  // Claimed with a conditional update, so a link can only ever be used once,
  // even by two requests at the same moment.
  const now = new Date();
  const tokenHash = hashToken(token);
  const claimed = await prisma.passwordResetToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return { error: RESET_LINK_INVALID_MESSAGE };

  const link = await prisma.passwordResetToken.findUniqueOrThrow({
    where: { tokenHash },
    select: { userId: true, user: { select: { email: true } } },
  });
  await prisma.user.update({
    where: { id: link.userId },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });
  await prisma.passwordResetToken.deleteMany({ where: { userId: link.userId, usedAt: null } });
  await destroyAllSessions(link.userId);
  await clearRateLimit(`login-email:${link.user.email.toLowerCase()}`);
  await createSession(link.userId);
  redirect("/dashboard");
}
