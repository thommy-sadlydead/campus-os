import "server-only";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/google-oauth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Returns a valid (non-expired) access token for the user's linked Gmail
 * account, refreshing and re-encrypting it in the database first if
 * needed. Throws a clearly-labeled error if the account was disconnected
 * on Google's side (revoked) — callers should surface that as "reconnect
 * Gmail" rather than a generic failure.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const account = await prisma.emailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("No Gmail account connected.");

  const bufferMs = 60_000;
  const stillValid = account.expiresAt && account.expiresAt.getTime() - bufferMs > Date.now();
  if (stillValid) {
    return decryptSecret(account.accessTokenEnc);
  }

  try {
    const refreshToken = decryptSecret(account.refreshTokenEnc);
    const refreshed = await refreshAccessToken(refreshToken);
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    await prisma.emailAccount.update({
      where: { userId },
      data: { accessTokenEnc: encryptSecret(refreshed.access_token), expiresAt },
    });
    return refreshed.access_token;
  } catch (err) {
    throw new Error(
      "Couldn't refresh your Gmail access — the connection may have been revoked. Reconnect it from the Email page."
    );
  }
}

export interface GmailMessageSummary {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAt: Date;
}

interface GmailApiHeader {
  name: string;
  value: string;
}
interface GmailApiPart {
  mimeType: string;
  body?: { data?: string; size?: number };
  parts?: GmailApiPart[];
}
interface GmailApiMessage {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailApiHeader[] } & GmailApiPart;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

/** Walks the (possibly nested, multipart) MIME tree for the first text/plain part. */
function extractPlainText(part?: GmailApiPart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const child of part.parts) {
      const found = extractPlainText(child);
      if (found) return found;
    }
  }
  // Fall back to text/html, stripped of tags, if no plain part exists.
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function parseFromHeader(value: string | undefined): { name: string | null; address: string } {
  if (!value) return { name: null, address: "" };
  const match = value.match(/^(.*?)\s*<(.+)>$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, "").trim();
    return { name: name || null, address: match[2].trim() };
  }
  return { name: null, address: value.trim() };
}

async function gmailGet(accessToken: string, path: string): Promise<any> {
  const res = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Gmail API ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

/**
 * IDs of recent messages, newest-ish first. `query` uses Gmail's normal
 * search syntax — we default to a window of recent mail rather than the
 * whole mailbox, since only recent mail is useful for "what did I just
 * miss," and it keeps each sync fast and cheap.
 */
export async function listRecentMessageIds(accessToken: string, query: string, maxResults = 40): Promise<string[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const data = await gmailGet(accessToken, `/messages?${params.toString()}`);
  return (data.messages ?? []).map((m: { id: string }) => m.id);
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessageSummary> {
  const data: GmailApiMessage = await gmailGet(accessToken, `/messages/${id}?format=full`);
  const headers = data.payload?.headers ?? [];
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  const { name, address } = parseFromHeader(get("From"));
  const bodyText = extractPlainText(data.payload).slice(0, 8000); // cap — we only need enough for classification, not the whole thread

  return {
    id: data.id,
    fromAddress: address,
    fromName: name,
    subject: get("Subject") ?? "(no subject)",
    snippet: data.snippet ?? "",
    bodyText,
    receivedAt: data.internalDate ? new Date(Number(data.internalDate)) : new Date(),
  };
}
