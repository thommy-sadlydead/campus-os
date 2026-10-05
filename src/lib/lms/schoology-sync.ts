// Schoology course/assignment sync: turns a student's Schoology sections,
// grade items (assignments, tests/quizzes, graded discussions), grades and
// calendar into the shared LmsCourseInput shape for applyLmsCourses
// (src/lib/lms/apply.ts), the same writer every LMS uses.
//
// What Schoology says about the student's own work:
// - Graded (or excused) comes from the gradebook, one request per section.
// - Turned in but not graded yet needs one request per assignment (its
//   dropbox), so it's only checked for work that's current: due from a week
//   ago to a month out, or undated, and capped per sync to stay within
//   Schoology's rate limit. Everything else keeps the student's own status.
//
// Takes a PrismaClient as a parameter, like canvas-sync.ts.

import type { PrismaClient } from "@prisma/client";
import { applyLmsCourses, type LmsAssignmentInput, type LmsCourseInput, type LmsExamInput } from "@/lib/lms/apply";
import { calendarOnlyExams, isExamLikeName } from "@/lib/lms/exams";
import { emptyReport, type SyncReport } from "@/lib/lms/report";
import type { LmsSubmission } from "@/lib/lms/status";
import {
  describeSchoologyCourseError,
  fetchSchoologyEvents,
  fetchSchoologyGradeItems,
  fetchSchoologyGrades,
  fetchSchoologySections,
  fetchSchoologySubmitted,
  flag,
  num,
  parseSchoologyDate,
  type SchoologyClient,
  type SchoologyGrade,
  type SchoologyGradeItem,
  type SchoologySection,
} from "@/lib/lms/schoology";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Dropbox checks per sync: about 10 seconds of Schoology's rate limit. */
export const SUBMISSION_CHECKS_PER_SYNC = 60;

/** Saved on the connection when it's made (LmsConnection.settings). */
export interface SchoologySettings {
  /** The Schoology account's user id. */
  userId: string;
  /** Its time zone, which Schoology's times are in. */
  timezone: string;
}

/** A section's class name and code, with the section added when a student has two sections of one course. */
export function schoologyClassNames(sections: SchoologySection[]): Map<string, { name: string; code: string }> {
  const base = sections.map((s) => ({
    id: String(s.id),
    name: (s.course_title || s.section_title || `Schoology course ${s.id}`).trim(),
    section: (s.section_title || "").trim(),
    code: (s.course_code || s.section_code || s.section_school_code || "").trim(),
  }));
  const counts = new Map<string, number>();
  for (const s of base) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  return new Map(
    base.map((s) => [s.id, { name: (counts.get(s.name) ?? 0) > 1 && s.section ? `${s.name} (${s.section})` : s.name, code: s.code }])
  );
}

function isGraded(grade: SchoologyGrade | undefined): boolean {
  if (!grade) return false;
  // Exception 1 is "excused" (nothing left to do); 2 is "incomplete".
  if (num(grade.exception) === 1) return true;
  return grade.grade !== null && grade.grade !== undefined && grade.grade !== "";
}

/** The item's page in Schoology. Discussions go to the course's materials, since their page address isn't in the API. */
export function schoologyItemUrl(domain: string, sectionId: string, item: SchoologyGradeItem): string {
  return item.type === "discussion" ? `${domain}/course/${sectionId}/materials` : `${domain}/assignment/${item.id}`;
}

interface SectionWork {
  items: SchoologyGradeItem[];
  grades: Map<string, SchoologyGrade>;
}

/**
 * Syncs every Schoology section the student is in. Throws only when
 * Schoology won't list the sections at all (a bad key); a problem with
 * one section is in the report and the rest still sync.
 */
