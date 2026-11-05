// Blackboard Learn, read through its documented REST API
// (/learn/api/public/...) with the student's own browser session. Works
// for Ultra and Original course views, as long as the site is new enough
// to have the REST API (Learn 9.1 Q4 2017 / 3000 and later). Endpoint
// versions vary between sites, so each read tries the newest version first
// and falls back to older ones; anything a site doesn't offer, or doesn't
// let this student see, is reported instead of guessed.
//
// The map* functions are pure, so they're tested on their own
// (tests/extension-blackboard.test.ts).

import { NotSupportedError, LmsHttpError, SessionError, contentTypeFor, isExamLikeName, isoOrNull, mapLimit } from "./common.js";

const CONTAINER = new Set(["resource/x-bb-folder", "resource/x-bb-lesson", "resource/x-bb-module-page"]);
const EXTERNAL_LINK = "resource/x-bb-externallink";
/** Items whose body is readable text (a document, an item, a blank page). */
const PAGE_LIKE = new Set(["resource/x-bb-document", "resource/x-bb-blankpage", "resource/x-bb-item"]);
/** Items that can carry attached files. */
const WITH_ATTACHMENTS = new Set([
  "resource/x-bb-file",
  "resource/x-bb-document",
  "resource/x-bb-blankpage",
  "resource/x-bb-item",
  "resource/x-bb-assignment",
  "resource/x-bb-asmt-test-link",
]);
const MAX_NODES = 1500;
const MAX_DEPTH = 8;

