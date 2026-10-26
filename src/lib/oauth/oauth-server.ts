import "server-only";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { requestOrigin } from "@/lib/billing-server";
import { fetchPublic } from "@/lib/lms/safe-fetch";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_MINUTES,
  KNOWN_CLIENTS,
  REFRESH_TOKEN_TTL_DAYS,
  isAllowedClientId,
  parseClientMetadata,
  pkceMatches,
  randomToken,
  type ClientMetadata,
} from "@/lib/oauth/oauth";

// The database side of "Sign in with Campus OS" (rules in oauth.ts). Codes
// and tokens are stored only as HMACs (hashToken), like sessions.

/**
 * This site's origin: the OAuth issuer, and the MCP endpoint's base. It must
 * not depend on the request's Host header in production (tokens are bound to
 * it), so there it's APP_URL or nothing.
 */
export async function oauthOrigin(): Promise<string | null> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return null;
  return requestOrigin();
}

const localClientsAllowed = () => process.env.NODE_ENV !== "production";

/** The client behind a client_id URL, from its metadata document; null if it isn't allowed or can't be read. */
export async function loadClient(clientId: string): Promise<ClientMetadata | null> {
  if (!isAllowedClientId(clientId, { allowLocal: localClientsAllowed() })) return null;
  try {
    const res = await fetchPublic(clientId, {
      maxBytes: 64 * 1024,
      timeoutMs: 5000,
      maxRedirects: 0,
      accept: "application/json",
      userAgent: "CampusOS-OAuth/1.0",
    });
    const parsed = parseClientMetadata(JSON.parse(res.body.toString("utf8")), clientId);
    if (parsed) return parsed;
  } catch (err) {
    console.error(`OAuth: couldn't read client metadata ${clientId}:`, err instanceof Error ? err.message : err);
  }
  return KNOWN_CLIENTS[clientId] ?? null;
}

/** After the student taps Allow: a new grant and its authorization code. */
export async function createAuthorization(input: {
  userId: string;
  client: ClientMetadata;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}): Promise<string> {
  const code = randomToken();
  await prisma.oAuthGrant.create({
    data: {
      userId: input.userId,
      clientId: input.client.clientId,
      clientName: input.client.clientName,
      scope: input.scope,
      resource: input.resource,
      codes: {
        create: {
          codeHash: hashToken(code),
          redirectUri: input.redirectUri,
          codeChallenge: input.codeChallenge,
          expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MINUTES * 60 * 1000),
        },
      },
    },
  });
  return code;
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400
  ) {
    super(description);
  }
}

async function issueTokens(grantId: string, scope: string): Promise<TokenResponse> {
  const access = randomToken();
  const refresh = randomToken();
  const now = Date.now();
  await prisma.oAuthToken.createMany({
    data: [
      { grantId, kind: "access", tokenHash: hashToken(access), expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000) },
      { grantId, kind: "refresh", tokenHash: hashToken(refresh), expiresAt: new Date(now + REFRESH_TOKEN_TTL_DAYS * 86_400_000) },
    ],
  });
  // Each refresh adds a pair; drop this grant's tokens that can't work anymore.
  await prisma.oAuthToken.deleteMany({
    where: { grantId, OR: [{ expiresAt: { lt: new Date(now) } }, { kind: "refresh", usedAt: { lt: new Date(now - 86_400_000) } }] },
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refresh, scope };
}

/** grant_type=authorization_code */
export async function exchangeCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string | null;
}): Promise<TokenResponse> {
  const invalid = new OAuthError("invalid_grant", "The authorization code is invalid or has expired.");
  const row = await prisma.oAuthCode.findUnique({ where: { codeHash: hashToken(input.code) }, include: { grant: true } });
  if (!row || row.grant.revokedAt) throw invalid;
  if (row.usedAt) {
    // A code used twice means someone else has it: stop everything it gave out.
    await revokeGrant(row.grantId);
    throw invalid;
  }
  if (row.expiresAt < new Date()) throw invalid;
  if (row.grant.clientId !== input.clientId || row.redirectUri !== input.redirectUri) throw invalid;
  if (input.resource && input.resource !== row.grant.resource) {
    throw new OAuthError("invalid_target", "The resource doesn't match the authorization.");
  }
  if (!pkceMatches(input.codeVerifier, row.codeChallenge)) throw invalid;

  // Single use even when two requests race: only one update matches.
  const claimed = await prisma.oAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw invalid;
  return issueTokens(row.grantId, row.grant.scope);
}

