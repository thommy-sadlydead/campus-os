import { describe, it, expect, vi, afterEach } from "vitest";
import { applyLmsCourses, type LmsCourseInput } from "../src/lib/lms/apply";
import { syncCanvasForUser } from "../src/lib/canvas-sync";
import type { CanvasAssignment, CanvasCalendarEvent, CanvasConfig, CanvasCourse } from "../src/lib/canvas";
import { emptyReport, parseReport, summarizeReport } from "../src/lib/lms/report";
import { createFakePrisma } from "./helpers/fake-prisma";

const NOW = new Date("2026-10-05T16:00:00Z");
const BASE = "https://school.instructure.com";
const SOON = "2026-10-08T03:59:00Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A fake Canvas: each access token sees its own courses and its own
// submissions, the way two classmates do.
// ---------------------------------------------------------------------------

interface CanvasAccountData {
  courses: CanvasCourse[];
  pending?: CanvasCourse[];
  /** By course id: the assignments, or an HTTP status to fail with. */
  assignments: Record<number, CanvasAssignment[] | number>;
  events?: CanvasCalendarEvent[];
}

function fakeCanvas(accounts: Record<string, CanvasAccountData>) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const token = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace("Bearer ", "");
      const account = accounts[token];
      if (!account) return json({ errors: [{ message: "Invalid access token." }] }, 401);
      if (url.pathname === "/api/v1/courses") {
        return json(url.searchParams.get("enrollment_state") === "active" ? account.courses : account.pending ?? []);
      }
      const assignments = url.pathname.match(/^\/api\/v1\/courses\/(\d+)\/assignments$/);
      if (assignments) {
        const result = account.assignments[Number(assignments[1])];
        return typeof result === "number" ? json({ errors: [] }, result) : json(result ?? []);
      }
      if (url.pathname === "/api/v1/calendar_events") return json(account.events ?? []);
      return json({ errors: [] }, 404);
    })
  );
}

function assignment(id: number, name: string, overrides: Partial<CanvasAssignment> = {}): CanvasAssignment {
  return {
    id,
    name,
    description: null,
    due_at: SOON,
    points_possible: 10,
    html_url: `${BASE}/courses/1/assignments/${id}`,
    submission_types: ["online_upload"],
    submission: { workflow_state: "unsubmitted" },
    ...overrides,
  };
}

const cfgFor = (token: string): CanvasConfig => ({ baseUrl: BASE, token });

describe("Canvas sync for classmates who share a course", () => {
  const bio: CanvasCourse = { id: 101, name: "Biology", course_code: "BIO-1000" };

  it("gives each student their own class and assignments", async () => {
    fakeCanvas({
      reece: {
        courses: [bio, { id: 102, name: "Composition", course_code: "ENG-1400" }],
        assignments: { 101: [assignment(1001, "Lab report")], 102: [assignment(2001, "Essay")] },
      },
      friend: {
        courses: [bio, { id: 103, name: "History", course_code: "HIS-1100" }],
        assignments: { 101: [assignment(1001, "Lab report")], 103: [assignment(3001, "Reading")] },
      },
    });
    const { prisma, db } = createFakePrisma();

    await syncCanvasForUser(prisma, "reece", cfgFor("reece"), NOW);
    const report = await syncCanvasForUser(prisma, "friend", cfgFor("friend"), NOW);

    expect(report.classes.map((c) => c.name)).toEqual(["Biology", "History"]);
    const classesOf = (userId: string) => db.class.filter((c) => c.userId === userId).map((c) => c.name).sort();
    expect(classesOf("reece")).toEqual(["Biology", "Composition"]);
    expect(classesOf("friend")).toEqual(["Biology", "History"]);
    // Two Biology classes, one each, with an assignment each.
    const bios = db.class.filter((c) => c.lmsCourseId === "101");
    expect(bios).toHaveLength(2);
    for (const cls of bios) expect(db.assignment.filter((a) => a.classId === cls.id)).toHaveLength(1);
  });

  it("never lets one student's submission mark the other's work done", async () => {
    fakeCanvas({
      reece: { courses: [bio], assignments: { 101: [assignment(1001, "Lab report")] } },
      friend: {
        courses: [bio],
        assignments: { 101: [assignment(1001, "Lab report", { submission: { workflow_state: "submitted" } })] },
      },
    });
    const { prisma, db } = createFakePrisma();

    await syncCanvasForUser(prisma, "reece", cfgFor("reece"), NOW);
    await syncCanvasForUser(prisma, "friend", cfgFor("friend"), NOW);
    await syncCanvasForUser(prisma, "reece", cfgFor("reece"), NOW);

    const statusOf = (userId: string) => {
      const cls = db.class.find((c) => c.userId === userId)!;
      return db.assignment.find((a) => a.classId === cls.id)!.status;
    };
    expect(statusOf("reece")).toBe("NOT_STARTED");
    expect(statusOf("friend")).toBe("SUBMITTED");
  });
});

