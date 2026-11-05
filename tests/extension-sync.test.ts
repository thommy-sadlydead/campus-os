import { describe, expect, it } from "vitest";
import { runSync } from "../chrome-extension/src/sync.js";
import { MAX_PART_BYTES as EXTENSION_PART_BYTES, MAX_UPLOAD_BYTES as EXTENSION_MAX_BYTES } from "../chrome-extension/src/api.js";
import { isExamLikeName as extensionExamRule } from "../chrome-extension/src/lms/common.js";
import { isExamLikeName as appExamRule } from "../src/lib/lms/exams";
import {
  MAX_PART_BYTES,
  MAX_UPLOAD_BYTES,
  coursesPayload,
  failurePayload,
  finishPayload,
  materialsPayload,
  uploadHeader,
} from "../src/lib/lms/extension-protocol";

// The extension's whole sync (chrome-extension/src/sync.js) against a
// stand-in Brightspace and a stand-in Campus OS that checks every request
// with the app's own schemas (src/lib/lms/extension-protocol.ts), so the
// two can't drift apart.

const ORIGIN = "https://lms.example.edu";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function bytes(n: number) {
  return new Uint8Array(n).fill(65);
}

function brightspace({ signedOutAfterCourses = false } = {}) {
  let coursesListed = false;
  const files: Record<string, { status: number; body?: Uint8Array; length?: number }> = {
    "/d2l/api/le/1.74/101/content/topics/11/file": { status: 200, body: bytes(1200) },
    "/d2l/api/le/1.74/101/content/topics/12/file": { status: 200, body: bytes(MAX_PART_BYTES * 2 + 10) },
    "/d2l/api/le/1.74/101/content/topics/13/file": { status: 403 },
    "/d2l/api/le/1.74/101/content/topics/14/file": { status: 200, length: MAX_UPLOAD_BYTES + 1, body: bytes(10) },
  };
  return async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (signedOutAfterCourses && coursesListed && path.includes("/content/")) return json({}, 401);
    if (path === "/d2l/api/versions/") return json([{ ProductCode: "lp", LatestVersion: "1.47" }, { ProductCode: "le", LatestVersion: "1.74" }]);
    if (path === "/d2l/api/lp/1.47/users/whoami") return json({ FirstName: "Sam" });
    if (path === "/d2l/api/lp/1.47/enrollments/myenrollments/") {
      coursesListed = true;
      return json({
        Items: [{ OrgUnit: { Id: 101, Name: "Biology 101", Code: "BIO-101", Type: { Id: 3, Code: "Course Offering" } }, Access: { CanAccess: true } }],
        PagingInfo: { HasMoreItems: false },
      });
    }
    if (path === "/d2l/api/le/1.74/101/dropbox/folders/") {
      return json([{ Id: 7, Name: "Lab report", DueDate: "2026-11-20T04:59:00.000Z", CustomInstructions: { Text: "Write it" } }]);
    }
    if (path === "/d2l/api/le/1.74/101/dropbox/folders/7/submissions/mysubmissions/") return json([{ Status: 1, Submissions: [{ Id: 1 }] }]);
    if (path === "/d2l/api/le/1.74/101/quizzes/") return json({ Objects: [{ QuizId: 3, Name: "Midterm Exam", DueDate: "2026-11-25T15:00:00.000Z" }], Next: null });
    if (path === "/d2l/api/le/1.74/101/grades/values/myGradeValues/") return json([]);
    if (path === "/d2l/api/le/1.74/101/content/toc") {
      return json({
        Modules: [
          {
            ModuleId: 1,
            Title: "Week 1",
            Topics: [
              { TopicId: 11, Title: "Slides", TypeIdentifier: "File", Url: "/content/a/Lecture 1.pdf", LastModifiedDate: "2026-09-01T00:00:00Z" },
              { TopicId: 12, Title: "Textbook chapter", TypeIdentifier: "File", Url: "/content/a/chapter.pdf", LastModifiedDate: "2026-09-01T00:00:00Z" },
              { TopicId: 13, Title: "Instructor only", TypeIdentifier: "File", Url: "/content/a/key.pdf" },
              { TopicId: 14, Title: "Huge video notes", TypeIdentifier: "File", Url: "/content/a/huge.pdf" },
              { TopicId: 15, Title: "Unchanged handout", TypeIdentifier: "File", Url: "/content/a/handout.pdf" },
            ],
          },
        ],
      });
    }
    const file = files[path];
    if (file) {
      if (file.status !== 200) return new Response("", { status: file.status });
      const headers: Record<string, string> = { "content-type": "application/pdf" };
      if (file.length) headers["content-length"] = String(file.length);
      return new Response(file.body as unknown as BodyInit, { status: 200, headers });
    }
    return json({ Message: "Not Found" }, 404);
  };
}

