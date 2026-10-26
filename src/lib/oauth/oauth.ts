import crypto from "node:crypto";

// "Sign in with Campus OS": the OAuth 2.1 authorization server ChatGPT uses
// to reach a student's data through the MCP endpoint (src/app/mcp). Pure
// rules live here (tested in tests/oauth.test.ts); the database side is
// oauth-server.ts. It follows the MCP authorization spec as OpenAI applies
// it (developers.openai.com/plugins/build/auth):
// - Clients identify themselves with a Client ID Metadata Document (CIMD):
//   client_id is an HTTPS URL of a JSON document listing its redirect URIs.
//   Only allowlisted hosts (chatgpt.com) can connect, so no other site can
//   collect a student's consent.
// - Public clients only (token_endpoint_auth_method "none"), so PKCE with
//   S256 is required on every authorization.
// - Every authorization response carries `iss` (RFC 9207), which lets
//   ChatGPT use its stable redirect URI.
// - Tokens are bound to the MCP endpoint (`resource`) they were asked for.

/** The one permission: read the student's Campus OS data. */
export const OAUTH_SCOPE = "campus.read";
export const AUTH_CODE_TTL_MINUTES = 10;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 60;

/** Hosts whose client metadata documents may sign students in (ChatGPT and Codex publish theirs here). */
export const ALLOWED_CLIENT_HOSTS = ["chatgpt.com"];

/**
 * ChatGPT's published client metadata (https://chatgpt.com/oauth/client.json),
 * used when fetching it fails: chatgpt.com sits behind bot protection that
 * can turn away a server-side fetch.
 */
export const KNOWN_CLIENTS: Record<string, ClientMetadata> = {
  "https://chatgpt.com/oauth/client.json": {
    clientId: "https://chatgpt.com/oauth/client.json",
    clientName: "ChatGPT",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  },
};

export interface ClientMetadata {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export function mcpResource(origin: string): string {
  return `${origin}/mcp`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Campus OS",
    resource_documentation: `${origin}/support`,
    resource_policy_uri: `${origin}/privacy`,
    resource_tos_uri: `${origin}/terms`,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [OAUTH_SCOPE],
    service_documentation: `${origin}/support`,
    op_policy_uri: `${origin}/privacy`,
    op_tos_uri: `${origin}/terms`,
  };
}

/** The WWW-Authenticate challenge that sends ChatGPT to the metadata (and to sign in again). */
export function bearerChallenge(origin: string, error?: { code: string; description: string }): string {
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource"`, `scope="${OAUTH_SCOPE}"`];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(", ")}`;
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** RFC 7636: a verifier is 43-128 characters of [A-Z a-z 0-9 - . _ ~]. */
export function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Whether a client_id URL may sign students in: HTTPS on an allowed host,
 * with no credentials or fragment. allowLocal admits http://localhost
 * clients for local testing (never in production).
 */
export function isAllowedClientId(clientId: string, { allowLocal = false } = {}): boolean {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (allowLocal && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;
  return url.protocol === "https:" && ALLOWED_CLIENT_HOSTS.includes(url.hostname) && url.pathname !== "/";
}

/** Reads a fetched client metadata document; null if it doesn't describe clientId. */
export function parseClientMetadata(doc: unknown, clientId: string): ClientMetadata | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  if (d.client_id !== clientId) return null;
  const redirectUris = Array.isArray(d.redirect_uris) ? d.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (redirectUris.length === 0) return null;
  const name = typeof d.client_name === "string" && d.client_name.trim() ? d.client_name.trim().slice(0, 60) : new URL(clientId).hostname;
  return { clientId, clientName: name, redirectUris };
}

export interface AuthorizeParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string | null;
}

export function readAuthorizeParams(get: (key: string) => string | null | undefined): AuthorizeParams {
  const value = (key: string) => get(key)?.trim() ?? "";
  return {
    responseType: value("response_type"),
    clientId: value("client_id"),
    redirectUri: value("redirect_uri"),
    state: get("state") ?? null,
    codeChallenge: value("code_challenge"),
    codeChallengeMethod: value("code_challenge_method"),
    scope: value("scope"),
    resource: get("resource")?.trim() || null,
  };
}

/**
 * Checks the rest of an authorization request once the client and its
 * redirect URI are known to be good (errors before that point must not
 * redirect anywhere). Returns the error to send back to the client, or the
 * granted scope.
 */
export function checkAuthorizeParams(
  p: AuthorizeParams,
  expectedResource: string
): { error: string; description: string } | { scope: string; resource: string } {
  if (p.responseType !== "code") return { error: "unsupported_response_type", description: "Only response_type=code is supported." };
  if (!p.codeChallenge || p.codeChallengeMethod !== "S256") {
    return { error: "invalid_request", description: "PKCE with code_challenge_method=S256 is required." };
  }
  if (!/^[A-Za-z0-9\-_]{43}$/.test(p.codeChallenge)) return { error: "invalid_request", description: "Malformed code_challenge." };
  if (p.resource && p.resource !== expectedResource) return { error: "invalid_target", description: "Unknown resource." };
  // Unknown scopes are dropped (RFC 6749 lets the server grant less);
  // there is only one thing to grant.
  return { scope: OAUTH_SCOPE, resource: expectedResource };
}

/** Where to send the browser after Allow or Cancel: the client's redirect URI with code or error, state and iss. */
export function authorizationResponseUrl(
  redirectUri: string,
  issuer: string,
  state: string | null,
  result: { code: string } | { error: string; description?: string }
): string {
  const url = new URL(redirectUri);
  if ("code" in result) url.searchParams.set("code", result.code);
  else {
    url.searchParams.set("error", result.error);
    if (result.description) url.searchParams.set("error_description", result.description);
  }
  if (state !== null) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

/**
 * The stable, opaque account id the profile tool returns: the same for an
 * account across reconnections, and not the database id itself.
 */
export function profileIdFor(userId: string, secret: string): string {
  return `cos_${crypto.createHmac("sha256", secret).update(`profile:${userId}`).digest("hex").slice(0, 24)}`;
}

/** A path inside this site that's safe to send someone to after logging in. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\r\n]/.test(next) || next.length > 4000) return null;
  return next;
}
