import { describe, it, expect } from "vitest";
import { decideAssignmentStatus, LEGACY_REOPEN_WINDOW_DAYS, type StatusDecisionInput } from "../src/lib/lms/status";

const NOW = new Date("2026-10-05T16:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function decide(overrides: Partial<StatusDecisionInput>) {
  return decideAssignmentStatus({
    existing: null,
    reported: null,
    tracksSubmissions: true,
    dueAt: new Date(NOW.getTime() + 2 * DAY),
    now: NOW,
    ...overrides,
  });
}

describe("decideAssignmentStatus for a new assignment", () => {
  it("starts graded, submitted or not started from what the LMS says", () => {
    expect(decide({ reported: "graded" })).toEqual({ status: "GRADED", lmsSubmission: "graded", reopened: false });
    expect(decide({ reported: "submitted" })).toEqual({ status: "SUBMITTED", lmsSubmission: "submitted", reopened: false });
    expect(decide({ reported: "unsubmitted" })).toEqual({ status: "NOT_STARTED", lmsSubmission: "unsubmitted", reopened: false });
  });

  it("starts not started when the LMS doesn't say (a calendar feed)", () => {
    expect(decide({ reported: null })).toEqual({ status: "NOT_STARTED", lmsSubmission: null, reopened: false });
  });
});

describe("decideAssignmentStatus for a stored assignment", () => {
  it("marks it done when the LMS says it was turned in or graded", () => {
    const existing = { status: "IN_PROGRESS", lmsSubmission: "unsubmitted" };
    expect(decide({ existing, reported: "submitted" }).status).toBe("SUBMITTED");
    expect(decide({ existing, reported: "graded" }).status).toBe("GRADED");
  });

  it("keeps the student's own progress when the LMS says it isn't turned in yet", () => {
    for (const status of ["NOT_STARTED", "IN_PROGRESS"]) {
      expect(decide({ existing: { status, lmsSubmission: "unsubmitted" }, reported: "unsubmitted" })).toEqual({
        status,
        lmsSubmission: "unsubmitted",
        reopened: false,
      });
    }
  });

  it("keeps a done mark the student made by hand", () => {
    // The LMS said "unsubmitted" before the student checked it off: their mark sticks.
    const result = decide({ existing: { status: "SUBMITTED", lmsSubmission: "unsubmitted" }, reported: "unsubmitted" });
    expect(result).toEqual({ status: "SUBMITTED", lmsSubmission: "unsubmitted", reopened: false });
  });

  it("reopens it when the LMS takes back a submission it reported", () => {
    const result = decide({ existing: { status: "SUBMITTED", lmsSubmission: "submitted" }, reported: "unsubmitted" });
    expect(result).toEqual({ status: "NOT_STARTED", lmsSubmission: "unsubmitted", reopened: true });
    expect(decide({ existing: { status: "GRADED", lmsSubmission: "graded" }, reported: "unsubmitted" }).reopened).toBe(true);
  });

  it("changes nothing when the LMS doesn't say", () => {
    const existing = { status: "SUBMITTED", lmsSubmission: null };
    expect(decide({ existing, reported: null })).toEqual({ status: "SUBMITTED", lmsSubmission: null, reopened: false });
  });

  it("ignores a status value it doesn't know", () => {
    expect(decide({ existing: { status: "DONE?", lmsSubmission: null }, reported: null }).status).toBe("NOT_STARTED");
  });
});

describe("decideAssignmentStatus for rows synced before lmsSubmission was recorded", () => {
  // Classmates used to share one row per Canvas assignment, so a
  // classmate's submission could have marked this student's work done.
  const legacyDone = { status: "SUBMITTED", lmsSubmission: null };

  it("reopens a current assignment the LMS says this student hasn't turned in", () => {
    expect(decide({ existing: legacyDone, reported: "unsubmitted" })).toEqual({
      status: "NOT_STARTED",
      lmsSubmission: "unsubmitted",
      reopened: true,
    });
  });

  it("reopens one due a few days ago, or with no due date", () => {
    const recent = new Date(NOW.getTime() - (LEGACY_REOPEN_WINDOW_DAYS - 1) * DAY);
    expect(decide({ existing: legacyDone, reported: "unsubmitted", dueAt: recent }).reopened).toBe(true);
    expect(decide({ existing: legacyDone, reported: "unsubmitted", dueAt: null }).reopened).toBe(true);
  });

  it("leaves one long past due alone", () => {
    const old = new Date(NOW.getTime() - (LEGACY_REOPEN_WINDOW_DAYS + 1) * DAY);
    expect(decide({ existing: legacyDone, reported: "unsubmitted", dueAt: old })).toEqual({
      status: "SUBMITTED",
      lmsSubmission: "unsubmitted",
      reopened: false,
    });
  });

  it("leaves work the LMS takes no submissions for alone (on paper, say)", () => {
    expect(decide({ existing: legacyDone, reported: "unsubmitted", tracksSubmissions: false }).reopened).toBe(false);
  });

  it("only happens once: afterwards the row has an lmsSubmission", () => {
    const first = decide({ existing: legacyDone, reported: "unsubmitted" });
    // The student checks it off again by hand; the next sync keeps that.
    const second = decide({ existing: { status: "SUBMITTED", lmsSubmission: first.lmsSubmission }, reported: "unsubmitted" });
    expect(second).toEqual({ status: "SUBMITTED", lmsSubmission: "unsubmitted", reopened: false });
  });
});

describe("decideAssignmentStatus when the LMS doesn't say (calendar feeds)", () => {
  it("checks off a deadline that was already more than a day past when it first came in", () => {
    const old = new Date(NOW.getTime() - 3 * DAY);
    expect(decide({ reported: null, dueAt: old })).toEqual({
      status: "SUBMITTED",
      lmsSubmission: null,
      reopened: false,
      assumedDone: true,
    });
  });

  it("leaves one due in the last day, one with no date, and anything the LMS does report on, open", () => {
    expect(decide({ reported: null, dueAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }).status).toBe("NOT_STARTED");
    expect(decide({ reported: null, dueAt: null }).status).toBe("NOT_STARTED");
    expect(decide({ reported: "unsubmitted", dueAt: new Date(NOW.getTime() - 3 * DAY) }).status).toBe("NOT_STARTED");
  });

  it("only applies when it first comes in: a deadline that passes later stays open", () => {
    const passed = new Date(NOW.getTime() - 3 * DAY);
    expect(decide({ existing: { status: "NOT_STARTED", lmsSubmission: null }, reported: null, dueAt: passed }).status).toBe(
      "NOT_STARTED"
    );
  });
});
