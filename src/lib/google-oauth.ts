import "server-only";

// Minimal Google OAuth2 client, hand-rolled with fetch (no googleapis
// dependency) — consistent with the equally minimal src/lib/canvas.ts.
//
// Scope is intentionally the single narrowest one that does the job:
// gmail.readonly. No password is ever requested or stored — only a
// short-lived access token and a refresh token, both encrypted at rest
// (see src/lib/crypto.ts). The student's email address itself is read
// via Gmail's own /profile endpoint rather than requesting an additional
// `email`/`openid` scope, per "only request the minimum permissions
// necessary."

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Create a Google Cloud OAuth client and set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in .env — see .env.example.`
    );
  }
  return value;
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent", // force the consent screen every time, so we reliably get a refresh_token even on a re-connect
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

export async function fetchGmailProfileEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail profile fetch failed: ${res.status}`);
  }
  const data = await res.json();
  return data.emailAddress as string;
}