/** grant_type=refresh_token: rotates the refresh token. */
export async function refreshTokens(input: { refreshToken: string; clientId: string; resource: string | null }): Promise<TokenResponse> {
  const invalid = new OAuthError("invalid_grant", "The refresh token is invalid or has expired.");
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: hashToken(input.refreshToken) }, include: { grant: true } });
  if (!row || row.kind !== "refresh" || row.grant.revokedAt) throw invalid;
  if (row.grant.clientId !== input.clientId) throw invalid;
  if (input.resource && input.resource !== row.grant.resource) {
    throw new OAuthError("invalid_target", "The resource doesn't match the authorization.");
  }
  if (row.usedAt) {
    // A rotated refresh token coming back means it was copied. A retry in
    // the same few seconds (two refreshes racing) is refused without
    // disconnecting the student.
    if (Date.now() - row.usedAt.getTime() > 30_000) await revokeGrant(row.grantId);
    throw invalid;
  }
  if (row.expiresAt < new Date()) throw invalid;
  const claimed = await prisma.oAuthToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw invalid;
  return issueTokens(row.grantId, row.grant.scope);
}

/** The account behind a Bearer access token for this resource, or null. */
export async function verifyAccessToken(token: string, resource: string): Promise<{ userId: string; grantId: string } | null> {
  if (!token || token.length > 200) return null;
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { grant: true } });
  if (!row || row.kind !== "access" || row.expiresAt < new Date()) return null;
  if (row.grant.revokedAt || row.grant.resource !== resource) return null;
  // "Last used", for the Connected apps list; at most once a minute.
  if (!row.grant.lastUsedAt || Date.now() - row.grant.lastUsedAt.getTime() > 60_000) {
    await prisma.oAuthGrant.update({ where: { id: row.grantId }, data: { lastUsedAt: new Date() } });
  }
  return { userId: row.grant.userId, grantId: row.grantId };
}

export async function revokeGrant(grantId: string): Promise<void> {
  await prisma.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Disconnects every app (after a password change or reset). */
export async function revokeAllGrants(userId: string): Promise<void> {
  await prisma.oAuthGrant.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Apps connected to the account that can still use it (a refresh token that
 * hasn't expired), one entry per app: connecting again, or from a second
 * ChatGPT account, makes another grant for the same app.
 */
export async function listConnectedApps(userId: string) {
  const grants = await prisma.oAuthGrant.findMany({
    where: { userId, revokedAt: null, tokens: { some: { kind: "refresh", usedAt: null, expiresAt: { gt: new Date() } } } },
    select: { clientId: true, clientName: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "asc" },
  });
  const apps = new Map<string, { clientId: string; clientName: string; connectedAt: Date; lastUsedAt: Date | null }>();
  for (const g of grants) {
    const app = apps.get(g.clientId);
    if (!app) apps.set(g.clientId, { clientId: g.clientId, clientName: g.clientName, connectedAt: g.createdAt, lastUsedAt: g.lastUsedAt });
    else if (g.lastUsedAt && (!app.lastUsedAt || g.lastUsedAt > app.lastUsedAt)) app.lastUsedAt = g.lastUsedAt;
  }
  return [...apps.values()];
}

/** Account → Connected apps → Disconnect: every grant this account gave that app. */
export async function revokeApp(userId: string, clientId: string): Promise<void> {
  await prisma.oAuthGrant.updateMany({ where: { userId, clientId, revokedAt: null }, data: { revokedAt: new Date() } });
}
