// One sync of a student's chosen courses: read them from the LMS in their
// own browser session, and send what was read to Campus OS. The same steps
// every time (the first import and every later one); Campus OS says which
// files are new or changed, so unchanged ones are never downloaded again.
//
//   1. Check the sign-in, list the student's courses.
//   2. Each chosen course's assignments and quizzes (3 courses at a time),
//      sent together: classes, deadlines and exams appear in Campus OS.
//   3. Each course's materials (2 courses at a time): the list goes to
//      Campus OS, which answers with what to send; those are downloaded
//      and uploaded 3 at a time, in parts for big files.
//   4. Finish: Campus OS marks the sync done (or, if it stopped, how far
//      it got) from what it actually saved.
//
// No chrome.* here: background.js supplies fetch, the API client and a
// progress callback, and tests run it against a stand-in LMS.

import { LmsHttpError, NotSupportedError, SessionError, makeLmsFetch, mapLimit } from "./lms/common.js";
import { brightspaceReader } from "./lms/brightspace.js";
import { blackboardReader } from "./lms/blackboard.js";
import { MAX_PART_BYTES, MAX_UPLOAD_BYTES } from "./api.js";

export function readerFor(provider, lms) {
  if (provider === "brightspace") return brightspaceReader(lms);
  if (provider === "blackboard") return blackboardReader(lms);
  throw new Error(`Unknown LMS: ${provider}`);
}

const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : value);

function cleanResource(r) {
  return {
    resourceId: clip(r.resourceId, 200),
    resourceType: r.resourceType,
    title: clip(r.title, 300) || "Untitled",
    filename: clip(r.filename ?? "", 300),
    ...(r.contentType ? { contentType: clip(r.contentType.split(";")[0].trim(), 150) } : {}),
    ...(typeof r.size === "number" ? { size: r.size } : {}),
    updatedAt: r.updatedAt ?? null,
    sourceUrl: clip(r.sourceUrl ?? "", 2000),
  };
}

function cleanCourse(c, work) {
  return {
    id: clip(c.id, 120),
    name: clip(c.name, 200),
    code: clip(c.code ?? "", 120),
    assignments: work.assignments
      ? work.assignments.map((a) => ({
          ...a,
          id: clip(a.id, 200),
          name: clip(a.name, 300),
          description: clip(a.description, 50_000),
          url: clip(a.url, 2000),
        }))
      : null,
    exams: work.exams ?? [],
    problem: clip(work.problem ?? null, 500),
  };
}

/** Why a file couldn't be downloaded, as the app's failure reasons. */
class DownloadProblem extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

