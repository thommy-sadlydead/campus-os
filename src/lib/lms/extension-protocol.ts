// What the Campus OS Chrome extension (chrome-extension/) sends the app,
// checked here before anything is saved. The extension reads Brightspace
// or Blackboard in the student's own signed-in browser and posts what it
// found to /api/lms-extension/*; the app then saves it through the same
// code Canvas and Schoology use (applyLmsCourses, upsertMaterial). Pure,
// so it's easy to test. Keep in step with chrome-extension/src/api.js.

import { z } from "zod";
import type { FeedProvider } from "@/lib/lms/providers";

export const EXTENSION_PROVIDERS = ["brightspace", "blackboard"] as const satisfies readonly FeedProvider[];
export type ExtensionProvider = (typeof EXTENSION_PROVIDERS)[number];

/** A request body is capped at 4.5 MB on Vercel, so bigger files come in parts this size or smaller. */
export const MAX_PART_BYTES = 3_500_000;
/** The biggest file read, same as Canvas and Schoology (MAX_DOCUMENT_FILE_BYTES). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PARTS = Math.ceil(MAX_UPLOAD_BYTES / MAX_PART_BYTES);

/** Ids this app gives the items it reads, by kind: what's left over in a class came from a calendar link. */
export const EXTENSION_ITEM_PREFIXES = ["dropbox:", "quiz:", "column:"];

const provider = z.enum(EXTENSION_PROVIDERS);
const isoDate = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), "Not a date.");
const text = (max: number) => z.string().max(max);

/** The LMS site, as an origin: https, or http on this computer for local testing. */
export const lmsOrigin = z
  .string()
  .max(200)
  .refine((v) => {
    try {
      const url = new URL(v);
      if (url.origin !== v) return false;
      return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname));
    } catch {
      return false;
    }
  }, "Not an LMS address.");

const assignment = z.object({
  id: text(200).min(1),
  name: text(300).min(1),
  description: text(50_000).nullable(),
  dueAt: isoDate.nullable(),
  pointsPossible: z.number().finite().nullable(),
  url: text(2000).nullable(),
  submission: z.enum(["unsubmitted", "submitted", "graded"]).nullable(),
  tracksSubmissions: z.boolean(),
  isExam: z.boolean(),
});

const exam = z.object({
  id: text(200).min(1),
  name: text(300).min(1),
  examAt: isoDate.nullable(),
  location: text(300).nullable(),
  url: text(2000).nullable(),
});

const course = z.object({
  id: text(120).min(1),
  name: text(200).min(1),
  code: text(120),
  /** Null when the course's work couldn't be read this time; what's stored is kept. */
  assignments: z.array(assignment).max(1500).nullable(),
  exams: z.array(exam).max(300),
  problem: text(500).nullable(),
});

export const coursesPayload = z.object({
  provider,
  origin: lmsOrigin,
  courses: z.array(course).max(80),
  skipped: z.array(z.object({ name: text(200), reason: text(300) })).max(200),
});
export type CoursesPayload = z.infer<typeof coursesPayload>;

const resource = z.object({
  resourceId: text(200).min(1),
  resourceType: z.enum(["file", "page", "external"]),
  title: text(300).min(1),
  filename: text(300),
  contentType: text(150).optional(),
  size: z.number().int().nonnegative().optional(),
  updatedAt: isoDate.nullable(),
  sourceUrl: text(2000),
});
export type ExtensionResource = z.infer<typeof resource>;

export const materialsPayload = z.object({
  provider,
  courseId: text(120).min(1),
  resources: z.array(resource).max(3000),
  /** Why some of the course couldn't be read (a tool the course turned off), shown with its progress. */
  problem: text(500).nullable(),
  /**
   * Whether this is everything the course has. Only then are files that
   * weren't listed marked missing; a list cut short (a folder that wouldn't
   * open, a very big course) leaves what's stored alone.
   */
  complete: z.boolean(),
});
export type MaterialsPayload = z.infer<typeof materialsPayload>;

/** Sent in the X-Campus-Upload header (base64url JSON) with each part of a file or page. */
export const uploadHeader = z.object({
  provider,
  courseId: text(120).min(1),
  resource,
  uploadId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  part: z.number().int().min(0),
  parts: z.number().int().min(1).max(MAX_PARTS),
  totalBytes: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
}).refine((h) => h.part < h.parts, "Part out of range.");
export type UploadHeader = z.infer<typeof uploadHeader>;

export const failurePayload = z.object({
  provider,
  courseId: text(120).min(1),
  resource,
  reason: z.enum(["too-large", "forbidden", "not-found", "other-host", "download-failed"]),
  message: text(300),
});
export type FailurePayload = z.infer<typeof failurePayload>;

export const finishPayload = z.object({
  provider,
  origin: lmsOrigin,
  /** Why the extension stopped early, when it did. A finished sync sends null. */
  stopped: z.enum(["signed-out", "error"]).nullable(),
  message: text(300).nullable(),
});
export type FinishPayload = z.infer<typeof finishPayload>;

/** Decodes the X-Campus-Upload header. Null when it's missing or malformed. */
export function parseUploadHeader(value: string | null): UploadHeader | null {
  if (!value || value.length > 8000) return null;
  try {
    const json = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = uploadHeader.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * A course's file import once the extension says it's done: READY when
 * every planned file came in, PARTIAL when some failed or it stopped
 * before the rest. Never READY unless done + failed covers what was found.
 */
export function courseImportStatus(state: { found: number; done: number; failed: number }): "READY" | "PARTIAL" | "DOWNLOADING" {
  const processed = state.done + state.failed;
  if (processed < state.found) return "DOWNLOADING";
  return state.failed > 0 ? "PARTIAL" : "READY";
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Assignments a calendar link brought in that the extension has now read
 * properly: same name, due within a day and a half. The calendar copy is
 * then folded into the new one (the student's status and steps move over),
 * so switching to the extension doesn't leave every deadline twice.
 */
export function matchCalendarDuplicates(
  calendarItems: { id: string; name: string; dueAt: Date | null }[],
  extensionItems: { id: string; name: string; dueAt: Date | null }[]
): { fromId: string; toId: string }[] {
  const pairs: { fromId: string; toId: string }[] = [];
  const taken = new Set<string>();
  for (const old of calendarItems) {
    const match = extensionItems.find(
      (n) =>
        !taken.has(n.id) &&
        normalizeName(n.name) === normalizeName(old.name) &&
        (old.dueAt === null || n.dueAt === null
          ? old.dueAt === n.dueAt
          : Math.abs(old.dueAt.getTime() - n.dueAt.getTime()) <= 36 * 60 * 60 * 1000)
    );
    if (match) {
      taken.add(match.id);
      pairs.push({ fromId: old.id, toId: match.id });
    }
  }
  return pairs;
}
