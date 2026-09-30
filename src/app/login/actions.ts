"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { loginSchema, registerSchema } from "@/lib/account-forms";
import { inviteCodeMatches, isSignupOpen } from "@/lib/signup";
import {
  RATE_LIMITS,
  clearRateLimit,
  clientIp,
  consumeRateLimit,
  isRateLimited,
  recordRateLimitEvent,
} from "@/lib/rate-limit";

// `email` is echoed back so the form can keep it filled in: React 19 resets
// a form after its action runs, including when the action returns an error.
export type AuthActionState = { error?: string; email?: string } | undefined;

const TOO_MANY_LOGINS = "Too many failed attempts. Wait 15 minutes and try again.";

export async function loginAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = loginSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) {
    return { error: "Enter a valid email and password.", email };
  }

  const emailKey = `login-email:${parsed.data.email.toLowerCase()}`;
  const ipKey = `login-ip:${await clientIp()}`;
  if ((await isRateLimited(emailKey, RATE_LIMITS.loginEmail)) || (await isRateLimited(ipKey, RATE_LIMITS.loginIp))) {
    return { error: TOO_MANY_LOGINS, email };
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await Promise.all([recordRateLimitEvent(emailKey), recordRateLimitEvent(ipKey)]);
    return { error: "Incorrect email or password.", email };
  }

  await clearRateLimit(emailKey);
  await createSession(user.id);
  redirect("/dashboard");
}

export async function registerAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!isSignupOpen()) {
    return { error: "Sign-ups are closed right now.", email };
  }

  if (!(await consumeRateLimit(`register-ip:${await clientIp()}`, RATE_LIMITS.register))) {
    return { error: "Too many sign-up attempts. Try again in an hour.", email };
  }

  const parsed = registerSchema.safeParse({
    email,
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    inviteCode: formData.get("inviteCode"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", email };
  }

  // Checked before looking the email up, so someone without a valid code
  // can't use this form to find out which addresses already have accounts.
  if (!inviteCodeMatches(parsed.data.inviteCode)) {
    return { error: "That invite code isn't right.", email };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { error: "An account with that email already exists.", email };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: { email: parsed.data.email, passwordHash },
  });

  await createSession(user.id);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
