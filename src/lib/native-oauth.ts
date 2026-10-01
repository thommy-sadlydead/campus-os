import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { GoogleTokenResponse } from "@/lib/google-oauth";

// "Connect Gmail" from the iPhone app. Google refuses to sign in inside an
// app's own web view, so the app opens the handshake in the system's
// sign-in sheet (ASWebAuthenticationSession), which doesn't share the app's
// login cookie. Three pieces carry the student across:
//
// 1. A handoff token (signed, five minutes) made for the logged-in student
//    and passed in the start URL, so /start knows who's connecting without
//    a session.
// 2. The same token in a cookie through Google's redirect, so /callback
//    knows too.
// 3. /callback doesn't save the Gmail tokens. It encrypts them, with the
//    student's id, into the campusos:// URL that closes the sheet, and the
//    app posts that back from its own logged-in session (/native-finish),
//    which saves them only if it's the same student. That's what stops
//    someone from sending a victim their own handoff link and collecting
//    the victim's Gmail on the attacker's account: the victim's browser
//    could finish the Google part, but never the last step.

export const NATIVE_OAUTH_COOKIE = "campusos_oauth_native";
export const NATIVE_CALLBACK_URL = "campusos://email-connected";

const HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;
/** Google's sign-in can take a while (two-step verification). */
export const NATIVE_FLOW_MAX_AGE_MS = 15 * 60 * 1000;
const RESULT_MAX_AGE_MS = 5 * 60 * 1000;

function handoffKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return crypto.createHmac("sha256", secret).update("gmail-native-handoff").digest();
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", handoffKey()).update(payload).digest("base64url");
}

export function createGmailHandoff(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: now })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The student a handoff token was made for, or null if it's forged or older than `maxAgeMs`. */
export function readGmailHandoff(token: string, maxAgeMs = HANDOFF_MAX_AGE_MS, now = Date.now()): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const { u, t } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; t?: unknown };
    if (typeof u !== "string" || typeof t !== "number") return null;
    if (now - t > maxAgeMs || t - now > 60_000) return null;
    return u;
  } catch {
    return null;
  }
}

export interface NativeGmailResult {
  userId: string;
  emailAddress: string;
  tokens: Pick<GoogleTokenResponse, "access_token" | "refresh_token" | "expires_in" | "scope">;
}

export function sealGmailResult(result: NativeGmailResult, now = Date.now()): string {
  return encryptSecret(JSON.stringify({ ...result, t: now }));
}

/** The sealed result if it's genuine, under five minutes old and for `userId`; otherwise null. */
export function openGmailResult(sealed: string, userId: string, now = Date.now()): NativeGmailResult | null {
  try {
    const { t, ...result } = JSON.parse(decryptSecret(sealed)) as NativeGmailResult & { t: number };
    if (typeof t !== "number" || now - t > RESULT_MAX_AGE_MS || t - now > 60_000) return null;
    if (result.userId !== userId) return null;
    if (!result.tokens?.access_token || !result.tokens.refresh_token || !result.emailAddress) return null;
    return result;
  } catch {
    return null;
  }
}

/** Where the sign-in sheet ends: closes it and hands the result (or a message) to the app. */
export function nativeCallbackUrl(params: { result?: string; error?: string }): string {
  const url = new URL(NATIVE_CALLBACK_URL);
  if (params.result) url.searchParams.set("result", params.result);
  if (params.error) url.searchParams.set("error", params.error);
  return url.toString();
}
