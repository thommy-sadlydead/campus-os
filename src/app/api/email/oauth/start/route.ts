import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildGoogleAuthUrl } from "@/lib/google-oauth";

export const OAUTH_STATE_COOKIE = "campusos_oauth_state";

// Kicks off the Gmail OAuth handshake. A random state value is stashed in
// a short-lived cookie and echoed back by Google on /callback — this is
// the standard CSRF guard for OAuth redirects, and doesn't require a
// database table just to track one in-flight login.
export async function GET(request: Request) {
  await requireUser(); // redirects to /login if not authenticated

  const state = crypto.randomBytes(24).toString("hex");
  cookies().set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  try {
    return NextResponse.redirect(buildGoogleAuthUrl(state));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google OAuth isn't configured yet.";
    return NextResponse.redirect(new URL(`/email?error=${encodeURIComponent(message)}`, request.url));
  }
}
