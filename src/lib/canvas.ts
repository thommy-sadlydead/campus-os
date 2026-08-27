// Minimal Canvas LMS REST client. Used by scripts/sync-canvas.ts (and,
// later, an in-app "sync now" server action). Deliberately not "server
// only" since the standalone sync script isn't part of the Next.js
// request lifecycle.

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

async function canvasGet<T>(cfg: CanvasConfig, path: string): Promise<T> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    // Canvas data changes slowly enough that per-request caching isn't a concern here.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Canvas API ${path} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchActiveCourses(cfg: CanvasConfig): Promise<CanvasCourse[]> {
  return canvasGet<CanvasCourse[]>(
    cfg,
    "/api/v1/courses?enrollment_state=active&per_page=100"
  );
}

export async function fetchCourseAssignments(
  cfg: CanvasConfig,
  courseId: number
): Promise<CanvasAssignment[]> {
  const all: CanvasAssignment[] = [];
  let page = 1;
  // Canvas paginates at up to 100/page; loop until a short page tells us we're done.
  // (Canvas also returns a `Link` header for proper cursoring, but page-counting
  // is simpler and fine at this data volume — a semester's assignments.)
  for (;;) {
    const batch = await canvasGet<CanvasAssignment[]>(
      cfg,
      `/api/v1/courses/${courseId}/assignments?per_page=100&page=${page}&order_by=due_at&include[]=submission`
    );
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return all;
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
