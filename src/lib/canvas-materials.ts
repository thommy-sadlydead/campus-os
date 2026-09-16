// Pure logic for Canvas materials discovery/sync — classification, dedup,
// and the incremental-sync diff decision. Kept free of any Canvas API
// calls or Prisma access (those live in canvas.ts and
// canvas-materials-sync.ts) specifically so this stays unit-testable the
// same way the rest of src/lib's pure logic is (see tests/canvas-materials.test.ts).
import crypto from "node:crypto";

export type MaterialType = "BOOK" | "SLIDES" | "SYLLABUS" | "NOTES";

// What kind of Canvas location a resource was found at / is shaped like.
// "file" covers anything file-backed regardless of whether it was
// discovered via the Files list, a Module item, a Page's body, an
// assignment description, or the syllabus — a file found through two of
// those collapses into one "file" entry with the same canvasResourceId
// (the Canvas file id) either way, which is what makes cross-source
// dedup automatic rather than a special case.
export type ResourceType = "file" | "page" | "syllabus" | "external";

export interface ClassificationInput {
  contentType?: string;
  filename: string;
  resourceType: ResourceType;
}

export type ClassificationResult =
  | { shouldImport: true; materialType: MaterialType }
  // recordAsSkipped distinguishes pure Canvas noise every course has by
  // the dozen (profile pictures, banner images) — never worth a
  // ClassMaterial row at all — from a genuine course document we just
  // can't read (a legacy .ppt, an unrecognized type), which the student
  // likely wants to know was found even though it wasn't auto-imported.
  | { shouldImport: false; skipReason: string; recordAsSkipped: boolean };

const IMAGE_PATTERN = /\.(png|jpe?g|gif|svg|webp|bmp|ico|heic)$/i;
const VIDEO_PATTERN = /\.(mp4|mov|avi|wmv|mkv|webm|m4v)$/i;
const AUDIO_PATTERN = /\.(mp3|wav|m4a|aac|ogg)$/i;
const SPREADSHEET_PATTERN = /\.(xlsx|xls|csv)$/i;
const ARCHIVE_PATTERN = /\.(zip|rar|7z|tar|gz)$/i;

/**
 * File-type-based inclusion, not filename-genre filtering: a broader net
 * than the one-off backfill script from earlier in this project's history
 * (which excluded anything with "worksheet"/"solution"/"quiz" in the
 * name) — this app's Canvas sync is meant to also pick up handouts, study
 * guides, and other "useful for studying" documents, not just chapters
 * and slide decks. Exclusion is by file type (can't read it / isn't a
 * document) and Canvas-side signals, not by guessing genre from a name.
 */