describe("Canvas sync, course by course", () => {
  it("syncs the other courses when one course's assignments can't be loaded", async () => {
    fakeCanvas({
      me: {
        courses: [
          { id: 1, name: "Art", course_code: "ART" },
          { id: 2, name: "Biology", course_code: "BIO" },
          { id: 3, name: "Chemistry", course_code: "CHEM" },
        ],
        assignments: { 1: [assignment(11, "Sketch")], 2: 403, 3: [assignment(31, "Lab 1"), assignment(32, "Lab 2")] },
      },
    });
    const { prisma, db } = createFakePrisma();

    const report = await syncCanvasForUser(prisma, "me", cfgFor("me"), NOW);

    expect(db.class.map((c) => c.name)).toEqual(["Art", "Biology", "Chemistry"]);
    expect(db.assignment).toHaveLength(3);
    expect(report.classes.find((c) => c.name === "Biology")?.problem).toMatch(/isn't letting students see/);
    expect(report.classes.find((c) => c.name === "Chemistry")).toMatchObject({ assignments: 2, newAssignments: 2 });
  });

  it("reports courses Canvas hides and invitations not accepted yet, instead of leaving them out silently", async () => {
    fakeCanvas({
      me: {
        courses: [{ id: 1, name: "Art", course_code: "ART" }, { id: 9, access_restricted_by_date: true }],
        pending: [{ id: 5, name: "Spanish I", course_code: "SPAN-1010" }],
        assignments: { 1: [] },
      },
    });
    const { prisma, db } = createFakePrisma();

    const report = await syncCanvasForUser(prisma, "me", cfgFor("me"), NOW);

    expect(db.class.map((c) => c.name)).toEqual(["Art"]);
    expect(report.skipped).toEqual([
      { name: "Canvas course 9", reason: expect.stringMatching(/isn't showing this course/) },
      { name: "Spanish I", reason: expect.stringMatching(/accepted the invitation/) },
    ]);
  });

  it("updates rather than duplicates on a second sync", async () => {
    fakeCanvas({ me: { courses: [{ id: 1, name: "Art", course_code: "ART" }], assignments: { 1: [assignment(11, "Sketch")] } } });
    const { prisma, db } = createFakePrisma();

    await syncCanvasForUser(prisma, "me", cfgFor("me"), NOW);
    fakeCanvas({
      me: { courses: [{ id: 1, name: "Art History", course_code: "ART" }], assignments: { 1: [assignment(11, "Sketchbook")] } },
    });
    const report = await syncCanvasForUser(prisma, "me", cfgFor("me"), NOW);

    expect(db.class).toHaveLength(1);
    expect(db.class[0].name).toBe("Art History");
    expect(db.assignment).toHaveLength(1);
    expect(db.assignment[0].name).toBe("Sketchbook");
    expect(report.classes[0]).toMatchObject({ assignments: 1, newAssignments: 0 });
  });

  it("stores Canvas's own link and what it says about the submission", async () => {
    fakeCanvas({
      me: {
        courses: [{ id: 1, name: "Art", course_code: "ART" }],
        assignments: { 1: [assignment(11, "Sketch", { submission: { workflow_state: "graded" } })] },
      },
    });
    const { prisma, db } = createFakePrisma();

    await syncCanvasForUser(prisma, "me", cfgFor("me"), NOW);

    expect(db.assignment[0]).toMatchObject({
      lmsItemId: "11",
      lmsUrl: `${BASE}/courses/1/assignments/11`,
      lmsSubmission: "graded",
      status: "GRADED",
    });
  });

  it("adds exams from the course calendar unless the gradebook already has them", async () => {
    fakeCanvas({
      me: {
        courses: [{ id: 1, name: "Art", course_code: "ART" }],
        assignments: { 1: [assignment(11, "Exam 2"), assignment(12, "Sketch")] },
        events: [
          { id: 7, title: "Exam #2", start_at: SOON, location_name: null, context_code: "course_1", html_url: `${BASE}/calendar?event_id=7` },
          { id: 8, title: "Midterm Exam", start_at: SOON, location_name: "Room 204", context_code: "course_1", html_url: `${BASE}/calendar?event_id=8` },
          { id: 9, title: "Office hours", start_at: SOON, location_name: null, context_code: "course_1", html_url: `${BASE}/calendar?event_id=9` },
        ],
      },
    });
    const { prisma, db } = createFakePrisma();

    await syncCanvasForUser(prisma, "me", cfgFor("me"), NOW);

    expect(db.exam.map((e) => [e.name, e.lmsItemId, e.location ?? null])).toEqual([
      ["Exam 2", "11", null],
      ["Midterm Exam", "event:8", "Room 204"],
    ]);
  });

  it("stops with an error only when Canvas won't list the courses at all", async () => {
    fakeCanvas({});
    const { prisma } = createFakePrisma();
    await expect(syncCanvasForUser(prisma, "me", cfgFor("bad-token"), NOW)).rejects.toMatchObject({ status: 401 });
  });
});

describe("Canvas sync and assignments from before this fix", () => {
  it("reopens work a classmate's submission had marked done, and says so", async () => {
    fakeCanvas({
      me: {
        courses: [{ id: 101, name: "Biology", course_code: "BIO" }],
        assignments: { 101: [assignment(1001, "Lab report"), assignment(1002, "Quiz", { submission: { workflow_state: "submitted" } })] },
      },
    });
    const { prisma, db } = createFakePrisma({
      class: [{ id: "c1", userId: "me", lmsProvider: "canvas", lmsCourseId: "101", name: "Biology", code: "BIO", color: 1, archived: false }],
      assignment: [
        { id: "a1", classId: "c1", lmsItemId: "1001", name: "Lab report", status: "SUBMITTED", lmsSubmission: null, dueAt: new Date(SOON) },
        { id: "a2", classId: "c1", lmsItemId: "1002", name: "Quiz", status: "SUBMITTED", lmsSubmission: null, dueAt: new Date(SOON) },
      ],
    });

    const report = await syncCanvasForUser(prisma, "me", cfgFor("me"), NOW);

    expect(db.assignment.find((a) => a.id === "a1")).toMatchObject({ status: "NOT_STARTED", lmsSubmission: "unsubmitted" });
    expect(db.assignment.find((a) => a.id === "a2")).toMatchObject({ status: "SUBMITTED", lmsSubmission: "submitted" });
    expect(report.reopened).toEqual([{ className: "Biology", name: "Lab report" }]);
  });
});

describe("applyLmsCourses", () => {
  const course = (overrides: Partial<LmsCourseInput>): LmsCourseInput => ({
    id: "1",
    name: "Art",
    code: "ART",
    assignments: [],
    exams: [],
    problem: null,
    ...overrides,
  });

  it("keeps stored assignments when a course's assignments couldn't be loaded", async () => {
    const { prisma, db } = createFakePrisma({
      class: [{ id: "c1", userId: "me", lmsProvider: "schoology", lmsCourseId: "1", name: "Art", code: "ART", color: 1, archived: false }],
      assignment: [{ id: "a1", classId: "c1", lmsItemId: "x", name: "Sketch", status: "IN_PROGRESS", lmsSubmission: null }],
    });

    const result = await applyLmsCourses(prisma, "me", "schoology", [course({ assignments: null, problem: "Couldn't load." })], NOW);

    expect(db.assignment).toHaveLength(1);
    expect(result.classes).toEqual([{ name: "Art", assignments: 0, newAssignments: 0, exams: 0, problem: "Couldn't load." }]);
  });

  it("removes an exam whose assignment the LMS no longer treats as one, and closes its pending email change", async () => {
    const { prisma, db } = createFakePrisma({
      class: [{ id: "c1", userId: "me", lmsProvider: "canvas", lmsCourseId: "1", name: "Art", code: "ART", color: 1, archived: false }],
      exam: [
        { id: "e1", classId: "c1", lmsItemId: "5", name: "Final Draft", examAt: null },
        { id: "e2", classId: "c1", lmsItemId: null, name: "Exam I added by hand", examAt: null },
      ],
      pendingChange: [{ id: "p1", entityType: "Exam", entityId: "e1", status: "PENDING" }],
    });
    const draft = {
      id: "5",
      name: "Final Draft",
      description: null,
      dueAt: null,
      pointsPossible: null,
      url: null,
      submission: null,
      tracksSubmissions: false,
      isExam: false,
    };

    await applyLmsCourses(prisma, "me", "canvas", [course({ assignments: [draft] })], NOW);

    expect(db.exam.map((e) => e.id)).toEqual(["e2"]);
    expect(db.pendingChange[0].status).toBe("REJECTED");
  });

  it("gives new classes the colors used least", async () => {
    const { prisma, db } = createFakePrisma({
      class: [{ id: "c1", userId: "me", lmsProvider: null, lmsCourseId: null, name: "Mine", code: "", color: 1, archived: false }],
    });

    await applyLmsCourses(prisma, "me", "canvas", [course({ id: "1" }), course({ id: "2", name: "Bio" })], NOW);

    expect(db.class.map((c) => c.color)).toEqual([1, 2, 3]);
  });
});

describe("summarizeReport", () => {
  it("counts assignments and classes, and says how many courses need a look", () => {
    const report = {
      ...emptyReport("canvas", NOW),
      classes: [
        { name: "Art", assignments: 3, newAssignments: 0, exams: 0 },
        { name: "Bio", assignments: 0, newAssignments: 0, exams: 0, problem: "Couldn't load." },
      ],
      skipped: [{ name: "Spanish", reason: "Invitation." }],
    };
    expect(summarizeReport(report)).toBe("Synced 3 assignments across 2 classes. 2 courses need a look.");
    expect(summarizeReport({ ...emptyReport("canvas", NOW), classes: [report.classes[0]] })).toBe(
      "Synced 3 assignments across 1 class."
    );
  });

  it("reads back a stored report, and nothing from a broken one", () => {
    const report = { ...emptyReport("schoology", NOW), reopened: [{ className: "Art", name: "Sketch" }] };
    expect(parseReport(JSON.stringify(report))).toEqual(report);
    expect(parseReport("{not json")).toBeNull();
    expect(parseReport(null)).toBeNull();
  });
});
