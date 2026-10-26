import { NextResponse } from "next/server";
import { exchangeCode, oauthOrigin, OAuthError, refreshTokens } from "@/lib/oauth/oauth-server";
import { mcpResource } from "@/lib/oauth/oauth";

// The OAuth token endpoint: ChatGPT trades an authorization code (with its
// PKCE verifier) for tokens, and later a refresh token for new ones. Public
// clients only, so there's no client secret to check; PKCE and the
// single-use code are what stop a stolen code from working.

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const origin = await oauthOrigin();
  if (!origin) return oauthError("temporarily_unavailable", "Sign-in isn't set up on this server.", 503);

  let form: URLSearchParams;
  try {
    const type = request.headers.get("content-type") ?? "";
    form = type.includes("application/json")
      ? new URLSearchParams(Object.entries((await request.json()) as Record<string, string>).map(([k, v]) => [k, String(v)]))
      : new URLSearchParams(await request.text());
  } catch {
    return oauthError("invalid_request", "The request body couldn't be read.");
  }
  const field = (key: string) => form.get(key)?.trim() ?? "";
  if (field("client_assertion") || request.headers.get("authorization")) {
    return oauthError("invalid_client", "This server only supports public clients (token_endpoint_auth_method none).", 401);
  }
  const clientId = field("client_id");
  if (!clientId) return oauthError("invalid_client", "client_id is required.", 401);
  const resource = field("resource") || null;
  if (resource && resource !== mcpResource(origin)) return oauthError("invalid_target", "Unknown resource.");

  try {
    switch (field("grant_type")) {
      case "authorization_code": {
        const tokens = await exchangeCode({
          code: field("code"),
          clientId,
          redirectUri: field("redirect_uri"),
          codeVerifier: field("code_verifier"),
          resource,
        });
        return NextResponse.json(tokens, { headers: NO_STORE });
      }
      case "refresh_token": {
        const tokens = await refreshTokens({ refreshToken: field("refresh_token"), clientId, resource });
        return NextResponse.json(tokens, { headers: NO_STORE });
      }
      default:
        return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
    }
  } catch (err) {
    if (err instanceof OAuthError) return oauthError(err.error, err.description, err.status);
    console.error("OAuth token endpoint failed:", err);
    return oauthError("server_error", "Something went wrong. Try again.", 500);
  }
}
