// Minimal Canvas LMS REST client. Used by scripts/sync-canvas.ts, the
// in-app "Connect Canvas" / "Sync now" actions, and the Canvas materials
// sync engine (src/lib/canvas-materials-sync.ts). Deliberately not "server
// only" since the standalone sync script isn't part of the Next.js
// request lifecycle.
import { extractDocumentText } from "./office-text";
import { MAX_DOCUMENT_FILE_BYTES } from "./lecture-notes";
import type { LmsSubmission } from "./lms/status";

export interface CanvasCourse {
  id: number;
  // Both missing when access_restricted_by_date is set: Canvas then only
  // says the course exists (a term that hasn't started, or has ended).
  name?: string;
  course_code?: string;
  access_restricted_by_date?: boolean;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  points_possible: number | null;
  html_url: string;
  // "online_upload", "on_paper", "none", "external_tool", ...
  submission_types?: string[];
  // The student's own submission (include[]=submission).
  submission?: { workflow_state?: string; excused?: boolean | null };
}

export interface CanvasCalendarEvent {
  id: number;
  title: string;
  start_at: string | null;
  location_name: string | null;
  context_code: string; // "course_123"
  html_url: string;
  workflow_state?: string; // "active" | "locked" | "deleted"
}

export interface CanvasConfig {
  baseUrl: string; // e.g. https://cedarville.instructure.com
  token: string;
}

export class CanvasApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "CanvasApiError";
  }
}

const CANVAS_TIMEOUT_MS = 20_000;
const CANVAS_RETRY_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

/**
 * Every Canvas request goes through here. 401/403/404 are never retried —
 * they're permanent for this request, and the caller (a specific
 * resource's fetch, in the bulk sync) is expected to record that as a
 * per-resource failure rather than this function deciding the whole sync
 * should stop. 429 and 5xx retry with backoff (honoring Retry-After when
 * Canvas sends one); a network/timeout error retries the same way.
 */
async function canvasFetchWithRetry(url: string, token: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CANVAS_RETRY_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(CANVAS_TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = err;
      if (attempt === CANVAS_RETRY_ATTEMPTS) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < CANVAS_RETRY_ATTEMPTS) {
      const retryAfter = res.headers.get("retry-after");
      await sleep(retryAfter ? Number(retryAfter) * 1000 : backoffMs(attempt));
      continue;
    }
    return res;
  }
  throw lastErr instanceof Error ? lastErr : new Error("Canvas request failed after retries.");
}

async function canvasGet<T>(cfg: CanvasConfig, path: string): Promise<T> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}${path}`;
  const res = await canvasFetchWithRetry(url, cfg.token);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CanvasApiError(res.status, `Canvas API ${path} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Follows Canvas's Link-header pagination until it's exhausted — the
 * correct way to paginate (vs. assuming a short page means "done", which
 * breaks if a page happens to land on exactly per_page items as the last
 * page). Used for every list endpoint added for materials discovery, and
 * for courses/assignments.
 */
