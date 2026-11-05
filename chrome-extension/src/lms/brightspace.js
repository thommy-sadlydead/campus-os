// D2L Brightspace, read through its documented REST API (Valence) with the
// student's own browser session: the same requests Brightspace's own pages
// make. Nothing here is specific to one school: the API versions come from
// the site itself (/d2l/api/versions/), and anything a site doesn't offer
// or lets this student see is reported, not guessed.
//
// The map* functions are pure, so they're tested on their own
// (tests/extension-brightspace.test.ts).

import { NotSupportedError, LmsHttpError, SessionError, contentTypeFor, filenameFromPath, isExamLikeName, isoOrNull, mapLimit } from "./common.js";

const DAY = 24 * 60 * 60 * 1000;

/** The newest version of a product (lp, le) the site supports, from /d2l/api/versions/. */
export function pickVersion(versions, product) {
  const entry = (Array.isArray(versions) ? versions : []).find((v) => String(v.ProductCode).toLowerCase() === product);
  return entry?.LatestVersion ? String(entry.LatestVersion) : null;
}

const NOT_COURSES = /^(organization|semester|department|faculty|group|section|template)$/i;

/**
 * The student's courses from myenrollments. Course offerings are type 3 by
 * default, but sites can rename types, so a site with none found that way
 * falls back to anything that isn't clearly not a course.
 */
export function mapEnrollments(items) {
  const accessible = (items ?? []).filter((i) => i?.OrgUnit && i.Access?.CanAccess !== false && i.Access?.IsActive !== false);
  let courses = accessible.filter((i) => /course offering/i.test(i.OrgUnit.Type?.Code ?? "") || i.OrgUnit.Type?.Id === 3);
  if (courses.length === 0) courses = accessible.filter((i) => !NOT_COURSES.test(i.OrgUnit.Type?.Code ?? ""));
  return courses.map((i) => ({
    id: String(i.OrgUnit.Id),
    name: String(i.OrgUnit.Name ?? "").trim() || `Course ${i.OrgUnit.Id}`,
    code: String(i.OrgUnit.Code ?? "").trim(),
  }));
}

/** What the gradebook says about each grade item: whether it has a grade yet. */
export function gradedItemIds(gradeValues) {
  return new Set(
    (Array.isArray(gradeValues) ? gradeValues : [])
      .filter((g) => g && g.PointsNumerator !== null && g.PointsNumerator !== undefined)
      .map((g) => String(g.GradeObjectIdentifier))
  );
}

/** "submitted" / "graded" / "unsubmitted" from a folder's mysubmissions. */
export function submissionFromEntities(entities) {
  const list = Array.isArray(entities) ? entities : [];
  if (list.some((e) => e.Status === 3)) return "graded";
  if (list.some((e) => e.Status === 1 || (e.Submissions?.length ?? 0) > 0)) return "submitted";
  return "unsubmitted";
}

/** Assignments from dropbox folders and quizzes. */
export function mapWork({ origin, orgUnitId, folders, quizzes, graded, submissions }) {
  const ou = encodeURIComponent(orgUnitId);
  const fromFolders = (folders ?? [])
    .filter((f) => f && !f.IsHidden)
    .map((f) => {
      const gradedNow = f.GradeItemId != null && graded?.has(String(f.GradeItemId));
      const checked = submissions?.get(String(f.Id));
      return {
        id: `dropbox:${f.Id}`,
        name: String(f.Name ?? "").trim() || "Assignment",
        description: f.CustomInstructions?.Html || f.CustomInstructions?.Text || null,
        dueAt: isoOrNull(f.DueDate) ?? isoOrNull(f.Availability?.EndDate),
        pointsPossible: typeof f.Assessment?.ScoreDenominator === "number" ? f.Assessment.ScoreDenominator : null,
        url: `${origin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${encodeURIComponent(f.Id)}&ou=${ou}`,
        submission: gradedNow ? "graded" : checked ?? null,
        tracksSubmissions: true,
        isExam: isExamLikeName(String(f.Name ?? "")),
      };
    });
  const fromQuizzes = (quizzes ?? [])
    .filter((q) => q && q.IsActive !== false)
    .map((q) => ({
      id: `quiz:${q.QuizId}`,
      name: String(q.Name ?? "").trim() || "Quiz",
      description: q.Description?.Text?.Html || q.Description?.Text?.Text || q.Instructions?.Text?.Html || null,
      dueAt: isoOrNull(q.DueDate) ?? isoOrNull(q.EndDate),
      pointsPossible: null,
      url: `${origin}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${encodeURIComponent(q.QuizId)}&ou=${ou}`,
      // Brightspace doesn't list a student's attempts in one request, so a
      // quiz is only known as done once it has a grade.
      submission: q.GradeItemId != null && graded?.has(String(q.GradeItemId)) ? "graded" : null,
      tracksSubmissions: false,
      isExam: isExamLikeName(String(q.Name ?? "")),
    }));
  return [...fromFolders, ...fromQuizzes];
}

/**
 * The course's materials from its table of contents. Files and HTML pages
 * are read from the content API; links out of Brightspace are recorded as
 * links; hidden, locked and broken topics, and links to Brightspace's own
 * tools (quizzes, discussions), are left out.
 */