export function classifyResource(input: ClassificationInput): ClassificationResult {
  // External resources are always recorded (never fetched) — see the
  // module-level docs in canvas-materials-sync.ts for why this never
  // depends on file-type sniffing.
  if (input.resourceType === "external") {
    return { shouldImport: true, materialType: "BOOK" };
  }

  const name = input.filename.toLowerCase();
  const type = (input.contentType || "").toLowerCase();

  if (IMAGE_PATTERN.test(name) || type.startsWith("image/"))
    return { shouldImport: false, skipReason: "image", recordAsSkipped: false };
  if (VIDEO_PATTERN.test(name) || type.startsWith("video/"))
    return { shouldImport: false, skipReason: "video (not yet supported)", recordAsSkipped: false };
  if (AUDIO_PATTERN.test(name) || type.startsWith("audio/"))
    return { shouldImport: false, skipReason: "audio", recordAsSkipped: false };
  if (SPREADSHEET_PATTERN.test(name) || type.includes("spreadsheetml") || type.includes("ms-excel"))
    return { shouldImport: false, skipReason: "spreadsheet", recordAsSkipped: false };
  // EPUB's real content-type ("application/epub+zip") contains "zip" as a
  // substring, so the plain zip-archive check below would otherwise
  // misclassify every EPUB as an archive and drop it as noise — excluded
  // explicitly rather than reordering the whole function around it.
  const isZipArchiveType = (type.includes("zip") || type.includes("compressed")) && !type.includes("epub");
  if (ARCHIVE_PATTERN.test(name) || isZipArchiveType)
    return { shouldImport: false, skipReason: "archive", recordAsSkipped: false };

  // Legacy binary Office formats (pre-2007) aren't zip-based, so the
  // pptx/docx extractors in office-text.ts can't read them. Checked before
  // the inclusion logic below so a .ppt doesn't get misclassified as
  // importable SLIDES and only fail later, confusingly, at extraction time.
  // Unlike the pure-noise types above, these ARE course documents the
  // student likely wants to know about, just unreadable automatically —
  // recorded, not dropped.
  const isModernPptx = type.includes("presentationml") || name.endsWith(".pptx");
  const isModernDocx = type.includes("wordprocessingml") || name.endsWith(".docx");
  if (name.endsWith(".ppt") && !isModernPptx)
    return { shouldImport: false, skipReason: "legacy .ppt format not supported", recordAsSkipped: true };
  if (name.endsWith(".doc") && !isModernDocx)
    return { shouldImport: false, skipReason: "legacy .doc format not supported", recordAsSkipped: true };

  // resourceType is a stronger signal than filename guessing — a page IS
  // notes-shaped content and the syllabus IS the syllabus, regardless of
  // what its underlying file happens to be named.
  if (input.resourceType === "syllabus") return { shouldImport: true, materialType: "SYLLABUS" };
  if (input.resourceType === "page") return { shouldImport: true, materialType: "NOTES" };

  if (name.includes("syllabus")) return { shouldImport: true, materialType: "SYLLABUS" };
  if (isModernPptx || name.includes("slide")) return { shouldImport: true, materialType: "SLIDES" };
  if (name.includes("study guide") || name.includes("studyguide") || name.includes("handout") || name.includes("notes")) {
    return { shouldImport: true, materialType: "NOTES" };
  }

  const isSupportedDoc =
    type.includes("pdf") ||
    isModernDocx ||
    type.includes("epub") ||
    type.includes("text/plain") ||
    name.endsWith(".pdf") ||
    name.endsWith(".epub") ||
    name.endsWith(".txt");
  if (isSupportedDoc) return { shouldImport: true, materialType: "BOOK" };

  return { shouldImport: false, skipReason: `unsupported type${type ? ` (${type})` : ""}`, recordAsSkipped: true };
}

/**
 * The stable dedup identity for a discovered resource — "canvas_account +
 * course_id + canvas_file_id" from the spec, adapted: classId already maps
 * 1:1 to a Canvas course, so (classId, canvasResourceId) alone is enough;
 * see the @@unique on ClassMaterial. Non-file resources get a synthetic
 * but still stable id, since Canvas gives them no file id at all.
 */
export function deriveCanvasResourceId(input: {
  resourceType: ResourceType;
  canvasFileId?: string;
  pageSlug?: string;
  externalUrl?: string;
}): string {
  switch (input.resourceType) {
    case "file":
      if (!input.canvasFileId) throw new Error("file resource missing canvasFileId");
      return input.canvasFileId;
    case "page":
      if (!input.pageSlug) throw new Error("page resource missing pageSlug");
      return `page:${input.pageSlug}`;
    case "syllabus":
      return "syllabus";
    case "external":
      if (!input.externalUrl) throw new Error("external resource missing externalUrl");
      return `url:${crypto.createHash("sha256").update(input.externalUrl).digest("hex")}`;
  }
}

export interface DiscoveredResource {
  canvasResourceId: string;
  resourceType: ResourceType;
  title: string;
  filename: string;
  contentType?: string;
  size?: number;
  updatedAt: string | null; // Canvas's ISO updated_at, or null when Canvas gives none (e.g. an external link)
  sourceUrl: string;
}

