// A small Schoology REST client (developers.schoology.com) for a student's
// own API key: the consumer key and secret every Schoology user can get from
// their school's <address>/api page, unless the school turned that off.
// Hand-rolled like canvas.ts and stripe.ts.
//
// - Auth is two-legged OAuth 1.0a with the PLAINTEXT signature, the method
//   Schoology documents for HTTPS. Every request gets a fresh nonce.
// - Schoology answers some calls with a redirect (GET /users/me is a 303 to
//   /users/{id}; a file's download_path redirects to storage). Redirects are
//   followed by hand: the OAuth header only ever goes to api.schoology.com.
// - The API allows 50 requests per 5 seconds per key, so requests are
//   spaced to stay under that, and a 429 waits for Retry-After.
// - Times come back as "YYYY-MM-DD HH:MM:SS" in the account's own time zone
//   (the user's tz_name), never UTC.

import crypto from "node:crypto";
import { fromZonedTime } from "date-fns-tz";

export interface SchoologyConfig {
  consumerKey: string;
  consumerSecret: string;
  /** The school's Schoology address, for links: https://app.schoology.com or https://lms.district.org. */
  domain: string;
}

export class SchoologyApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "SchoologyApiError";
  }
}

// Overridable for local testing against a stand-in server; production
// always talks to Schoology itself.
function apiBase(): string {
  const override = process.env.NODE_ENV !== "production" ? process.env.SCHOOLOGY_API_URL : undefined;
  return (override || "https://api.schoology.com/v1").replace(/\/+$/, "");
}

const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 4;
const MAX_REDIRECTS = 5;
// Schoology's limit is 50 per 5 seconds; leave room for other requests.
const WINDOW_MS = 5_000;
const REQUESTS_PER_WINDOW = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The Authorization header for one request: two-legged OAuth 1.0a (no
 * token), PLAINTEXT signature — the consumer secret plus "&" (there's no
 * token secret), percent-encoded once more for the header, exactly as in
 * Schoology's own example.
 */
export function schoologyAuthHeader(consumerKey: string, consumerSecret: string, nonce: string, timestamp: number): string {
  const signature = oauthEncode(`${oauthEncode(consumerSecret)}&`);
  return [
    `OAuth realm="Schoology API"`,
    `oauth_consumer_key="${oauthEncode(consumerKey)}"`,
    `oauth_token=""`,
    `oauth_nonce="${nonce}"`,
    `oauth_timestamp="${timestamp}"`,
    `oauth_signature_method="PLAINTEXT"`,
    `oauth_version="1.0"`,
    `oauth_signature="${signature}"`,
  ].join(", ");
}

/**
 * A Schoology date-time ("2026-10-08 23:59:00", in the account's time
 * zone) as an instant. Null for an empty or zero date, which is how
 * Schoology says "no due date".
 */
