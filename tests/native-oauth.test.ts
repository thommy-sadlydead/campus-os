import { describe, it, expect, beforeAll } from "vitest";
import {
  createGmailHandoff,
  readGmailHandoff,
  sealGmailResult,
  openGmailResult,
  nativeCallbackUrl,
  NATIVE_FLOW_MAX_AGE_MS,
} from "@/lib/native-oauth";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-native-oauth-only";
});

const NOW = Date.parse("2026-10-01T12:00:00Z");
const TOKENS = { access_token: "ya29.access", refresh_token: "1//refresh", expires_in: 3599, scope: "gmail.readonly" };

describe("Gmail handoff token", () => {
  it("names the student it was made for", () => {
    expect(readGmailHandoff(createGmailHandoff("user-1", NOW), undefined, NOW + 60_000)).toBe("user-1");
  });

  it("expires after five minutes, but the callback allows the whole sign-in", () => {
    const token = createGmailHandoff("user-1", NOW);
    expect(readGmailHandoff(token, undefined, NOW + 6 * 60_000)).toBeNull();
    expect(readGmailHandoff(token, NATIVE_FLOW_MAX_AGE_MS, NOW + 10 * 60_000)).toBe("user-1");
    expect(readGmailHandoff(token, NATIVE_FLOW_MAX_AGE_MS, NOW + 16 * 60_000)).toBeNull();
  });

  it("rejects a token edited to name someone else", () => {
    const [, signature] = createGmailHandoff("user-1", NOW).split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ u: "user-2", t: NOW })).toString("base64url");
    expect(readGmailHandoff(`${forgedPayload}.${signature}`, undefined, NOW)).toBeNull();
    expect(readGmailHandoff("garbage", undefined, NOW)).toBeNull();
  });
});

describe("sealed Gmail result", () => {
  it("opens only for the same student, within five minutes", () => {
    const sealed = sealGmailResult({ userId: "user-1", emailAddress: "student@school.edu", tokens: TOKENS }, NOW);
    expect(openGmailResult(sealed, "user-1", NOW + 60_000)).toMatchObject({ emailAddress: "student@school.edu", tokens: TOKENS });
    // Someone who sent the victim their own link can't collect the result on their account.
    expect(openGmailResult(sealed, "user-2", NOW + 60_000)).toBeNull();
    expect(openGmailResult(sealed, "user-1", NOW + 6 * 60_000)).toBeNull();
  });

  it("rejects anything tampered with", () => {
    const sealed = sealGmailResult({ userId: "user-1", emailAddress: "student@school.edu", tokens: TOKENS }, NOW);
    const [iv, tag, data] = sealed.split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(openGmailResult(`${iv}.${tag}.${flipped.toString("base64")}`, "user-1", NOW)).toBeNull();
  });

  it("ends the sign-in sheet on the app's own link", () => {
    expect(nativeCallbackUrl({ error: "Cancelled." })).toBe("campusos://email-connected?error=Cancelled.");
    expect(nativeCallbackUrl({ result: "a.b+c/d=" })).toBe("campusos://email-connected?result=a.b%2Bc%2Fd%3D");
  });
});