/**
 * Collapses resources discovered through more than one Canvas location
 * (Files + a Module item pointing at the same file, most commonly) into
 * one entry per canvasResourceId — this is what makes "same file
 * referenced from Files and Modules" import exactly once. When two
 * discoveries share an id, the one with richer metadata (content-type,
 * size — present from the Files endpoint, absent from a bare file-id
 * scraped out of a page's HTML) wins, since it's the more complete record.
 */
export function dedupeDiscovered(resources: DiscoveredResource[]): DiscoveredResource[] {
  const byId = new Map<string, DiscoveredResource>();
  for (const resource of resources) {
    const existing = byId.get(resource.canvasResourceId);
    if (!existing || (!existing.contentType && resource.contentType)) {
      byId.set(resource.canvasResourceId, resource);
    }
  }
  return [...byId.values()];
}

export interface ExistingMaterialRecord {
  canvasResourceId: string;
  canvasUpdatedAt: Date | null;
  // Optional so callers that never track it (e.g. a hand-built test
  // fixture) don't have to pass it — undefined is treated the same as any
  // non-"MISSING" status.
  syncStatus?: string | null;
}

export interface SyncPlan {
  toCreate: DiscoveredResource[];
  toUpdate: DiscoveredResource[];
  toSkip: DiscoveredResource[];
  toMarkMissing: string[];
}

/**
 * The one function that decides what a sync run actually needs to do,
 * given what's already in the database and what was just discovered.
 * Deliberately the same function for a course's first-ever sync (existing
 * = []) and every incremental sync after it — that's what "first-time and
 * future synchronization use the same underlying sync engine" means here.
 */
export function planSync(existing: ExistingMaterialRecord[], discovered: DiscoveredResource[]): SyncPlan {
  const existingById = new Map(existing.map((e) => [e.canvasResourceId, e]));
  const discoveredIds = new Set(discovered.map((d) => d.canvasResourceId));

  const toCreate: DiscoveredResource[] = [];
  const toUpdate: DiscoveredResource[] = [];
  const toSkip: DiscoveredResource[] = [];

  for (const resource of discovered) {
    const prior = existingById.get(resource.canvasResourceId);
    if (!prior) {
      toCreate.push(resource);
      continue;
    }
    if (prior.syncStatus === "MISSING") {
      // It disappeared from a previous sync and has now reappeared —
      // always reprocess rather than trusting a timestamp comparison
      // against a record that's been stale since whenever it first went
      // missing (its canvasUpdatedAt reflects the last time it was
      // actually seen, not "unchanged since").
      toUpdate.push(resource);
      continue;
    }
    const priorTime = prior.canvasUpdatedAt?.getTime() ?? 0;
    const newTime = resource.updatedAt ? new Date(resource.updatedAt).getTime() : NaN;
    // No reliable timestamp to compare (e.g. an external link, which has
    // no Canvas-side updated_at) — treat as unchanged rather than
    // re-processing it every single sync.
    if (Number.isNaN(newTime) || newTime <= priorTime) {
      toSkip.push(resource);
    } else {
      toUpdate.push(resource);
    }
  }

  const toMarkMissing = existing.map((e) => e.canvasResourceId).filter((id) => !discoveredIds.has(id));

  return { toCreate, toUpdate, toSkip, toMarkMissing };
}

/**
 * Canvas file links embedded in a page/assignment/syllabus HTML body —
 * absolute ("https://school.instructure.com/courses/1/files/2") or
 * host-relative ("/courses/1/files/2", "/files/2"). A link to a
 * *different* Canvas host (e.g. quoted from another school's public page)
 * is deliberately excluded — canvasHost should be the connected account's
 * own Canvas domain.
 */
export function extractCanvasFileIdsFromHtml(html: string, canvasHost: string): string[] {
  const ids = new Set<string>();
  const pattern = /(?:https?:\/\/([^/"'\s]+))?\/(?:courses\/\d+\/)?files\/(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const host = match[1];
    if (host && host !== canvasHost) continue;
    ids.add(match[2]);
  }
  return [...ids];
}