export function parseSchoologyDate(value: string | null | undefined, timeZone: string): Date | null {
  if (!value || /^0000-00-00/.test(value)) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/);
  if (!match) return null;
  const local = `${match[1]}T${match[2] ?? "23:59:00"}`;
  try {
    const date = fromZonedTime(local, timeZone);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/** A school's Schoology address, cleaned up: "lms.district.org/home" becomes "https://lms.district.org". */
export function normalizeSchoologyDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!url.hostname.includes(".")) return null;
    return `https://${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export class SchoologyClient {
  private sent: number[] = [];

  constructor(private readonly cfg: SchoologyConfig) {}

  get domain(): string {
    return this.cfg.domain;
  }

  private isApiUrl(url: URL): boolean {
    const api = new URL(apiBase());
    return url.origin === api.origin;
  }

  /** Waits until another request fits in Schoology's rate limit. */
  private async throttle(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.sent = this.sent.filter((t) => now - t < WINDOW_MS);
      if (this.sent.length < REQUESTS_PER_WINDOW) {
        this.sent.push(now);
        return;
      }
      await sleep(WINDOW_MS - (now - this.sent[0]) + 25);
    }
  }

  /**
   * GET with retries (429 and 5xx, honoring Retry-After; never 401/403/404)
   * and redirects followed by hand. The OAuth header is only ever sent to
   * the API itself; a redirect elsewhere (a file in storage) is fetched
   * without it.
   */
  async get(pathOrUrl: string): Promise<Response> {
    let url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${apiBase()}${pathOrUrl}`);
    if (url.protocol === "http:" && url.hostname === "api.schoology.com") url.protocol = "https:";

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const toApi = this.isApiUrl(url);
      const res = await this.fetchWithRetry(url, toApi);
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = new URL(res.headers.get("location") as string, url);
        if (url.protocol === "http:" && url.hostname === "api.schoology.com") url.protocol = "https:";
        continue;
      }
      return res;
    }
    throw new SchoologyApiError(0, "Schoology redirected too many times.");
  }

  private async fetchWithRetry(url: URL, signed: boolean): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signed) await this.throttle();
      let res: Response;
      try {
        res = await fetch(url, {
          headers: signed
            ? {
                Authorization: schoologyAuthHeader(
                  this.cfg.consumerKey,
                  this.cfg.consumerSecret,
                  crypto.randomBytes(12).toString("hex"),
                  Math.floor(Date.now() / 1000)
                ),
                Accept: "application/json",
              }
            : {},
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        lastErr = err;
        if (attempt === MAX_ATTEMPTS) throw err;
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }
      return res;
    }
    throw lastErr instanceof Error ? lastErr : new Error("Schoology request failed after retries.");
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await this.get(path);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SchoologyApiError(res.status, `Schoology API ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Every item of a paged list. Schoology wraps lists as { <key>: [...],
   * total, links: { next } }; the next page's link is followed until there
   * isn't one (capped, in case a response ever links back to itself).
   */
  async getList<T>(path: string, key: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = `${path}${path.includes("?") ? "&" : "?"}start=0&limit=200`;
    for (let page = 0; next && page < 50; page++) {
      const body: Record<string, unknown> & { links?: { next?: string } } = await this.getJson(next);
      const list = body[key];
      if (Array.isArray(list)) items.push(...(list as T[]));
      next = typeof body.links?.next === "string" && body.links.next ? body.links.next : null;
    }
    return items;
  }
}

// ---------------------------------------------------------------------------
// The objects this app reads. Schoology sends most numbers as strings and
// flags as 0/1 (sometimes "0"/"1"), so they're read through num() and flag().
// ---------------------------------------------------------------------------

export interface SchoologyUser {
  id: number | string;
  uid?: string;
  name_display?: string;
  tz_name?: string;
}

export interface SchoologySection {
  id: number | string;
  course_title?: string;
  course_code?: string;
  section_title?: string;
  section_code?: string;
  section_school_code?: string;
  active?: number | string;
}

export interface SchoologyFileAttachment {
  id: number | string;
  title?: string;
  filename?: string;
  filesize?: number | string;
  filemime?: string;
  timestamp?: number | string;
  download_path?: string;
  extension?: string;
}

export interface SchoologyLinkAttachment {
  id: number | string;
  title?: string;
  url?: string;
}

export interface SchoologyAttachments {
  files?: { file?: SchoologyFileAttachment[] };
  links?: { link?: SchoologyLinkAttachment[] };
}

export interface SchoologyGradeItem {
  id: number | string;
  title: string;
  description?: string | null;
  due?: string | null;
  max_points?: number | string | null;
  is_final?: number | string;
  allow_dropbox?: number | string;
  published?: number | string;
  /** "assignment" | "assessment" (a test/quiz) | "discussion" */
  type?: string;
  grade_item_id?: number | string;
  attachments?: SchoologyAttachments;
}

export interface SchoologyEvent {
  id: number | string;
  title: string;
  start?: string | null;
  /** "event" | "assignment" | "discussion" (the last two duplicate grade items) */
  type?: string;
}

export interface SchoologyGrade {
  assignment_id: number | string;
  grade?: number | string | null;
  exception?: number | string | null;
}

export interface SchoologyRevision {
  revision_id?: number | string;
  draft?: number | string;
}

export interface SchoologyDocument {
  id: number | string;
  title?: string;
  published?: number | string;
  attachments?: SchoologyAttachments;
}

export interface SchoologyPage {
  id: number | string;
  title?: string;
  body?: string | null;
  published?: number | string;
  created?: number | string;
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function flag(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

/** The API user: GET /users/me, which Schoology answers with a redirect to /users/{id}. */
export function fetchSchoologyMe(client: SchoologyClient): Promise<SchoologyUser> {
  return client.getJson<SchoologyUser>("/users/me");
}

export function fetchSchoologySections(client: SchoologyClient, userId: string): Promise<SchoologySection[]> {
  return client.getList<SchoologySection>(`/users/${encodeURIComponent(userId)}/sections`, "section");
}

/**
 * Everything gradable in a section — assignments, tests/quizzes and graded
 * discussions — with attachments (for materials). Falls back to the
 * assignments list, which only has assignments, if the account can't read
 * grade items.
 */
export async function fetchSchoologyGradeItems(client: SchoologyClient, sectionId: string): Promise<SchoologyGradeItem[]> {
  try {
    return await client.getList<SchoologyGradeItem>(`/sections/${sectionId}/grade_items?with_attachments=1`, "assignment");
  } catch (err) {
    if (!(err instanceof SchoologyApiError) || (err.status !== 403 && err.status !== 404)) throw err;
    return client.getList<SchoologyGradeItem>(`/sections/${sectionId}/assignments?with_attachments=1`, "assignment");
  }
}

/** The student's grades in one section, by grade item id. */
export async function fetchSchoologyGrades(
  client: SchoologyClient,
  userId: string,
  sectionId: string
): Promise<Map<string, SchoologyGrade>> {
  const body = await client.getJson<{
    section?: { section_id?: number | string; period?: { assignment?: SchoologyGrade[] }[] }[];
  }>(`/users/${encodeURIComponent(userId)}/grades?section_id=${sectionId}`);
  const grades = new Map<string, SchoologyGrade>();
  for (const section of body.section ?? []) {
    for (const period of section.period ?? []) {
      for (const grade of period.assignment ?? []) grades.set(String(grade.assignment_id), grade);
    }
  }
  return grades;
}

/** Whether the student has turned something in to an assignment's dropbox (a revision that isn't a draft). */
export async function fetchSchoologySubmitted(
  client: SchoologyClient,
  sectionId: string,
  gradeItemId: string,
  userId: string
): Promise<boolean> {
  try {
    const body = await client.getJson<{ revision?: SchoologyRevision[] }>(
      `/sections/${sectionId}/submissions/${gradeItemId}/${encodeURIComponent(userId)}`
    );
    return (body.revision ?? []).some((r) => !flag(r.draft));
  } catch (err) {
    // No dropbox entry for this student yet.
    if (err instanceof SchoologyApiError && err.status === 404) return false;
    throw err;
  }
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fetchSchoologyEvents(client: SchoologyClient, sectionId: string, start: Date, end: Date): Promise<SchoologyEvent[]> {
  return client.getList<SchoologyEvent>(`/sections/${sectionId}/events?start_date=${ymd(start)}&end_date=${ymd(end)}`, "event");
}

export function fetchSchoologyDocuments(client: SchoologyClient, sectionId: string): Promise<SchoologyDocument[]> {
  return client.getList<SchoologyDocument>(`/sections/${sectionId}/documents`, "document");
}

export function fetchSchoologyPages(client: SchoologyClient, sectionId: string): Promise<SchoologyPage[]> {
  return client.getList<SchoologyPage>(`/sections/${sectionId}/pages?withcontent=1`, "page");
}

/** Downloads an attachment from its download_path (an API URL that redirects to storage). */
export async function downloadSchoologyFile(client: SchoologyClient, downloadPath: string): Promise<Buffer> {
  const res = await client.get(downloadPath);
  if (!res.ok) throw new SchoologyApiError(res.status, `Couldn't download that file from Schoology (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** What to tell the student when Schoology won't accept the key at all. */
export function describeSchoologyConnectError(err: unknown, domain: string): string {
  if (err instanceof SchoologyApiError) {
    if (err.status === 401) {
      return `Schoology didn't accept that key and secret. Copy both again from ${domain}/api (Current Consumer Key and Current Consumer Secret).`;
    }
    if (err.status === 403) return "Schoology won't let this API key read your courses. Your school may have turned off student API access.";
    return `Schoology returned an error (${err.status}). Try again in a minute.`;
  }
  return "Couldn't reach Schoology. Check your connection and try again.";
}

/** A short reason for the sync report when one section's work couldn't be loaded. */
export function describeSchoologyCourseError(err: unknown): string {
  if (err instanceof SchoologyApiError) {
    if (err.status === 401 || err.status === 403) return "Schoology isn't letting this key read this course's assignments.";
    if (err.status === 404) return "Schoology couldn't find this course's assignments.";
    return `Schoology had a problem loading this course (error ${err.status}). Sync again later.`;
  }
  return "Couldn't reach Schoology for this course. Sync again in a minute.";
}