/** Text inside HTML, roughly, to tell an empty body from a real one. */
export function visibleTextLength(html) {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

const hidden = (availability) => String(availability?.available ?? "").toLowerCase() === "no";

/** The student's courses from their memberships (with `expand=course`, or looked up one by one). */
export function mapMemberships(memberships, coursesById = new Map()) {
  return (memberships ?? [])
    .filter((m) => m && !hidden(m.availability))
    .map((m) => ({ membership: m, course: m.course ?? coursesById.get(m.courseId) }))
    .filter(({ course }) => course && !hidden(course.availability))
    .map(({ course }) => ({
      id: String(course.id),
      name: String(course.name ?? "").trim() || String(course.courseId ?? course.id),
      code: String(course.courseId ?? "").trim(),
      url: course.externalAccessUrl ? String(course.externalAccessUrl) : null,
    }));
}

/** "graded" / "submitted" / "unsubmitted" from a gradebook entry. */
export function submissionFromGrade(grade) {
  if (!grade) return "unsubmitted";
  if (grade.exempt || String(grade.status).toLowerCase() === "graded" || (grade.score !== null && grade.score !== undefined)) return "graded";
  if (String(grade.status).toLowerCase() === "needsgrading") return "submitted";
  return "unsubmitted";
}

/**
 * Assignments from gradebook columns: the ones students submit (Attempts)
 * or that have a due date. Calculated columns (totals) aren't work.
 */
export function mapColumns(columns, { courseUrl, grades }) {
  return (columns ?? [])
    .filter((c) => c && !hidden(c.availability))
    .filter((c) => String(c.grading?.type ?? "").toLowerCase() !== "calculated")
    .filter((c) => String(c.grading?.type ?? "").toLowerCase() === "attempts" || c.grading?.due)
    .map((c) => {
      const name = String(c.displayName ?? c.name ?? "").trim() || "Assignment";
      const tracks = String(c.grading?.type ?? "").toLowerCase() === "attempts";
      return {
        id: `column:${c.id}`,
        name,
        description: c.description || null,
        dueAt: isoOrNull(c.grading?.due),
        pointsPossible: typeof c.score?.possible === "number" ? c.score.possible : null,
        url: courseUrl,
        // Only when the gradebook could be read; otherwise unknown.
        submission: grades ? submissionFromGrade(grades.get(String(c.id))) : null,
        tracksSubmissions: tracks,
        isExam: isExamLikeName(name),
      };
    });
}

/** What to do with one content item: open it (a folder), record it, read its body, look for attachments. */
export function contentPlan(item) {
  const handler = String(item?.contentHandler?.id ?? "");
  return {
    container: CONTAINER.has(handler) || (item?.hasChildren === true && !WITH_ATTACHMENTS.has(handler)),
    externalUrl: handler === EXTERNAL_LINK ? item?.contentHandler?.url ?? null : null,
    page: PAGE_LIKE.has(handler) && visibleTextLength(item?.body) >= 20,
    attachments: WITH_ATTACHMENTS.has(handler),
  };
}

/** A reader for one Blackboard site, on top of makeLmsFetch. */
export function blackboardReader(lms) {
  let me = null;

  async function connect() {
    try {
      me = await lms.json("/learn/api/public/v1/users/me");
    } catch (err) {
      if (err instanceof SessionError) throw err;
      if (err instanceof LmsHttpError && err.status === 403) throw new SessionError();
      throw new NotSupportedError("This doesn't look like a Blackboard Learn site, or it doesn't offer Blackboard's REST API.");
    }
    if (!me?.id) throw new SessionError();
    const name = [me.name?.given, me.name?.family].filter(Boolean).join(" ");
    return { userName: name || me.userName || null };
  }

  /** Every page of a results list, following paging.nextPage. */
  async function allPages(path, limit = 40) {
    const results = [];
    let next = path;
    for (let page = 0; next && page < limit; page++) {
      const body = await lms.json(next);
      results.push(...(body.results ?? []));
      next = body.paging?.nextPage ?? null;
    }
    return results;
  }

  /** The first path that works, newest API version first; null when the site has none of them. */
  async function firstWorking(paths, read = allPages) {
    for (const path of paths) {
      try {
        return await read(path);
      } catch (err) {
        if (err instanceof LmsHttpError && (err.status === 404 || err.status === 400)) continue;
        if (err instanceof LmsHttpError && err.status === 403) return null;
        throw err;
      }
    }
    return null;
  }

  async function listCourses() {
    const userId = encodeURIComponent(me.id);
    const memberships = await firstWorking([
      `/learn/api/public/v1/users/${userId}/courses?expand=course&limit=100`,
      `/learn/api/public/v1/users/${userId}/courses?limit=100`,
    ]);
    if (!memberships) throw new NotSupportedError("Blackboard didn't let the extension list your courses.");
    const missing = memberships.filter((m) => !m.course).map((m) => m.courseId);
    const coursesById = new Map();
    await mapLimit(missing, 4, async (id) => {
      const course = await firstWorking(
        ["v3", "v2", "v1"].map((v) => `/learn/api/public/${v}/courses/${encodeURIComponent(id)}`),
        (p) => lms.json(p)
      );
      if (course) coursesById.set(id, course);
    });
    return mapMemberships(memberships, coursesById);
  }

  function courseLink(course) {
    return course.url || `${lms.origin}/webapps/blackboard/execute/launcher?type=Course&id=${encodeURIComponent(course.id)}&url=`;
  }

  async function courseWork(course) {
    const id = encodeURIComponent(course.id);
    const columns = await firstWorking([
      `/learn/api/public/v2/courses/${id}/gradebook/columns?limit=200`,
      `/learn/api/public/v1/courses/${id}/gradebook/columns?limit=200`,
    ]);
    if (!columns) return { assignments: null, exams: [], problem: "Blackboard didn't let the extension read this course's gradebook, where its assignments are." };
    const gradeRows = await firstWorking([
      `/learn/api/public/v2/courses/${id}/gradebook/users/${encodeURIComponent(me.id)}`,
      `/learn/api/public/v1/courses/${id}/gradebook/users/${encodeURIComponent(me.id)}`,
    ]);
    const grades = gradeRows ? new Map(gradeRows.map((g) => [String(g.columnId), g])) : null;
    return { assignments: mapColumns(columns, { courseUrl: courseLink(course), grades }), exams: [], problem: null };
  }

  async function courseMaterials(course) {
    const id = encodeURIComponent(course.id);
    const base = `/learn/api/public/v1/courses/${id}/contents`;
    const top = await firstWorking([`${base}?limit=200`]);
    if (!top) return { resources: [], downloads: new Map(), complete: false, problem: "Blackboard didn't let the extension read this course's content." };

    // Breadth first, a few folders at a time, with a cap on size and depth.
    // Anything left unread makes the list incomplete, so the app doesn't
    // take files it didn't reach as deleted.
    let complete = true;
    const items = [];
    let level = top.map((item) => ({ item, depth: 0 }));
    while (level.length > 0 && items.length < MAX_NODES) {
      items.push(...level.map((l) => l.item));
      const folders = level.filter((l) => contentPlan(l.item).container && l.depth < MAX_DEPTH);
      if (level.some((l) => contentPlan(l.item).container && l.depth >= MAX_DEPTH)) complete = false;
      const children = await mapLimit(folders, 4, async ({ item, depth }) => {
        const kids = await firstWorking([`${base}/${encodeURIComponent(item.id)}/children?limit=200`]);
        if (kids === null) complete = false;
        return (kids ?? []).map((k) => ({ item: k, depth: depth + 1 }));
      });
      level = children.flat().slice(0, Math.max(0, MAX_NODES - items.length));
    }

    const resources = [];
    const downloads = new Map();
    const link = courseLink(course);
    const visible = items.filter((i) => i && !hidden(i.availability));
    for (const item of visible) {
      const plan = contentPlan(item);
      const title = String(item.title ?? "").trim() || "Untitled";
      if (plan.externalUrl && /^https?:\/\//i.test(plan.externalUrl)) {
        resources.push({ resourceId: `content:${item.id}`, resourceType: "external", title, filename: "", updatedAt: null, sourceUrl: plan.externalUrl });
      } else if (plan.page) {
        resources.push({ resourceId: `content:${item.id}`, resourceType: "page", title, filename: `${title}.html`, contentType: "text/html", updatedAt: isoOrNull(item.modified), sourceUrl: link });
        downloads.set(`content:${item.id}`, { body: String(item.body) });
      }
    }

    const withFiles = visible.filter((i) => contentPlan(i).attachments);
    await mapLimit(withFiles, 4, async (item) => {
      const attachments = await firstWorking([`${base}/${encodeURIComponent(item.id)}/attachments`]);
      if (attachments === null && item.contentHandler?.id === "resource/x-bb-file") complete = false;
      for (const a of attachments ?? []) {
        const filename = String(a.fileName ?? "").trim();
        if (!filename) continue;
        const resourceId = `attachment:${item.id}:${a.id}`;
        const title = (attachments.length === 1 ? String(item.title ?? "").trim() : "") || filename;
        resources.push({
          resourceId,
          resourceType: /\.html?$/i.test(filename) ? "page" : "file",
          title,
          filename,
          contentType: a.mimeType || contentTypeFor(filename),
          updatedAt: isoOrNull(item.modified),
          sourceUrl: link,
        });
        downloads.set(resourceId, `${base}/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(a.id)}/download`);
      }
    });
    const capped = items.length >= MAX_NODES;
    if (capped) complete = false;
    return {
      resources,
      downloads,
      complete,
      problem: capped ? `This course has more than ${MAX_NODES} content items; the first ${MAX_NODES} were read.` : null,
    };
  }

  return { provider: "blackboard", connect, listCourses, courseWork, courseMaterials };
}