export async function syncSchoologyForUser(
  prisma: PrismaClient,
  userId: string,
  client: SchoologyClient,
  settings: SchoologySettings,
  now: Date = new Date()
): Promise<SyncReport> {
  const report = emptyReport("schoology", now);
  const tz = settings.timezone;
  const sections = (await fetchSchoologySections(client, settings.userId)).filter((s) => s.active === undefined || flag(s.active));
  const names = schoologyClassNames(sections);

  // Load each section's work first, so the dropbox checks can go to the
  // most urgent work across every class.
  const work = new Map<string, SectionWork | { error: string }>();
  for (const section of sections) {
    const sectionId = String(section.id);
    try {
      const items = (await fetchSchoologyGradeItems(client, sectionId)).filter((i) => i.published === undefined || flag(i.published));
      let grades = new Map<string, SchoologyGrade>();
      try {
        grades = await fetchSchoologyGrades(client, settings.userId, sectionId);
      } catch (err) {
        console.error(`Schoology grades couldn't be loaded for section ${sectionId}:`, err);
      }
      work.set(sectionId, { items, grades });
    } catch (err) {
      console.error(`Schoology grade items couldn't be loaded for section ${sectionId}:`, err);
      work.set(sectionId, { error: describeSchoologyCourseError(err) });
    }
  }

  const submitted = await checkDropboxes(client, settings.userId, work, tz, now);

  const inputs: LmsCourseInput[] = [];
  for (const section of sections) {
    const sectionId = String(section.id);
    const { name, code } = names.get(sectionId)!;
    const loaded = work.get(sectionId);
    if (!loaded || "error" in loaded) {
      inputs.push({ id: sectionId, name, code, assignments: null, exams: [], problem: loaded?.error ?? null });
      continue;
    }

    const assignments: LmsAssignmentInput[] = loaded.items.map((item) => {
      const id = String(item.id);
      let submission: LmsSubmission | null = null;
      if (isGraded(loaded.grades.get(id))) submission = "graded";
      else if (submitted.has(id)) submission = submitted.get(id) ? "submitted" : "unsubmitted";
      return {
        id,
        name: item.title,
        description: item.description || null,
        dueAt: parseSchoologyDate(item.due, tz),
        pointsPossible: num(item.max_points),
        url: schoologyItemUrl(client.domain, sectionId, item),
        submission,
        tracksSubmissions: flag(item.allow_dropbox) && (item.type ?? "assignment") === "assignment",
        isExam: flag(item.is_final) || isExamLikeName(item.title),
      };
    });

    let calendarExams: LmsExamInput[] = [];
    try {
      const events = await fetchSchoologyEvents(client, sectionId, new Date(now.getTime() - 30 * DAY_MS), new Date(now.getTime() + 300 * DAY_MS));
      calendarExams = events
        .filter((e) => (e.type ?? "event") === "event" && isExamLikeName(e.title))
        .map((e) => ({ id: `event:${e.id}`, name: e.title, examAt: parseSchoologyDate(e.start, tz), location: null, url: null }));
    } catch (err) {
      console.error(`Schoology events couldn't be loaded for section ${sectionId}:`, err);
    }

    inputs.push({
      id: sectionId,
      name,
      code,
      assignments,
      exams: calendarOnlyExams(calendarExams, assignments.filter((a) => a.isExam).map((a) => a.name)),
      problem: null,
    });
  }

  const applied = await applyLmsCourses(prisma, userId, "schoology", inputs, now);
  report.classes = applied.classes;
  report.reopened = applied.reopened;
  if (applied.checkedOff > 0) report.checkedOff = applied.checkedOff;
  report.finishedAt = new Date().toISOString();
  return report;
}

/**
 * Checks the dropbox of current work that isn't graded yet: due from a
 * week ago on, soonest first, up to SUBMISSION_CHECKS_PER_SYNC. Returns
 * grade item id → turned in or not; items it didn't check aren't in it.
 */
async function checkDropboxes(
  client: SchoologyClient,
  userId: string,
  work: Map<string, SectionWork | { error: string }>,
  tz: string,
  now: Date
): Promise<Map<string, boolean>> {
  const candidates: { sectionId: string; id: string; due: number }[] = [];
  for (const [sectionId, loaded] of work) {
    if ("error" in loaded) continue;
    for (const item of loaded.items) {
      const id = String(item.id);
      if (!flag(item.allow_dropbox) || (item.type ?? "assignment") !== "assignment" || isGraded(loaded.grades.get(id))) continue;
      const due = parseSchoologyDate(item.due, tz)?.getTime() ?? Number.POSITIVE_INFINITY;
      const undated = !Number.isFinite(due);
      if (!undated && (due < now.getTime() - 7 * DAY_MS || due > now.getTime() + 30 * DAY_MS)) continue;
      candidates.push({ sectionId, id, due });
    }
  }
  candidates.sort((a, b) => a.due - b.due);

  const result = new Map<string, boolean>();
  for (const c of candidates.slice(0, SUBMISSION_CHECKS_PER_SYNC)) {
    try {
      result.set(c.id, await fetchSchoologySubmitted(client, c.sectionId, c.id, userId));
    } catch (err) {
      // Not knowing is fine: the student's own status stays.
      console.error(`Schoology dropbox check failed for item ${c.id}:`, err);
    }
  }
  return result;
}
