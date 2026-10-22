import "server-only";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { emailConfigured } from "@/lib/email-send";
import { requestOrigin } from "@/lib/billing-server";
import { isResetLinkUsable } from "@/lib/password-reset";

/**
 * The site address reset links point to, or null when reset emails can't
 * be sent. In production it must be APP_URL, never the request's own Host
 * header: a link built from a header someone else controls could send a
 * reset link to their site. Local runs fall back to the request's origin.
 */
export async function resetLinkOrigin(): Promise<string | null> {
  if (!emailConfigured()) return null;
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : requestOrigin();
}

export async function passwordResetAvailable(): Promise<boolean> {
  return (await resetLinkOrigin()) !== null;
}

/** Whether a link from a reset email can still be used, without using it. */
export async function resetLinkIsUsable(token: string): Promise<boolean> {
  if (!token) return false;
  const link = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, usedAt: true },
  });
  return link !== null && isResetLinkUsable(link, new Date());
}