async function canvasGetAllPages<T>(cfg: CanvasConfig, path: string): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = `${cfg.baseUrl.replace(/\/$/, "")}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  while (url) {
    const res = await canvasFetchWithRetry(url, cfg.token);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new CanvasApiError(res.status, `Canvas API ${path} failed: ${res.status} ${res.statusText} ${body}`);
    }
    const page = (await res.json()) as T[];
    results.push(...page);
    const link = res.headers.get("link") || "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }
  return results;
}

export async function fetchActiveCourses(cfg: CanvasConfig): Promise<CanvasCourse[]> {
  return canvasGetAllPages<CanvasCourse>(cfg, "/api/v1/courses?enrollment_state=active");
}

/** Courses the student was invited to but hasn't accepted yet; Canvas hides their work until they do. */
export async function fetchPendingCourses(cfg: CanvasConfig): Promise<CanvasCourse[]> {
  return canvasGetAllPages<CanvasCourse>(cfg, "/api/v1/courses?enrollment_state=invited_or_pending");
}

export async function fetchCourseAssignments(cfg: CanvasConfig, courseId: number): Promise<CanvasAssignment[]> {
  return canvasGetAllPages<CanvasAssignment>(
    cfg,
    `/api/v1/courses/${courseId}/assignments?order_by=due_at&include[]=submission`
  );
}

/**
 * Calendar events (not assignments) in these courses between two dates:
 * where professors often put an in-class exam. Canvas takes at most 10
 * courses per request.
 */
export async function fetchCourseCalendarEvents(
  cfg: CanvasConfig,
  courseIds: number[],
  start: Date,
  end: Date
): Promise<CanvasCalendarEvent[]> {
  const events: CanvasCalendarEvent[] = [];
  for (let i = 0; i < courseIds.length; i += 10) {
    const contexts = courseIds
      .slice(i, i + 10)
      .map((id) => `context_codes[]=course_${id}`)
      .join("&");
    events.push(
      ...(await canvasGetAllPages<CanvasCalendarEvent>(
        cfg,
        `/api/v1/calendar_events?type=event&${contexts}&start_date=${start.toISOString()}&end_date=${end.toISOString()}`
      ))
    );
  }
  return events;
}

// Submission types Canvas records a submission for, so "unsubmitted" really
// means the student hasn't turned it in (unlike "on_paper" or "none").
const TRACKED_SUBMISSION_TYPES = new Set([
  "online_upload",
  "online_text_entry",
  "online_url",
  "online_quiz",
  "media_recording",
  "student_annotation",
  "discussion_topic",
]);

export function canvasTracksSubmissions(a: CanvasAssignment): boolean {
  return (a.submission_types ?? []).some((type) => TRACKED_SUBMISSION_TYPES.has(type));
}

/** What Canvas says about the student's own submission; null when it didn't include one. */
export function canvasSubmissionState(a: CanvasAssignment): LmsSubmission | null {
  const submission = a.submission;
  if (!submission) return null;
  // Excused: nothing left to do, the same as graded.
  if (submission.excused) return "graded";
  switch (submission.workflow_state) {
    case "graded":
      return "graded";
    case "submitted":
    case "pending_review":
      return "submitted";
    case "unsubmitted":
      return "unsubmitted";
    default:
      return null;
  }
}

/** A short reason for the sync report when one course's assignments couldn't be loaded. */
export function describeCanvasCourseError(err: unknown): string {
  if (err instanceof CanvasApiError) {
    if (err.status === 401 || err.status === 403) return "Canvas isn't letting students see this course's assignments.";
    if (err.status === 404) return "Canvas couldn't find this course's assignments.";
    return `Canvas had a problem loading this course's assignments (error ${err.status}). Sync again later.`;
  }
  return "Couldn't reach Canvas for this course. Sync again in a minute.";
}

/** Why a whole sync failed: Canvas refused the token, couldn't be reached, or something broke partway. */
export function describeCanvasSyncError(err: unknown): string {
  if (err instanceof CanvasApiError && err.status === 401) {
    return "Canvas stopped accepting your access token (it may have expired or been deleted). Disconnect, then connect again with a new token.";
  }
  if (err instanceof CanvasApiError) return describeCanvasConnectError(err);
  if (err instanceof Error && (err instanceof TypeError || err.name === "TimeoutError" || err.name === "AbortError")) {
    return "Couldn't reach Canvas. Check your connection and sync again.";
  }
  return "The sync stopped partway through. Sync again to finish it.";
}

/** What to tell the student when Canvas won't list their courses at all (the token or the address is wrong). */
export function describeCanvasConnectError(err: unknown): string {
  if (err instanceof CanvasApiError) {
    if (err.status === 401) return "Canvas didn't accept that access token. Make a new one in Canvas and paste it here.";
    if (err.status === 403) return "Canvas wouldn't let that access token list your courses.";
    if (err.status === 404) return "That doesn't look like your school's Canvas address. Check the URL you use to open Canvas.";
    return `Canvas returned an error (${err.status}). Try again in a minute.`;
  }
  return "Couldn't reach Canvas at that address. Check the URL and try again.";
}

