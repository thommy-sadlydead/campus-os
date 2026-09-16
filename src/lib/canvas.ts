// Minimal Canvas LMS REST client. Used by scripts/sync-canvas.ts, the
// in-app "Connect Canvas" / "Sync now" actions, and the Canvas materials
// sync engine (src/lib/canvas-materials-sync.ts). Deliberately not "server
// only" since the standalone sync script isn't part of the Next.js
// request lifecycle.
import { extractDocumentText } from "./office-text";

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  points_possible: number | null;
  html_url: string;
  submission?: { workflow_state?: string };
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

export async function fetchCourseAssignments(cfg: CanvasConfig, courseId: number): Promise<CanvasAssignment[]> {
  return canvasGetAllPages<CanvasAssignment>(
    cfg,
    `/api/v1/courses/${courseId}/assignments?order_by=due_at&include[]=submission`
  );
}

export function isExamLikeName(name: string): boolean {
  return /\b(exam|midterm|final)\b/i.test(name);
}

/**
 * The real Canvas URL for an assignment ("See in Canvas"), built from the
 * course/assignment ids we already store for sync idempotency
 * (Class.canvasCourseId, Assignment.canvasAssignmentId /
 * Exam.canvasAssignmentId) rather than a stored URL — one less field to
 * keep in sync, and Canvas's assignment URL shape
 * (`/courses/:course_id/assignments/:assignment_id`) has been stable for
 * years. Returns null (never a guess) when either id is missing — e.g. an
 * assignment added by hand rather than synced from Canvas.
 */
export function canvasAssignmentUrl(
  canvasCourseId: string | null | undefined,
  canvasAssignmentId: string | null | undefined
): string | null {
  if (!canvasCourseId || !canvasAssignmentId) return null;
  const base = (process.env.CANVAS_BASE_URL || "https://cedarville.instructure.com").replace(/\/$/, "");
  return `${base}/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`;
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

export function canvasSubmissionIsDone(a: CanvasAssignment): boolean {
  const state = a.submission?.workflow_state;
  return state === "submitted" || state === "graded";
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

// Document files can be genuinely large (slide decks with embedded
// images), so this is more generous than a plain-webpage fetch cap — but
// still bounded, since only the extracted *text* matters and that's capped
// separately at MAX_MATERIAL_CONTENT_LENGTH regardless.
export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;

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
