import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCodeForTokens, fetchGmailProfileEmail } from "@/lib/google-oauth";
import { OAUTH_STATE_COOKIE } from "@/app/api/email/oauth/start/route";

function errorRedirect(request: Request, message: string) {
  return NextResponse.redirect(new URL(`/email?error=${encodeURIComponent(message)}`, request.url));
}

export async function GET(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const expectedState = cookies().get(OAUTH_STATE_COOKIE)?.value;
  cookies().delete(OAUTH_STATE_COOKIE);

  if (oauthError) {
    return errorRedirect(request, oauthError === "access_denied" ? "Gmail connection was cancelled." : oauthError);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return errorRedirect(request, "That Gmail connection attempt expired or looked invalid — try again.");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only returns a refresh_token the first time a user grants
      // consent for this client (or with prompt=consent, which we always
      // pass) — if it's still missing something unusual happened upstream.
      return errorRedirect(request, "Google didn't return a refresh token — try disconnecting any prior grant at myaccount.google.com/permissions and reconnecting.");
    }

    const emailAddress = await fetchGmailProfileEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.emailAccount.upsert({
      where: { userId: user.id },
      update: {
        emailAddress,
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        expiresAt,
        scope: tokens.scope,
      },
      create: {
        userId: user.id,
        emailAddress,
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        expiresAt,
        scope: tokens.scope,
      },
    });

    return NextResponse.redirect(new URL("/email?connected=1", request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong connecting Gmail.";
    return errorRedirect(request, message);
  }
}
