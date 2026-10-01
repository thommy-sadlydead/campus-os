import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildGoogleAuthUrl, OAUTH_STATE_COOKIE } from "@/lib/google-oauth";
import { NATIVE_FLOW_MAX_AGE_MS, NATIVE_OAUTH_COOKIE, nativeCallbackUrl, readGmailHandoff } from "@/lib/native-oauth";

// Kicks off the Gmail OAuth handshake. A random state value is stashed in
// a short-lived cookie and echoed back by Google on /callback — this is
// the standard CSRF guard for OAuth redirects, and doesn't require a
// database table just to track one in-flight login.
//
// From the iPhone app this runs in the system sign-in sheet, without the
// app's login, so the student comes from a signed `handoff` token instead
// (see src/lib/native-oauth.ts).
export async function GET(request: Request) {
  const handoff = new URL(request.url).searchParams.get("handoff");
  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };

  if (handoff) {
    if (!readGmailHandoff(handoff)) {
      return NextResponse.redirect(nativeCallbackUrl({ error: "That link expired. Tap Connect Gmail again." }));
    }
    cookieStore.set(NATIVE_OAUTH_COOKIE, handoff, { ...cookieOptions, maxAge: NATIVE_FLOW_MAX_AGE_MS / 1000 });
  } else {
    await requireUser(); // redirects to /login if not authenticated
    cookieStore.delete(NATIVE_OAUTH_COOKIE);
  }

  const state = crypto.randomBytes(24).toString("hex");
  cookieStore.set(OAUTH_STATE_COOKIE, state, { ...cookieOptions, maxAge: NATIVE_FLOW_MAX_AGE_MS / 1000 });

  try {
    return NextResponse.redirect(buildGoogleAuthUrl(state));
  } catch (err) {
    // The detail (which GOOGLE_* setting is missing) is for the logs, not the student.
    console.error("Gmail connect isn't configured:", err);
    const message = "Connecting Gmail isn't set up on this site yet.";
    return NextResponse.redirect(
      handoff
        ? nativeCallbackUrl({ error: message })
        : new URL(`/email?error=${encodeURIComponent(message)}`, request.url)
    );
  }
}
