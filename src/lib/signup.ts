import "server-only";
import crypto from "node:crypto";
import { paymentsEnabled } from "@/lib/billing-server";

// With payments on (PAYMENTS_ENABLED=1), anyone can sign up and starts a
// free trial. Before that, sign-up is invite-only: a new account needs
// SIGNUP_INVITE_CODE, which Reece hands out to the people he invites, and
// with the variable unset, sign-up is closed entirely. Existing accounts
// can always log in.

export function isSignupOpen(): boolean {
  return paymentsEnabled() || Boolean(process.env.SIGNUP_INVITE_CODE?.trim());
}

export function inviteCodeRequired(): boolean {
  return !paymentsEnabled();
}

/**
 * Compares SHA-256 digests with timingSafeEqual so the comparison takes the
 * same time however much of a guess matches (and works for guesses of any
 * length, which timingSafeEqual on raw strings wouldn't).
 */
export function inviteCodeMatches(attempt: string): boolean {
  const expected = process.env.SIGNUP_INVITE_CODE?.trim();
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(attempt.trim()).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