export type CanvasUrlClassification =
  | { kind: "file"; fileId: string }
  | { kind: "canvas-page" } // same Canvas instance, but not a link to one specific file
  | { kind: "external" };

/**
 * Canvas file links always contain "/files/:id" somewhere in the path,
 * whether it's a bare `/files/123`, a course-scoped
 * `/courses/456/files/123`, or either with a trailing `/download` or query
 * string — so matching that one pattern covers every real-world shape
 * without needing to enumerate them. A same-host URL that doesn't match
 * (e.g. the course's whole files *list*, or an unrelated Canvas page) is
 * "canvas-page": still worth a specific, honest error rather than falling
 * through to a generic public-page fetch that Canvas's auth wall would
 * just reject anyway.
 */
export function classifyCanvasUrl(url: URL, canvasBaseUrl: string | undefined): CanvasUrlClassification {
  if (!canvasBaseUrl) return { kind: "external" };
  let canvasHost: string;
  try {
    canvasHost = new URL(canvasBaseUrl).hostname;
  } catch {
    return { kind: "external" };
  }
  if (url.hostname !== canvasHost) return { kind: "external" };
  const match = url.pathname.match(/\/files\/(\d+)/);
  return match ? { kind: "file", fileId: match[1] } : { kind: "canvas-page" };
}

// ---------------------------------------------------------------------------
// Materials discovery — Files, Modules, Pages, Syllabus.
//
// Do NOT assume every book/slide deck lives directly under /files: a
// course's Files tab can be hidden by the instructor (confirmed on real
// data — Canvas then returns 403 for the list endpoint even though
// individual files are still fetchable by id), and materials are commonly
// linked from Modules, Pages, and assignment descriptions instead. See
// src/lib/canvas-materials-sync.ts for how these are combined and deduped.
// ---------------------------------------------------------------------------

export interface CanvasFile {
  id: number;
  display_name: string;
  "content-type"?: string;
  size: number;
  url: string; // pre-signed, directly downloadable, no auth header needed
  updated_at: string;
  locked_for_user?: boolean;
  hidden?: boolean;
  locked?: boolean;
}

export interface CanvasModuleItem {
  id: number;
  title: string;
  type: string; // "File" | "Page" | "ExternalUrl" | "Assignment" | "Quiz" | "Discussion" | "SubHeader" | ...
  content_id?: number; // file id when type === "File"
  page_url?: string; // page slug when type === "Page"
  external_url?: string; // when type === "ExternalUrl"
}

export interface CanvasModule {
  id: number;
  name: string;
}

export interface CanvasPageSummary {
  page_id: number;
  url: string; // stable slug — pass to fetchPageBody
  title: string;
  updated_at: string;
}

export interface CanvasPageDetail extends CanvasPageSummary {
  body: string | null; // HTML
}

/**
 * Course Files list. Can legitimately 403 if the instructor hid the Files
 * tab — callers should fall back to Modules/Pages discovery rather than
 * treating that as a fatal error for the whole course.
 */
export async function fetchCourseFiles(cfg: CanvasConfig, courseId: number): Promise<CanvasFile[]> {
  return canvasGetAllPages<CanvasFile>(cfg, `/api/v1/courses/${courseId}/files`);
}

export async function fetchCourseModules(cfg: CanvasConfig, courseId: number): Promise<CanvasModule[]> {
  return canvasGetAllPages<CanvasModule>(cfg, `/api/v1/courses/${courseId}/modules`);
}

/**
 * Items for one module, fetched separately (rather than via modules'
 * `include[]=items`) so a module with more items than Canvas embeds inline
 * can't silently lose items — this endpoint paginates properly on its own.
 */
export async function fetchModuleItems(
  cfg: CanvasConfig,
  courseId: number,
  moduleId: number
): Promise<CanvasModuleItem[]> {
  return canvasGetAllPages<CanvasModuleItem>(cfg, `/api/v1/courses/${courseId}/modules/${moduleId}/items`);
}

