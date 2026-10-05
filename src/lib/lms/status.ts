// How a sync decides an assignment's status from what the LMS says about
// the student's own submission. Pure, so it's unit-tested
// (tests/lms-status.test.ts).
//
// The student's own marks win, except where the LMS knows better:
// - The LMS says it's turned in or graded: it's done.
// - The LMS used to say done and now says it isn't (a submission was
//   deleted, or the teacher asked for it again): it's open again.
// - Otherwise the status stays what the student (or an earlier sync) set,
//   so marking something done by hand sticks.
//
// One exception, for rows synced before lmsSubmission was recorded. Until
// October 2026 classmates shared one Assignment row per Canvas assignment,
// so a classmate's submission could have marked a student's own work
// done. When Canvas says this student hasn't turned in something it takes
// submissions for, and it isn't long past due, it's reopened. That
// happens once per row: afterwards lmsSubmission is set.

import type { AssignmentStatus } from "@/lib/assignment-status";

export type LmsSubmission = "unsubmitted" | "submitted" | "graded";

/** How recently due an old, possibly mismarked assignment can be and still get reopened. */
export const LEGACY_REOPEN_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StatusDecisionInput {
  /** The stored assignment, or null for a new one. */
  existing: { status: string; lmsSubmission: string | null } | null;
  /** What the LMS says now; null when it doesn't say (calendar feeds). */
  reported: LmsSubmission | null;
  /** Whether the LMS takes submissions for it, so "unsubmitted" means not turned in (not on paper, say). */
  tracksSubmissions: boolean;
  dueAt: Date | null;
  now: Date;
}

export interface StatusDecision {
  status: AssignmentStatus;
  lmsSubmission: LmsSubmission | null;
  /** True when a done assignment was opened again. */
  reopened: boolean;
}

function isDone(status: string): boolean {
  return status === "SUBMITTED" || status === "GRADED";
}

function asStatus(status: string): AssignmentStatus {
  return status === "IN_PROGRESS" || status === "SUBMITTED" || status === "GRADED" ? status : "NOT_STARTED";
}

function asSubmission(value: string | null): LmsSubmission | null {
  return value === "unsubmitted" || value === "submitted" || value === "graded" ? value : null;
}

export function decideAssignmentStatus(input: StatusDecisionInput): StatusDecision {
  const { existing, reported } = input;

  if (!existing) {
    const status = reported === "graded" ? "GRADED" : reported === "submitted" ? "SUBMITTED" : "NOT_STARTED";
    return { status, lmsSubmission: reported, reopened: false };
  }

  const current = asStatus(existing.status);
  const before = asSubmission(existing.lmsSubmission);

  if (reported === null) return { status: current, lmsSubmission: before, reopened: false };
  if (reported === "graded") return { status: "GRADED", lmsSubmission: "graded", reopened: false };
  if (reported === "submitted") return { status: "SUBMITTED", lmsSubmission: "submitted", reopened: false };

  // The LMS says the student hasn't turned it in.
  if (isDone(current)) {
    const lmsTookItBack = before === "submitted" || before === "graded";
    const stillCurrent = !input.dueAt || input.dueAt.getTime() >= input.now.getTime() - LEGACY_REOPEN_WINDOW_DAYS * DAY_MS;
    const possiblyMismarked = before === null && input.tracksSubmissions && stillCurrent;
    if (lmsTookItBack || possiblyMismarked) {
      return { status: "NOT_STARTED", lmsSubmission: "unsubmitted", reopened: true };
    }
  }
  return { status: current, lmsSubmission: "unsubmitted", reopened: false };
}