function campusOs({ unchanged = [] as string[] } = {}) {
  const calls: { action: string; payload: unknown }[] = [];
  const parts: { resourceId: string; part: number; parts: number; size: number }[] = [];
  const check = <T,>(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, payload: T) => {
    const result = schema.safeParse(payload);
    if (!result.success) throw new Error(`Campus OS would refuse this: ${JSON.stringify(result.error)}`);
    return payload;
  };
  const api = {
    importCourses: async (p: unknown) => {
      calls.push({ action: "courses", payload: check(coursesPayload, p) });
      return { classes: [] };
    },
    planMaterials: async (p: { resources: { resourceId: string }[] }) => {
      calls.push({ action: "materials", payload: check(materialsPayload, p) });
      return { toFetch: p.resources.map((r) => r.resourceId).filter((id) => !unchanged.includes(id)), unchanged: unchanged.length };
    },
    uploadPart: async (header: { resource: { resourceId: string }; part: number; parts: number }, slice: Uint8Array) => {
      check(uploadHeader, header);
      expect(slice.length).toBeLessThanOrEqual(MAX_PART_BYTES);
      parts.push({ resourceId: header.resource.resourceId, part: header.part, parts: header.parts, size: slice.length });
      return { status: header.part === header.parts - 1 ? "synced" : "part-saved" };
    },
    failed: async (p: unknown) => {
      calls.push({ action: "failed", payload: check(failurePayload, p) });
      return { status: "failed" };
    },
    finish: async (p: unknown) => {
      calls.push({ action: "finish", payload: check(finishPayload, p) });
      return { ok: true, summary: [{ name: "Biology 101", materials: 2 }] };
    },
  };
  return { api, calls, parts };
}

describe("runSync", () => {
  it("imports the chosen course's work, then only the files Campus OS asks for, in parts when they're big", async () => {
    const server = campusOs({ unchanged: ["topic:15"] });
    const progress: { phase: string }[] = [];
    const result = await runSync({
      provider: "brightspace",
      origin: ORIGIN,
      courseIds: ["101"],
      api: server.api,
      fetchImpl: brightspace(),
      onProgress: (p: { phase: string }) => progress.push(p),
    });

    expect(result).toEqual({ ok: true, summary: [{ name: "Biology 101", materials: 2 }] });
    const courses = server.calls.find((c) => c.action === "courses")!.payload as { courses: { assignments: { id: string; submission: string | null; isExam: boolean }[] }[] };
    expect(courses.courses[0].assignments.map((a) => [a.id, a.submission, a.isExam])).toEqual([
      ["dropbox:7", "submitted", false],
      ["quiz:3", null, true],
    ]);

    // Small file in one part, the big one in three; the unchanged one never downloaded.
    expect(server.parts.filter((p) => p.resourceId === "topic:11")).toEqual([{ resourceId: "topic:11", part: 0, parts: 1, size: 1200 }]);
    expect(server.parts.filter((p) => p.resourceId === "topic:12").map((p) => p.part)).toEqual([0, 1, 2]);
    expect(server.parts.some((p) => p.resourceId === "topic:15")).toBe(false);

    // The file the student can't open, and the one too big, are reported, not skipped silently.
    const failures = server.calls.filter((c) => c.action === "failed").map((c) => c.payload as { resource: { resourceId: string }; reason: string });
    expect(failures.map((f) => [f.resource.resourceId, f.reason]).sort()).toEqual([
      ["topic:13", "forbidden"],
      ["topic:14", "too-large"],
    ]);

    expect(server.calls.at(-1)).toMatchObject({ action: "finish", payload: { stopped: null } });
    expect(progress.at(-1)?.phase).toBe("done");
  });

  it("stops and says so when the student is signed out partway, without calling it done", async () => {
    const server = campusOs();
    const result = await runSync({
      provider: "brightspace",
      origin: ORIGIN,
      courseIds: ["101"],
      api: server.api,
      fetchImpl: brightspace({ signedOutAfterCourses: true }),
    });
    expect(result).toMatchObject({ ok: false, signedOut: true });
    expect(server.calls.at(-1)).toMatchObject({ action: "finish", payload: { stopped: "signed-out" } });
    expect(server.calls.some((c) => c.action === "materials")).toBe(false);
  });

  it("never sends anything when the student isn't signed in at all", async () => {
    const server = campusOs();
    const result = await runSync({
      provider: "brightspace",
      origin: ORIGIN,
      courseIds: ["101"],
      api: server.api,
      fetchImpl: async (input: string | URL | Request) =>
        new URL(String(input)).pathname === "/d2l/api/versions/" ? json([{ ProductCode: "lp", LatestVersion: "1.47" }, { ProductCode: "le", LatestVersion: "1.74" }]) : json({}, 401),
    });
    expect(result).toMatchObject({ ok: false, signedOut: true });
    expect(server.calls).toEqual([]);
  });
});

describe("the extension and the app agree", () => {
  it("on upload sizes", () => {
    expect(EXTENSION_PART_BYTES).toBe(MAX_PART_BYTES);
    expect(EXTENSION_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
  });

  it("on which names are exams", () => {
    for (const name of ["Exam 2", "Midterm", "Final Exam", "Exam review", "Practice exam", "Final Draft", "Quiz 3", "Mid-term 1", "Exam corrections"]) {
      expect(extensionExamRule(name), name).toBe(appExamRule(name));
    }
  });
});