export async function fetchCoursePages(cfg: CanvasConfig, courseId: number): Promise<CanvasPageSummary[]> {
  return canvasGetAllPages<CanvasPageSummary>(cfg, `/api/v1/courses/${courseId}/pages`);
}

export async function fetchPageBody(cfg: CanvasConfig, courseId: number, pageUrl: string): Promise<CanvasPageDetail> {
  return canvasGet<CanvasPageDetail>(cfg, `/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`);
}

/** Null when the course has no syllabus content set. */
export async function fetchCourseSyllabus(cfg: CanvasConfig, courseId: number): Promise<string | null> {
  const course = await canvasGet<{ syllabus_body: string | null }>(
    cfg,
    `/api/v1/courses/${courseId}?include[]=syllabus_body`
  );
  return course.syllabus_body;
}

// ---------------------------------------------------------------------------
// Fetching + extracting one Canvas file's content — shared by the
// single-link-paste feature (addClassMaterialFromUrlAction) and the bulk
// materials sync. Split into stages so the sync engine can fetch metadata
// once during discovery (to decide, via updated_at, whether a resync is
// even needed) without paying for a download+extraction it might skip.
// ---------------------------------------------------------------------------

// Defined in lecture-notes.ts (a dependency-free module) so the upload-token
// route can use it without pulling this file's PDF parsing into its bundle.
export { MAX_DOCUMENT_FILE_BYTES };

export async function fetchCanvasFileMeta(cfg: CanvasConfig, fileId: string): Promise<CanvasFile> {
  const res = await canvasFetchWithRetry(`${cfg.baseUrl.replace(/\/$/, "")}/api/v1/files/${fileId}`, cfg.token);
  if (res.status === 404) throw new CanvasApiError(404, "Couldn't find that file in Canvas. Check the link and try again.");
  if (!res.ok) throw new CanvasApiError(res.status, `Canvas returned an error (${res.status}) looking up that file.`);
  return res.json();
}

/**
 * meta.url is a short-lived, pre-signed download link Canvas issues
 * per-request — it's directly fetchable and does NOT take the API bearer
 * token (it's typically backed by S3-style query-signed auth, which an
 * extra Authorization header can actually break).
 */
export async function downloadCanvasFile(meta: CanvasFile): Promise<Buffer> {
  let fileRes: Response;
  try {
    fileRes = await fetch(meta.url, { signal: AbortSignal.timeout(CANVAS_TIMEOUT_MS) });
  } catch {
    throw new Error("Couldn't download that file from Canvas.");
  }
  if (!fileRes.ok) throw new Error("Couldn't download that file from Canvas.");
  return Buffer.from(await fileRes.arrayBuffer());
}

export async function extractCanvasFileContent(meta: CanvasFile, buffer: Buffer): Promise<string> {
  const contentType = meta["content-type"] || "";
  let content: string | null;
  try {
    content = await extractDocumentText(buffer, contentType, meta.display_name);
  } catch (err) {
    console.error("Canvas file text extraction failed:", err);
    throw new Error("Couldn't read that file — it might be corrupted or password-protected.");
  }
  if (content === null) {
    const ext = meta.display_name.split(".").pop()?.toUpperCase();
    throw new Error(`Can't read ${ext ? `${ext} files` : "that file"} yet — try pasting the text directly instead.`);
  }
  if (content.trim().length < 20) {
    throw new Error(
      "Couldn't find readable text in that file — it might be scanned images. Try pasting the text directly instead."
    );
  }
  return content;
}

/** Metadata → download → extract, in one call. Used by the single-link-paste path. */
export async function fetchCanvasFileContent(cfg: CanvasConfig, fileId: string): Promise<{ title: string; content: string }> {
  const meta = await fetchCanvasFileMeta(cfg, fileId);
  if (meta.locked_for_user) throw new Error("That file is locked in Canvas, so it can't be read yet.");
  if (meta.size > MAX_DOCUMENT_FILE_BYTES) throw new Error("That file is too large to read.");
  const buffer = await downloadCanvasFile(meta);
  const content = await extractCanvasFileContent(meta, buffer);
  return { title: meta.display_name, content };
}
