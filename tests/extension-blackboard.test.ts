import { describe, expect, it } from "vitest";
import {
  blackboardReader,
  contentPlan,
  mapColumns,
  mapMemberships,
  submissionFromGrade,
  visibleTextLength,
} from "../chrome-extension/src/lms/blackboard.js";
import { SessionError, makeLmsFetch } from "../chrome-extension/src/lms/common.js";

// Shapes from Blackboard Learn's REST API reference (users, memberships,
// gradebook columns and grades, contents and attachments). Made-up site.
const ORIGIN = "https://learn.example.edu";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("mapMemberships", () => {
  it("keeps courses the student can open, from expand=course or looked up separately", () => {
    const courses = mapMemberships(
      [
        { courseId: "_1_1", availability: { available: "Yes" }, course: { id: "_1_1", courseId: "BIO-101", name: "Biology", availability: { available: "Yes" }, externalAccessUrl: `${ORIGIN}/ultra/courses/_1_1/outline` } },
        { courseId: "_2_1", availability: { available: "No" }, course: { id: "_2_1", name: "Hidden" } },
        { courseId: "_3_1", availability: { available: "Yes" } },
        { courseId: "_4_1", availability: { available: "Yes" }, course: { id: "_4_1", name: "Closed", availability: { available: "No" } } },
      ],
      new Map([["_3_1", { id: "_3_1", courseId: "CHEM-1", name: "Chemistry" }]])
    );
    expect(courses).toEqual([
      { id: "_1_1", name: "Biology", code: "BIO-101", url: `${ORIGIN}/ultra/courses/_1_1/outline` },
      { id: "_3_1", name: "Chemistry", code: "CHEM-1", url: null },
    ]);
  });
});

describe("gradebook", () => {
  it("reads graded, submitted and not yet from a grade entry", () => {
    expect(submissionFromGrade({ status: "Graded", score: 9 })).toBe("graded");
    expect(submissionFromGrade({ status: "NeedsGrading" })).toBe("submitted");
    expect(submissionFromGrade({ exempt: true })).toBe("graded");
    expect(submissionFromGrade(undefined)).toBe("unsubmitted");
  });

  it("makes assignments from columns students submit or that are due, and skips totals and hidden ones", () => {
    const work = mapColumns(
      [
        { id: "_10_1", name: "Essay 1", grading: { type: "Attempts", due: "2026-11-09T04:59:00.000Z" }, score: { possible: 100 } },
        { id: "_11_1", name: "Weighted Total", grading: { type: "Calculated" } },
        { id: "_12_1", name: "Participation", grading: { type: "Manual" } },
        { id: "_13_1", name: "Final Exam", grading: { type: "Manual", due: "2026-12-12T15:00:00.000Z" } },
        { id: "_14_1", name: "Secret", grading: { type: "Attempts" }, availability: { available: "No" } },
      ],
      { courseUrl: `${ORIGIN}/c`, grades: new Map([["_10_1", { status: "NeedsGrading" }]]) }
    );
    expect(work.map((w: { id: string }) => w.id)).toEqual(["column:_10_1", "column:_13_1"]);
    expect(work[0]).toMatchObject({ submission: "submitted", tracksSubmissions: true, pointsPossible: 100 });
    expect(work[1]).toMatchObject({ isExam: true, tracksSubmissions: false, submission: "unsubmitted" });
  });

  it("leaves status unknown when the gradebook couldn't be read", () => {
    const [only] = mapColumns([{ id: "_1", name: "HW", grading: { type: "Attempts" } }], { courseUrl: null, grades: null });
    expect(only.submission).toBeNull();
  });
});

describe("contentPlan", () => {
  it("opens folders, records links, reads documents with a body, and looks for attachments", () => {
    expect(contentPlan({ contentHandler: { id: "resource/x-bb-folder" } })).toMatchObject({ container: true, attachments: false });
    expect(contentPlan({ contentHandler: { id: "resource/x-bb-externallink", url: "https://x.example/a" } }).externalUrl).toBe("https://x.example/a");
    expect(contentPlan({ contentHandler: { id: "resource/x-bb-document" }, body: "<p>Read chapters 3 and 4 before class.</p>" })).toMatchObject({ page: true, attachments: true });
    expect(contentPlan({ contentHandler: { id: "resource/x-bb-document" }, body: "<p> </p>" }).page).toBe(false);
    expect(contentPlan({ contentHandler: { id: "resource/x-bb-forumlink" } })).toMatchObject({ container: false, page: false, attachments: false });
    expect(visibleTextLength("<style>a{}</style><b>Hi</b>&nbsp;there")).toBe(8);
  });
});

