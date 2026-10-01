import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { exchangeCodeForTokens, fetchGmailProfileEmail, OAUTH_STATE_COOKIE } from "@/lib/google-oauth";
import { saveGmailAccount } from "@/lib/gmail-account";
import {
  NATIVE_FLOW_MAX_AGE_MS,
  NATIVE_OAUTH_COOKIE,
  nativeCallbackUrl,
  readGmailHandoff,
  sealGmailResult,
} from "@/lib/native-oauth";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  // Started from the iPhone app's sign-in sheet (see src/lib/native-oauth.ts)?
  // Checked before any login, because that sheet doesn't have the app's.
  const nativeToken = cookieStore.get(NATIVE_OAUTH_COOKIE)?.value;
  cookieStore.delete(NATIVE_OAUTH_COOKIE);
  const nativeUserId = nativeToken ? readGmailHandoff(nativeToken, NATIVE_FLOW_MAX_AGE_MS) : null;

  const fail = (message: string) =>
    NextResponse.redirect(
      nativeToken
        ? nativeCallbackUrl({ error: message })
        : new URL(`/email?error=${encodeURIComponent(message)}`, request.url)
    );

  if (nativeToken && !nativeUserId) {
    return fail("That Gmail connection attempt expired. Tap Connect Gmail again.");
  }
  const userId = nativeUserId ?? (await requireUser()).id;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  if (oauthError) {
    return fail(oauthError === "access_denied" ? "Gmail connection was cancelled." : oauthError);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("That Gmail connection attempt expired or looked invalid — try again.");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only returns a refresh_token the first time a user grants
      // consent for this client (or with prompt=consent, which we always
      // pass) — if it's still missing something unusual happened upstream.
      return fail("Google didn't return a refresh token — try disconnecting any prior grant at myaccount.google.com/permissions and reconnecting.");
    }

    const emailAddress = await fetchGmailProfileEmail(tokens.access_token);

    if (nativeUserId) {
      // Saved by the app itself, from its own login (/native-finish).
      const { access_token, refresh_token, expires_in, scope } = tokens;
      const result = sealGmailResult({ userId, emailAddress, tokens: { access_token, refresh_token, expires_in, scope } });
      return NextResponse.redirect(nativeCallbackUrl({ result }));
    }

    await saveGmailAccount(userId, emailAddress, tokens);
    return NextResponse.redirect(new URL("/email?connected=1", request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong connecting Gmail.";
    return fail(message);
  }
}
