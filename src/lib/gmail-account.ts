import "server-only";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import type { GoogleTokenResponse } from "@/lib/google-oauth";

/** Saves (or replaces) a student's Gmail connection, tokens encrypted. */
export async function saveGmailAccount(
  userId: string,
  emailAddress: string,
  tokens: Pick<GoogleTokenResponse, "access_token" | "refresh_token" | "expires_in" | "scope">
): Promise<void> {
  const data = {
    emailAddress,
    accessTokenEnc: encryptSecret(tokens.access_token),
    refreshTokenEnc: encryptSecret(tokens.refresh_token as string),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scope: tokens.scope,
  };
  await prisma.emailAccount.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}