describe("blackboardReader", () => {
  function site(routes: Record<string, unknown>) {
    return async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const body = routes[url.pathname + url.search] ?? routes[url.pathname];
      if (body === undefined) return json({ status: 404, message: "Not found" }, 404);
      if (typeof body === "number") return json({}, body);
      return json(body);
    };
  }

  it("says signed out when Blackboard won't say who the student is", async () => {
    const reader = blackboardReader(makeLmsFetch(ORIGIN, site({ "/learn/api/public/v1/users/me": 401 }), { baseDelayMs: 1 }));
    await expect(reader.connect()).rejects.toBeInstanceOf(SessionError);
  });

  it("looks up courses one by one on a site without expand=course, newest API version first", async () => {
    const reader = blackboardReader(
      makeLmsFetch(
        ORIGIN,
        site({
          "/learn/api/public/v1/users/me": { id: "_9_1", userName: "sam" },
          "/learn/api/public/v1/users/_9_1/courses?expand=course&limit=100": 400,
          "/learn/api/public/v1/users/_9_1/courses?limit=100": { results: [{ courseId: "_5_1", availability: { available: "Yes" } }] },
          "/learn/api/public/v3/courses/_5_1": 404,
          "/learn/api/public/v2/courses/_5_1": { id: "_5_1", courseId: "HIST-2", name: "History" },
        }),
        { baseDelayMs: 1 }
      )
    );
    await reader.connect();
    expect(await reader.listCourses()).toEqual([{ id: "_5_1", name: "History", code: "HIST-2", url: null }]);
  });

  it("walks folders for documents, links and attachments, and flags a folder it couldn't open", async () => {
    const base = "/learn/api/public/v1/courses/_5_1/contents";
    const reader = blackboardReader(
      makeLmsFetch(
        ORIGIN,
        site({
          "/learn/api/public/v1/users/me": { id: "_9_1" },
          [`${base}?limit=200`]: {
            results: [
              { id: "_100_1", title: "Week 1", contentHandler: { id: "resource/x-bb-folder" }, hasChildren: true },
              { id: "_101_1", title: "Locked folder", contentHandler: { id: "resource/x-bb-folder" }, hasChildren: true },
              { id: "_102_1", title: "Syllabus", contentHandler: { id: "resource/x-bb-file" }, modified: "2026-08-20T10:00:00.000Z" },
            ],
          },
          [`${base}/_100_1/children?limit=200`]: {
            results: [
              { id: "_110_1", title: "Read this", contentHandler: { id: "resource/x-bb-document" }, body: "<p>Chapter 1 covers the basics of cells.</p>" },
              { id: "_111_1", title: "Textbook", contentHandler: { id: "resource/x-bb-externallink", url: "https://books.example.com/b" } },
            ],
          },
          [`${base}/_101_1/children?limit=200`]: 403,
          [`${base}/_102_1/attachments`]: { results: [{ id: "_7_1", fileName: "syllabus.pdf", mimeType: "application/pdf" }] },
          [`${base}/_110_1/attachments`]: { results: [] },
        }),
        { baseDelayMs: 1 }
      )
    );
    await reader.connect();
    const { resources, downloads, complete } = await reader.courseMaterials({ id: "_5_1", name: "History", code: "", url: null });
    expect(resources.map((r: { resourceId: string; resourceType: string }) => [r.resourceId, r.resourceType]).sort()).toEqual([
      ["attachment:_102_1:_7_1", "file"],
      ["content:_110_1", "page"],
      ["content:_111_1", "external"],
    ]);
    expect(downloads.get("attachment:_102_1:_7_1")).toBe(`${base}/_102_1/attachments/_7_1/download`);
    expect(downloads.get("content:_110_1")).toEqual({ body: "<p>Chapter 1 covers the basics of cells.</p>" });
    expect(complete).toBe(false);
  });
});
