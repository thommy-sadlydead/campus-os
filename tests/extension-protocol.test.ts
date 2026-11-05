import { describe, expect, it } from "vitest";
import {
  coursesPayload,
  courseImportStatus,
  lmsOrigin,
  matchCalendarDuplicates,
  parseUploadHeader,
} from "../src/lib/lms/extension-protocol";

const header = {
  provider: "blackboard",
  courseId: "_5_1",
  resource: {
    resourceId: "attachment:_1_1:_2_1",
    resourceType: "file",
    title: "Syllabus",
    filename: "syllabus.pdf",
    contentType: "application/pdf",
    updatedAt: "2026-08-20T10:00:00.000Z",
    sourceUrl: "https://learn.example.edu/c",
  },
  uploadId: "abcdef0123456789",
  part: 0,
  parts: 2,
  totalBytes: 5_000_000,
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("parseUploadHeader", () => {
  it("reads the base64url JSON the extension sends", () => {
    expect(parseUploadHeader(encode(header))).toEqual(header);
  });

  it("refuses a part past the end, too many parts, a file too big, or garbage", () => {
    expect(parseUploadHeader(encode({ ...header, part: 2 }))).toBeNull();
    expect(parseUploadHeader(encode({ ...header, parts: 50 }))).toBeNull();
    expect(parseUploadHeader(encode({ ...header, totalBytes: 30 * 1024 * 1024 }))).toBeNull();
    expect(parseUploadHeader(encode({ ...header, provider: "canvas" }))).toBeNull();
    expect(parseUploadHeader("not base64 json")).toBeNull();
    expect(parseUploadHeader(null)).toBeNull();
  });
});

describe("lmsOrigin", () => {
  it("takes an https origin and nothing else", () => {
    expect(lmsOrigin.safeParse("https://lms.example.edu").success).toBe(true);
    expect(lmsOrigin.safeParse("https://lms.example.edu/d2l/home").success).toBe(false);
    expect(lmsOrigin.safeParse("ftp://lms.example.edu").success).toBe(false);
    expect(lmsOrigin.safeParse("javascript:alert(1)").success).toBe(false);
  });
});

describe("coursesPayload", () => {
  it("takes a course whose work couldn't be read, keeping what's stored", () => {
    const parsed = coursesPayload.safeParse({
      provider: "brightspace",
      origin: "https://lms.example.edu",
      courses: [{ id: "101", name: "Biology", code: "", assignments: null, exams: [], problem: "Couldn't read it." }],
      skipped: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses Canvas or Schoology, which never come through the extension", () => {
    expect(coursesPayload.safeParse({ provider: "canvas", origin: "https://x.instructure.com", courses: [], skipped: [] }).success).toBe(false);
  });
});

describe("courseImportStatus", () => {
  it("is only done when every file it found was dealt with, and partial when some failed", () => {
    expect(courseImportStatus({ found: 10, done: 7, failed: 0 })).toBe("DOWNLOADING");
    expect(courseImportStatus({ found: 10, done: 10, failed: 0 })).toBe("READY");
    expect(courseImportStatus({ found: 10, done: 8, failed: 2 })).toBe("PARTIAL");
  });
});

describe("matchCalendarDuplicates", () => {
  const d = (iso: string) => new Date(iso);
  it("pairs a calendar deadline with the same assignment read through the extension", () => {
    const pairs = matchCalendarDuplicates(
      [
        { id: "cal-1", name: "Lab Report #2", dueAt: d("2026-11-10T04:59:00Z") },
        { id: "cal-2", name: "Quiz 5", dueAt: d("2026-11-12T04:59:00Z") },
        { id: "cal-3", name: "Office hours", dueAt: null },
      ],
      [
        { id: "new-1", name: "lab report 2", dueAt: d("2026-11-10T05:59:00Z") },
        { id: "new-2", name: "Quiz 5", dueAt: d("2026-11-20T04:59:00Z") },
      ]
    );
    expect(pairs).toEqual([{ fromId: "cal-1", toId: "new-1" }]);
  });
});
