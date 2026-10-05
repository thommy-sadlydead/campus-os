// Canvas course/assignment sync — used by both the standalone CLI script
// (scripts/sync-canvas.ts, for cron jobs / anyone who prefers env vars)
// and the in-app "Connect Canvas" / "Sync now" server actions
// (src/app/connect/canvas/actions.ts). One implementation so the two paths
// can't drift apart. Deliberately not "server only" since the CLI script
// isn't part of the Next.js request lifecycle (see the same note in
// canvas.ts).
//
// This file turns Canvas's data into the shared LmsCourseInput shape; the
// writing (per-account identity, status rules) is src/lib/lms/apply.ts,
// the same for every LMS.
//
// Takes a PrismaClient as a parameter rather than importing the app's
// singleton (src/lib/prisma.ts) — the CLI script uses its own short-lived
// client instead of that dev-mode-cached singleton.

import type { PrismaClient } from "@prisma/client";
import {
  canvasSubmissionState,
  canvasTracksSubmissions,
  describeCanvasCourseError,
  fetchActiveCourses,
  fetchCourseAssignments,
  fetchCourseCalendarEvents,
  fetchPendingCourses,
  type CanvasAssignment,
  type CanvasCalendarEvent,
  type CanvasConfig,
} from "./canvas";
import { applyLmsCourses, type LmsAssignmentInput, type LmsCourseInput, type LmsExamInput } from "./lms/apply";
import { calendarOnlyExams, isExamLikeName } from "./lms/exams";
import { emptyReport, type SyncReport } from "./lms/report";

const DAY_MS = 24 * 60 * 60 * 1000;

function toAssignmentInput(a: CanvasAssignment): LmsAssignmentInput {
  return {
    id: String(a.id),
    name: a.name,
    description: a.description,
    dueAt: a.due_at ? new Date(a.due_at) : null,
    pointsPossible: a.points_possible,
    url: a.html_url || null,
    submission: canvasSubmissionState(a),
    tracksSubmissions: canvasTracksSubmissions(a),
    isExam: isExamLikeName(a.name),
  };
}

/** In-class exams professors put on the course calendar, by course id. Best-effort: a failure just means none. */
async function calendarExamsByCourse(
  cfg: CanvasConfig,
  courseIds: number[],
  now: Date
): Promise<Map<string, LmsExamInput[]>> {
  const byCourse = new Map<string, LmsExamInput[]>();
  if (courseIds.length === 0) return byCourse;
  let events: CanvasCalendarEvent[];
  try {
    events = await fetchCourseCalendarEvents(cfg, courseIds, new Date(now.getTime() - 30 * DAY_MS), new Date(now.getTime() + 300 * DAY_MS));
  } catch (err) {
    console.error("Canvas calendar exams couldn't be loaded:", err);
    return byCourse;
  }
  for (const event of events) {
    const courseId = event.context_code.match(/^course_(\d+)$/)?.[1];
    if (!courseId || event.workflow_state === "deleted" || !isExamLikeName(event.title)) continue;
    const list = byCourse.get(courseId) ?? [];
    list.push({
      id: `event:${event.id}`,
      name: event.title,
      examAt: event.start_at ? new Date(event.start_at) : null,
      location: event.location_name || null,
      url: event.html_url || null,
    });
    byCourse.set(courseId, list);
  }
  return byCourse;
}

/**
 * Syncs every current Canvas course into the student's own classes and
 * reports what it found. Throws only when Canvas won't list the courses
 * at all (a bad token or address); a problem with one course is in the
 * report and the rest still sync.
 */
export async function syncCanvasForUser(
  prisma: PrismaClient,
  userId: string,
  cfg: CanvasConfig,
  now: Date = new Date()
): Promise<SyncReport> {
  const report = emptyReport("canvas", now);
  const courses = await fetchActiveCourses(cfg);

  const open = courses.filter((c) => c.name && !c.access_restricted_by_date);
  for (const course of courses) {
    if (open.includes(course)) continue;
    report.skipped.push({
      name: course.name || course.course_code || `Canvas course ${course.id}`,
      reason: "Canvas isn't showing this course to students right now. It usually opens when the term starts.",
    });
  }

  try {
    for (const course of await fetchPendingCourses(cfg)) {
      if (courses.some((c) => c.id === course.id)) continue;
      report.skipped.push({
        name: course.name || course.course_code || `Canvas course ${course.id}`,
        reason: "You haven't accepted the invitation to this course in Canvas yet. Accept it there, then sync again.",
      });
    }
  } catch (err) {
    console.error("Canvas pending courses couldn't be loaded:", err);
  }

  const calendarExams = await calendarExamsByCourse(cfg, open.map((c) => c.id), now);

  const inputs: LmsCourseInput[] = [];
  for (const course of open) {
    let assignments: LmsAssignmentInput[] | null = null;
    let problem: string | null = null;
    try {
      assignments = (await fetchCourseAssignments(cfg, course.id)).map(toAssignmentInput);
    } catch (err) {
      console.error(`Canvas assignments couldn't be loaded for course ${course.id}:`, err);
      problem = describeCanvasCourseError(err);
    }
    const examNames = (assignments ?? []).filter((a) => a.isExam).map((a) => a.name);
    inputs.push({
      id: String(course.id),
      name: course.name as string,
      code: course.course_code ?? "",
      assignments,
      exams: calendarOnlyExams(calendarExams.get(String(course.id)) ?? [], examNames),
      problem,
    });
  }

  const applied = await applyLmsCourses(prisma, userId, "canvas", inputs, now);
  report.classes = applied.classes;
  report.reopened = applied.reopened;
  report.finishedAt = new Date().toISOString();
  return report;
}
