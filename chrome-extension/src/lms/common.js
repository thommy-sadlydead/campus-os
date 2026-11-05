// Reading an LMS from the student's own browser session. Every request goes
// to the LMS site the student allowed (chrome.permissions), with their
// existing sign-in (credentials: "include"); the extension never sees or
// stores the password or the cookies themselves.
//
// No chrome.* here, so the Brightspace and Blackboard readers can be tested
// in Node (tests/extension-*.test.ts) with a stand-in fetch.

/** The student isn't signed in to the LMS (or the sign-in expired). Stops the sync. */
export class SessionError extends Error {
  constructor(message = "You're signed out. Sign in to your school's site in Chrome, then sync again.") {
    super(message);
    this.name = "SessionError";
  }
}

/** This site doesn't offer what the extension reads (an older or locked-down installation). */
export class NotSupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotSupportedError";
  }
}

/** A request the LMS answered with an error. `status` is the HTTP status. */
export class LmsHttpError extends Error {
  constructor(status, url) {
    super(`The LMS answered ${status} for ${new URL(url).pathname}`);
    this.name = "LmsHttpError";
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A GET to the LMS: retries 429 and 5xx with backoff (Retry-After when
 * given), never 401/403/404. A sign-in page served instead of JSON (some
 * sites redirect an expired session) counts as signed out.
 */
export function makeLmsFetch(origin, fetchImpl = fetch, { retries = 3, baseDelayMs = 800 } = {}) {
  async function request(path, { accept = "application/json" } = {}) {
    const url = new URL(path, origin).toString();
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, { credentials: "include", headers: { Accept: accept }, redirect: "follow" });
      } catch (err) {
        if (attempt >= retries) throw err;
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : baseDelayMs * 2 ** attempt);
        continue;
      }
      return res;
    }
  }

  async function json(path) {
    const res = await request(path);
    if (res.status === 401) throw new SessionError();
    if (!res.ok) throw new LmsHttpError(res.status, res.url || new URL(path, origin).toString());
    const type = res.headers.get("content-type") || "";
    if (!type.includes("json")) {
      // An HTML sign-in page where JSON was expected.
      if (type.includes("html")) throw new SessionError();
      throw new LmsHttpError(res.status, res.url || path);
    }
    return res.json();
  }

  return { origin, request, json };
}

/** Bounded concurrency without a dependency, like the app's mapWithConcurrency. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** "Lecture 3 slides.pptx" from ".../Lecture%203%20slides.pptx?ou=1". */
export function filenameFromPath(path) {
  try {
    const last = new URL(path, "https://x.invalid").pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last);
  } catch {
    return "";
  }
}

/** A guess at the content type from the file name, for files the LMS lists without one. */
export function contentTypeFor(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  return (
    {
      pdf: "application/pdf",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      epub: "application/epub+zip",
      txt: "text/plain",
      html: "text/html",
      htm: "text/html",
    }[ext] || undefined
  );
}

/** ISO string or null, for dates the LMS may leave out or send as "". */
export function isoOrNull(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Exam-like names: a copy of the app's rule (src/lib/lms/exams.ts); tests check they agree. */
export function isExamLikeName(name) {
  if (!/\b(exams?|examination|midterms?|mid-terms?)\b/i.test(name)) return false;
  return !/\b(review|prep|practice|study guide|wrapper|reflection|corrections?)\b/i.test(name);
}