/** The file's bytes, or a DownloadProblem. Never reads more than the app would accept. */
async function download(lms, path, origin) {
  let res;
  try {
    res = await lms.request(path, { accept: "*/*" });
  } catch {
    throw new DownloadProblem("download-failed", "The file couldn't be downloaded. It may be stored on another site.");
  }
  if (res.status === 401) throw new SessionError();
  if (res.status === 403) throw new DownloadProblem("forbidden", "Your account isn't allowed to download this file.");
  if (res.status === 404) throw new DownloadProblem("not-found", "The file is listed but missing.");
  if (!res.ok) throw new DownloadProblem("download-failed", `The site answered ${res.status}.`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES) {
    res.body?.cancel?.();
    throw new DownloadProblem("too-large", `${Math.round(length / 1024 / 1024)} MB`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) throw new DownloadProblem("too-large", `${Math.round(bytes.length / 1024 / 1024)} MB`);
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  let landed = origin;
  try {
    landed = new URL(res.url || path, origin).origin;
  } catch {
    // keep origin
  }
  return { bytes, contentType, landedOnSignIn: contentType === "text/html" && landed === origin };
}

function newUploadId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sends a file or page to Campus OS, in parts when it's big. Resolves to the app's verdict for it. */
async function upload(api, { provider, courseId, resource, bytes }) {
  const parts = Math.max(1, Math.ceil(bytes.length / MAX_PART_BYTES));
  const uploadId = newUploadId();
  let result = null;
  for (let part = 0; part < parts; part++) {
    const slice = bytes.subarray(part * MAX_PART_BYTES, Math.min(bytes.length, (part + 1) * MAX_PART_BYTES));
    result = await api.uploadPart({ provider, courseId, resource, uploadId, part, parts, totalBytes: bytes.length }, slice);
  }
  return result;
}

/**
 * Runs one sync. Resolves to { ok: true, summary } once Campus OS has
 * marked it done, or { ok: false, error, signedOut } when it stopped;
 * never throws. `onProgress` gets a snapshot after every step.
 */
export async function runSync({ provider, origin, courseIds, courseNames = {}, api, fetchImpl = fetch, onProgress = (_snapshot) => {} }) {
  const lms = makeLmsFetch(origin, fetchImpl);
  const reader = readerFor(provider, lms);
  const state = { provider, origin, phase: "connecting", startedAt: new Date().toISOString(), courses: [], error: null };
  const emit = () => onProgress(structuredClone(state));
  const course = (id) => state.courses.find((c) => c.id === id);
  let imported = false;

  try {
    emit();
    await reader.connect();
    state.phase = "courses";
    emit();
    const all = await reader.listCourses();
    const chosen = all.filter((c) => courseIds.includes(c.id));
    const gone = courseIds.filter((id) => !all.some((c) => c.id === id));
    state.courses = chosen.map((c) => ({ id: c.id, name: c.name, phase: "waiting", total: 0, done: 0, failed: 0, problem: null }));
    emit();

    const inputs = await mapLimit(chosen, 3, async (c) => {
      course(c.id).phase = "assignments";
      emit();
      try {
        return cleanCourse(c, await reader.courseWork(c));
      } catch (err) {
        if (err instanceof SessionError) throw err;
        return cleanCourse(c, { assignments: null, exams: [], problem: `Couldn't read this course's assignments (${err.message}).` });
      }
    });
    await api.importCourses({
      provider,
      origin,
      courses: inputs,
      skipped: gone.map((id) => ({
        name: clip(courseNames[id] || "A course you chose before", 200),
        reason: "It's no longer in your course list on this site.",
      })),
    });
    imported = true;
    state.phase = "materials";
    emit();

    await mapLimit(chosen, 2, async (c) => {
      const row = course(c.id);
      row.phase = "listing";
      emit();
      let found;
      try {
        found = await reader.courseMaterials(c);
      } catch (err) {
        if (err instanceof SessionError) throw err;
        // Nothing is sent, so nothing stored is taken as deleted.
        row.phase = "failed";
        row.problem = `Couldn't read this course's materials (${err.message}).`;
        emit();
        return;
      }
      const resources = found.resources.map(cleanResource);
      const plan = await api.planMaterials({ provider, courseId: c.id, resources, problem: found.problem ?? null, complete: found.complete !== false });
      const byId = new Map(resources.map((r) => [r.resourceId, r]));
      row.phase = "importing";
      row.total = plan.toFetch.length;
      row.problem = found.problem ?? null;
      emit();

      await mapLimit(plan.toFetch, 3, async (id) => {
        const resource = byId.get(id);
        const source = found.downloads.get(id);
        if (!resource || source === undefined) return;
        try {
          let bytes;
          let contentType = resource.contentType;
          if (typeof source === "object" && source !== null && "body" in source) {
            bytes = new TextEncoder().encode(source.body);
            contentType = "text/html";
          } else {
            const file = await download(lms, source, origin);
            // An HTML sign-in page instead of a file: check the session before blaming the file.
            if (file.landedOnSignIn && resource.resourceType === "file") {
              await reader.connect();
              throw new DownloadProblem("download-failed", "The site sent a web page instead of the file.");
            }
            bytes = file.bytes;
            contentType = file.contentType || contentType;
          }
          const result = await upload(api, { provider, courseId: c.id, resource: { ...resource, ...(contentType ? { contentType } : {}) }, bytes });
          if (result?.status === "failed") row.failed++;
          else row.done++;
        } catch (err) {
          if (err instanceof SessionError) throw err;
          const reason = err instanceof DownloadProblem ? err.reason : "download-failed";
          await api.failed({ provider, courseId: c.id, resource, reason, message: clip(err.message || "Unknown error.", 300) });
          row.failed++;
        }
        emit();
      });
      row.phase = "done";
      emit();
    });

    state.phase = "finishing";
    emit();
    const result = await api.finish({ provider, origin, stopped: null, message: null });
    state.phase = "done";
    state.summary = result.summary;
    emit();
    return { ok: true, summary: result.summary };
  } catch (err) {
    const signedOut = err instanceof SessionError || (err instanceof LmsHttpError && err.status === 401);
    const message =
      err instanceof SessionError || err instanceof NotSupportedError
        ? err.message
        : err?.name === "ApiError"
          ? err.message
          : `The sync stopped: ${err?.message ?? "unknown error"}.`;
    state.phase = "stopped";
    state.error = message;
    emit();
    if (imported) {
      try {
        await api.finish({ provider, origin, stopped: signedOut ? "signed-out" : "error", message: clip(message, 300) });
      } catch {
        // Campus OS unreachable too; the next sync picks up where this stopped.
      }
    }
    return { ok: false, error: message, signedOut };
  }
}
