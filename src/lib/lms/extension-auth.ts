import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { getAccess, paymentsEnabled } from "@/lib/billing-server";

// Pairing the Campus OS Chrome extension with a student's account, and
// checking the token it signs its requests with (/api/lms-extension/*).
// The extension never sees the student's Campus OS password or session,
// and Campus OS never sees their university password or cookies: the
// extension reads the LMS in their own browser and posts what it found
// with this token. Codes and tokens are stored only as HMACs.

const PAIRING_MINUTES = 10;
const CODE_PREFIX = "cosp_";
const TOKEN_PREFIX = "cosx_";

function randomSecret(prefix: string): string {
  return prefix + crypto.randomBytes(32).toString("base64url");
}

/** A one-time code for the Connect page to hand the extension. */
export async function createPairingCode(userId: string): Promise<string> {
  const code = randomSecret(CODE_PREFIX);
  const now = new Date();
  await prisma.$transaction([
    prisma.extensionPairing.deleteMany({ where: { userId, OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } }),
    prisma.extensionPairing.create({
      data: { userId, codeHash: hashToken(code), expiresAt: new Date(now.getTime() + PAIRING_MINUTES * 60_000) },
    }),
  ]);
  return code;
}

/**
 * Trades a pairing code for the extension's token. The code works once
 * and only for ten minutes; claiming it is a conditional update, so two
 * requests with the same code can't both get a token.
 */
export async function redeemPairingCode(code: string): Promise<{ token: string; email: string } | null> {
  if (!code.startsWith(CODE_PREFIX) || code.length > 100) return null;
  const now = new Date();
  const pairing = await prisma.extensionPairing.findUnique({ where: { codeHash: hashToken(code) }, include: { user: true } });
  if (!pairing || pairing.usedAt || pairing.expiresAt <= now) return null;
  const claimed = await prisma.extensionPairing.updateMany({
    where: { id: pairing.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return null;
  const token = randomSecret(TOKEN_PREFIX);
  await prisma.extensionToken.create({ data: { userId: pairing.userId, tokenHash: hashToken(token) } });
  return { token, email: pairing.user.email };
}

export type ExtensionAuth =
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>> }
  | { ok: false; status: 401 | 402; error: string };

/** The account behind a request's `Authorization: Bearer cosx_…` header. */
export async function authenticateExtension(request: Request): Promise<ExtensionAuth> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(cosx_[A-Za-z0-9_-]{20,100})$/.exec(header)?.[1];
  if (!token) return { ok: false, status: 401, error: "Connect the extension to your Campus OS account again." };
  const row = await prisma.extensionToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row) return { ok: false, status: 401, error: "This extension was disconnected from Campus OS. Connect it again from the Connect page." };
  if (paymentsEnabled() && (await getAccess(row.userId)).kind === "none") {
    return { ok: false, status: 402, error: "Your Campus OS trial has ended. Open Campus OS to keep syncing." };
  }
  // Marked used at most once an hour, so a sync's hundreds of requests don't each write.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60 * 60_000) {
    await prisma.extensionToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return { ok: true, user: row.user };
}

/** Disconnects every copy of the extension paired with this account. */
export async function revokeExtensionTokens(userId: string): Promise<void> {
  await prisma.extensionToken.deleteMany({ where: { userId } });
}

/** Whether the extension is paired with this account (for the Connect page). */
export async function extensionPaired(userId: string): Promise<{ paired: boolean; lastUsedAt: Date | null }> {
  const latest = await prisma.extensionToken.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return { paired: Boolean(latest), lastUsedAt: latest?.lastUsedAt ?? null };
}