export function mapToc(toc, { origin, orgUnitId, le }) {
  const resources = [];
  const downloads = new Map();
  const ou = encodeURIComponent(orgUnitId);
  const walk = (modules) => {
    for (const m of modules ?? []) {
      for (const t of m.Topics ?? []) {
        if (!t || t.IsBroken || t.IsHidden || t.IsLocked) continue;
        const resourceId = `topic:${t.TopicId}`;
        const title = String(t.Title ?? "").trim() || "Untitled";
        const type = String(t.TypeIdentifier ?? "").toLowerCase();
        const url = String(t.Url ?? "");
        if (type === "link") {
          let target;
          try {
            target = new URL(url, origin);
          } catch {
            continue;
          }
          if (target.origin === origin || !/^https?:$/.test(target.protocol)) continue;
          resources.push({ resourceId, resourceType: "external", title, filename: "", updatedAt: null, sourceUrl: target.toString() });
          continue;
        }
        if (type !== "file") continue;
        const filename = filenameFromPath(url) || title;
        const isPage = /\.html?$/i.test(filename);
        resources.push({
          resourceId,
          resourceType: isPage ? "page" : "file",
          title,
          filename,
          contentType: contentTypeFor(filename),
          updatedAt: isoOrNull(t.LastModifiedDate),
          sourceUrl: `${origin}/d2l/le/content/${ou}/viewContent/${encodeURIComponent(t.TopicId)}/View`,
        });
        downloads.set(resourceId, `/d2l/api/le/${le}/${ou}/content/topics/${encodeURIComponent(t.TopicId)}/file`);
      }
      walk(m.Modules);
    }
  };
  walk(toc?.Modules);
  return { resources, downloads };
}

/** A reader for one Brightspace site, on top of makeLmsFetch. */
export function brightspaceReader(lms, { now = () => new Date() } = {}) {
  let lp = null;
  let le = null;

  async function connect() {
    let versions;
    try {
      versions = await lms.json("/d2l/api/versions/");
    } catch (err) {
      if (err instanceof SessionError) throw err;
      throw new NotSupportedError("This doesn't look like a Brightspace site, or it doesn't offer Brightspace's API.");
    }
    lp = pickVersion(versions, "lp");
    le = pickVersion(versions, "le");
    if (!lp || !le) throw new NotSupportedError("This Brightspace site doesn't list the API versions the extension needs.");
    let me;
    try {
      me = await lms.json(`/d2l/api/lp/${lp}/users/whoami`);
    } catch (err) {
      if (err instanceof LmsHttpError && err.status === 403) throw new SessionError();
      throw err;
    }
    return { userName: [me.FirstName, me.LastName].filter(Boolean).join(" ") || me.UniqueName || null };
  }

  async function listCourses() {
    const items = [];
    let bookmark = "";
    for (let page = 0; page < 50; page++) {
      const body = await lms.json(
        `/d2l/api/lp/${lp}/enrollments/myenrollments/?isActive=true&canAccess=true${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`
      );
      items.push(...(body.Items ?? []));
      if (!body.PagingInfo?.HasMoreItems || !body.PagingInfo?.Bookmark) break;
      bookmark = body.PagingInfo.Bookmark;
    }
    return mapEnrollments(items);
  }

  /** A request that may be turned off for the course (403) or missing (404): null instead of an error. */
  async function optional(path) {
    try {
      return await lms.json(path);
    } catch (err) {
      if (err instanceof LmsHttpError && (err.status === 403 || err.status === 404)) return null;
      throw err;
    }
  }

  async function quizzesFor(ou) {
    const all = [];
    let path = `/d2l/api/le/${le}/${ou}/quizzes/`;
    for (let page = 0; path && page < 30; page++) {
      const body = await optional(path);
      if (!body) return page === 0 ? null : all;
      all.push(...(body.Objects ?? []));
      path = body.Next ? new URL(body.Next, lms.origin).pathname + new URL(body.Next, lms.origin).search : null;
    }
    return all;
  }

  /** A course's assignments, quizzes and their status. Null work (with a problem) when none of it could be read. */
  async function courseWork(course) {
    const ou = encodeURIComponent(course.id);
    const [folders, quizzes, grades] = await Promise.all([
      optional(`/d2l/api/le/${le}/${ou}/dropbox/folders/`),
      quizzesFor(ou),
      optional(`/d2l/api/le/${le}/${ou}/grades/values/myGradeValues/`),
    ]);
    if (folders === null && quizzes === null) {
      return { assignments: null, exams: [], problem: "Brightspace didn't let the extension read this course's assignments or quizzes." };
    }
    // Turned-in status only for work around now (a week back to a month
    // out): one request per assignment, like Schoology's.
    const t = now().getTime();
    const current = (folders ?? []).filter((f) => {
      const due = Date.parse(f.DueDate ?? f.Availability?.EndDate ?? "");
      return !Number.isNaN(due) && due > t - 7 * DAY && due < t + 30 * DAY && !f.IsHidden;
    });
    const submissions = new Map();
    await mapLimit(current, 3, async (f) => {
      const body = await optional(`/d2l/api/le/${le}/${ou}/dropbox/folders/${encodeURIComponent(f.Id)}/submissions/mysubmissions/`);
      if (body) submissions.set(String(f.Id), submissionFromEntities(body));
    });
    return {
      assignments: mapWork({ origin: lms.origin, orgUnitId: course.id, folders, quizzes, graded: gradedItemIds(grades), submissions }),
      exams: [],
      problem: folders === null ? "Brightspace didn't let the extension read this course's assignments." : null,
    };
  }

  async function courseMaterials(course) {
    const toc = await optional(`/d2l/api/le/${le}/${encodeURIComponent(course.id)}/content/toc`);
    if (!toc) return { resources: [], downloads: new Map(), complete: false, problem: "Brightspace didn't let the extension read this course's content." };
    return { ...mapToc(toc, { origin: lms.origin, orgUnitId: course.id, le }), complete: true, problem: null };
  }

  return { provider: "brightspace", connect, listCourses, courseWork, courseMaterials };
}
