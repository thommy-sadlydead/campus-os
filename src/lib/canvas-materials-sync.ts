// Canvas materials discovery and import — finds a course's real documents
// (Files, Modules, Pages, Syllabus, and files linked from Assignment
// descriptions) and reads each one into a ClassMaterial row. The shared
// engine in materials-sync.ts decides what's new/changed/gone and drives
// the per-course status machine; this file is the Canvas MaterialsSource
// it calls (canvasMaterialsSource), driven by
// src/app/canvas/actions.ts.
//
// Unlike canvas.ts/canvas-sync.ts, this module IS effectively server-only
// (transitively, via materials-sync.ts → pdf-ocr.ts's Anthropic client) —
// every real caller is already a "use server" action, so this doesn't
// affect production, but a standalone script importing this module
// directly (e.g. for ad hoc verification) needs a Next.js server context
// to load it, the same as src/lib/crypto.ts.
import type { PrismaClient } from "@prisma/client";
import {
  CanvasApiError,
  fetchCourseFiles,
  fetchCourseModules,
  fetchModuleItems,
  fetchCoursePages,
  fetchPageBody,
  fetchCourseSyllabus,
  fetchCourseAssignments,
  fetchCanvasFileMeta,
  downloadCanvasFile,
  MAX_DOCUMENT_FILE_BYTES,
  type CanvasConfig,
  type CanvasFile,
} from "./canvas";
import {
  classifyResource,
  deriveCanvasResourceId,
  dedupeDiscovered,
  extractCanvasFileIdsFromHtml,
  type DiscoveredResource,
} from "./canvas-materials";
import {
  readDocumentText,
  upsertMaterial as upsertAnyMaterial,
  type MaterialSyncOptions,
  type MaterialsSource,
  type UpsertInput,
} from "./materials-sync";
import { htmlToReadableText } from "./text";

function canvasHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

function fileSourceUrl(baseUrl: string, courseId: number, fileId: number | string): string {
  return `${baseUrl.replace(/\/$/, "")}/courses/${courseId}/files/${fileId}`;
}

function fileToResource(f: CanvasFile, baseUrl: string, courseId: number): DiscoveredResource {
  return {
    resourceId: deriveCanvasResourceId({ resourceType: "file", canvasFileId: String(f.id) }),
    resourceType: "file",
    title: f.display_name,
    filename: f.display_name,
    contentType: f["content-type"],
    size: f.size,
    updatedAt: f.updated_at,
    sourceUrl: fileSourceUrl(baseUrl, courseId, f.id),
  };
}

// A file id scraped out of a Module item / Page body / Assignment
// description / Syllabus body — we know it exists and where it lives, but
// not its type or size yet (Canvas doesn't inline that into any of those
// sources). contentType is deliberately left undefined so downstream code
// can tell a stub apart from a fully-known Files-endpoint entry — see
// isWorthTracking in materials-sync.ts and processFileResource, which
// resolves it via fetchCanvasFileMeta.
function fileStub(fileId: string, baseUrl: string, courseId: number): DiscoveredResource {
  return {
    resourceId: deriveCanvasResourceId({ resourceType: "file", canvasFileId: fileId }),
    resourceType: "file",
    title: `File ${fileId}`,
    filename: `file-${fileId}`,
    updatedAt: null,
    sourceUrl: fileSourceUrl(baseUrl, courseId, fileId),
  };
}

/**
 * Pulls together every place a course's real documents can live. Each
 * source is fetched independently and defensively — a course with its
 * Files tab hidden (confirmed on real data: Canvas returns 403 for that
 * list even though the individual files are still fetchable) or a broken
 * source shouldn't prevent the others from contributing, and shouldn't
 * fail the whole course's discovery. A file referenced from more than one
 * source (e.g. Files AND a Module item) collapses to one entry via
 * dedupeDiscovered, keyed by the same Canvas file id either way.
 */
export async function discoverCourseResources(cfg: CanvasConfig, courseId: number): Promise<DiscoveredResource[]> {
  const canvasHost = canvasHostname(cfg.baseUrl);
  const discovered: DiscoveredResource[] = [];

  try {
    const files = await fetchCourseFiles(cfg, courseId);
    for (const f of files) discovered.push(fileToResource(f, cfg.baseUrl, courseId));
  } catch (err) {
    // A 403 here just means the instructor hid the course's Files tab —
    // expected and common, not an error. The same files are still
    // reachable through Modules/Pages below, so this isn't logged.
    if (!(err instanceof CanvasApiError && err.status === 403)) {
      console.error(`Canvas Files discovery failed for course ${courseId}:`, err);
    }
  }

  try {
    const modules = await fetchCourseModules(cfg, courseId);
    for (const mod of modules) {
      try {
        const items = await fetchModuleItems(cfg, courseId, mod.id);
        for (const item of items) {
          if (item.type === "File" && item.content_id) {
            discovered.push(fileStub(String(item.content_id), cfg.baseUrl, courseId));
          } else if (item.type === "Page" && item.page_url) {
            discovered.push({
              resourceId: deriveCanvasResourceId({ resourceType: "page", pageSlug: item.page_url }),
              resourceType: "page",
              title: item.title,
              filename: item.title,
              updatedAt: null, // the Pages list fetch below fills in a real entry with the actual timestamp
              sourceUrl: `${cfg.baseUrl.replace(/\/$/, "")}/courses/${courseId}/pages/${item.page_url}`,
            });
          } else if (item.type === "ExternalUrl" && item.external_url) {
            discovered.push({
              resourceId: deriveCanvasResourceId({ resourceType: "external", externalUrl: item.external_url }),
              resourceType: "external",
              title: item.title,
              filename: item.title,
              updatedAt: null,
              sourceUrl: item.external_url,
            });
          }
        }
      } catch (err) {
        console.error(`Canvas module ${mod.id} items failed for course ${courseId}:`, err);
      }
    }
  } catch (err) {
    console.error(`Canvas Modules discovery failed for course ${courseId}:`, err);
  }

  try {
    const pages = await fetchCoursePages(cfg, courseId);
    for (const p of pages) {
      discovered.push({
        resourceId: deriveCanvasResourceId({ resourceType: "page", pageSlug: p.url }),
        resourceType: "page",
        title: p.title,
        filename: p.title,
        updatedAt: p.updated_at,
        sourceUrl: `${cfg.baseUrl.replace(/\/$/, "")}/courses/${courseId}/pages/${p.url}`,
      });

      try {
        const detail = await fetchPageBody(cfg, courseId, p.url);
        if (detail.body) {
          for (const fileId of extractCanvasFileIdsFromHtml(detail.body, canvasHost)) {
            discovered.push(fileStub(fileId, cfg.baseUrl, courseId));
          }
        }
      } catch (err) {
        console.error(`Canvas page body fetch failed for course ${courseId}, page ${p.url}:`, err);
      }
    }
  } catch (err) {
    console.error(`Canvas Pages discovery failed for course ${courseId}:`, err);
  }

  // Assignments are never imported as materials themselves — only files
  // linked from their descriptions are (an assignment's prompt text isn't
  // "study material" the way a linked reading or slide deck is).
  try {
    const assignments = await fetchCourseAssignments(cfg, courseId);
    for (const a of assignments) {
      if (!a.description) continue;
      for (const fileId of extractCanvasFileIdsFromHtml(a.description, canvasHost)) {
        discovered.push(fileStub(fileId, cfg.baseUrl, courseId));
      }
    }
  } catch (err) {
    console.error(`Canvas Assignments scan failed for course ${courseId}:`, err);
  }

  try {
    const syllabusHtml = await fetchCourseSyllabus(cfg, courseId);
    if (syllabusHtml) {
      const text = htmlToReadableText(syllabusHtml);
      if (text.trim().length >= 20) {
        discovered.push({
          resourceId: deriveCanvasResourceId({ resourceType: "syllabus" }),
          resourceType: "syllabus",
          title: "Syllabus",
          filename: "Syllabus",
          updatedAt: null, // Canvas exposes no separate syllabus-body timestamp — see Known Limitations
          sourceUrl: `${cfg.baseUrl.replace(/\/$/, "")}/courses/${courseId}/assignments/syllabus`,
        });
      }
      for (const fileId of extractCanvasFileIdsFromHtml(syllabusHtml, canvasHost)) {
        discovered.push(fileStub(fileId, cfg.baseUrl, courseId));
      }
    }
  } catch (err) {
    console.error(`Canvas Syllabus discovery failed for course ${courseId}:`, err);
  }

  return dedupeDiscovered(discovered);
}

// Canvas's rows: the shared upsertMaterial, as provider "canvas".
function upsertMaterial(
  prisma: PrismaClient,
  classId: string,
  resource: DiscoveredResource,
  input: UpsertInput
): Promise<"synced" | "failed"> {
  return upsertAnyMaterial(prisma, "canvas", classId, resource, input);
}

async function processFileResource(
  prisma: PrismaClient,
  cfg: CanvasConfig,
  classId: string,
  resource: DiscoveredResource,
  options: MaterialSyncOptions
): Promise<"synced" | "failed"> {
  let meta: CanvasFile;
  try {
    meta = await fetchCanvasFileMeta(cfg, resource.resourceId);
  } catch (err) {
    // No real metadata to work with — fall back to the stub's own (often
    // null) updatedAt. A null lmsUpdatedAt makes planSync treat this as
    // permanently "unchanged" on future syncs (see the "no reliable
    // timestamp" branch there), which is exactly what's wanted here too:
    // a file that 403s/404s every attempt shouldn't be retried forever.
    return upsertMaterial(prisma, classId, resource, {
      title: resource.title,
      content: `Couldn't import "${resource.title}" from Canvas: ${err instanceof Error ? err.message : "unknown error"}.`,
      materialType: "BOOK",
      syncStatus: "FAILED",
      syncError: err instanceof Error ? err.message : "Unknown error.",
      lmsUpdatedAt: resource.updatedAt ? new Date(resource.updatedAt) : null,
    });
  }

  const classification = classifyResource({
    contentType: meta["content-type"],
    filename: meta.display_name,
    resourceType: "file",
  });
  const lmsUpdatedAt = new Date(meta.updated_at);

  if (!classification.shouldImport) {
    return upsertMaterial(prisma, classId, resource, {
      title: meta.display_name,
      content: `Canvas file "${meta.display_name}" was found but not imported automatically (${classification.skipReason}).`,
      materialType: "BOOK",
      syncStatus: classification.recordAsSkipped ? "SKIPPED_UNSUPPORTED" : "SKIPPED_NOISE",
      syncError: classification.skipReason,
      lmsUpdatedAt,
    });
  }

  if (meta.locked_for_user) {
    // lmsUpdatedAt is deliberately NOT stored here (null instead) even
    // though the real metadata timestamp is right there — Canvas doesn't
    // bump a file's updated_at just because a lock/unlock date passed, so
    // storing the real timestamp would make planSync see this as
    // "unchanged" forever and never retry it even after the instructor
    // unlocks it (confirmed live: a course's homework-solution files,
    // deliberately locked until after the due date, stayed permanently
    // FAILED across every sync). Storing null instead means the next
    // sync's real discovered timestamp always compares as "newer" (see
    // planSync's priorTime-defaults-to-0 branch), so a locked file is
    // re-checked — and, once unlocked, actually imported — on every sync.
    return upsertMaterial(prisma, classId, resource, {
      title: meta.display_name,
      content: `Canvas file "${meta.display_name}" is locked and can't be read yet.`,
      materialType: classification.materialType,
      syncStatus: "FAILED",
      syncError: "Locked in Canvas.",
      lmsUpdatedAt: null,
    });
  }
  if (meta.size > MAX_DOCUMENT_FILE_BYTES) {
    return upsertMaterial(prisma, classId, resource, {
      title: meta.display_name,
      content: `Canvas file "${meta.display_name}" is too large to import automatically (${Math.round(meta.size / 1024 / 1024)}MB).`,
      materialType: classification.materialType,
      syncStatus: "SKIPPED_TOO_LARGE",
      lmsUpdatedAt,
    });
  }

  try {
    const buffer = await downloadCanvasFile(meta);
    // Falls back to OCR for a scanned PDF (see readDocumentText).
    const content = await readDocumentText(buffer, meta["content-type"] || "", meta.display_name, options);
    return upsertMaterial(prisma, classId, resource, {
      title: meta.display_name,
      content,
      materialType: classification.materialType,
      syncStatus: "READY",
      lmsUpdatedAt,
      sourceUrl: resource.sourceUrl,
    });
  } catch (err) {
    // lmsUpdatedAt: null here too, for the same reason as the
    // locked-file branch above — confirmed live: a scanned PDF's Canvas
    // updated_at doesn't change just because OCR got better (or the
    // download/extract transient-failed), so storing the real timestamp
    // made planSync treat every one of these as "unchanged" and skip them
    // on every later sync, meaning the OCR fallback above never actually
    // ran for any of them. Every FAILED outcome in this function stores
    // null so it's always re-attempted next sync; only a genuine success
    // (READY/SKIPPED_*/EXTERNAL) trusts the real Canvas timestamp.
    return upsertMaterial(prisma, classId, resource, {
      title: meta.display_name,
      content: `Couldn't import "${meta.display_name}": ${err instanceof Error ? err.message : "unknown error"}.`,
      materialType: classification.materialType,
      syncStatus: "FAILED",
      syncError: err instanceof Error ? err.message : "Unknown error.",
      lmsUpdatedAt: null,
    });
  }
}

async function processPageResource(
  prisma: PrismaClient,
  cfg: CanvasConfig,
  courseId: number,
  classId: string,
  resource: DiscoveredResource
): Promise<"synced" | "failed"> {
  const pageSlug = resource.resourceId.replace(/^page:/, "");
  try {
    const detail = await fetchPageBody(cfg, courseId, pageSlug);
    const text = detail.body ? htmlToReadableText(detail.body) : "";
    const lmsUpdatedAt = new Date(detail.updated_at);
    if (text.trim().length < 20) {
      return upsertMaterial(prisma, classId, resource, {
        title: detail.title,
        content: `Canvas page "${detail.title}" has no readable content.`,
        materialType: "NOTES",
        syncStatus: "SKIPPED_UNSUPPORTED",
        syncError: "No readable content.",
        lmsUpdatedAt,
      });
    }
    return upsertMaterial(prisma, classId, resource, {
      title: detail.title,
      content: text,
      materialType: "NOTES",
      syncStatus: "READY",
      lmsUpdatedAt,
    });
  } catch (err) {
    return upsertMaterial(prisma, classId, resource, {
      title: resource.title,
      content: `Couldn't import Canvas page "${resource.title}": ${err instanceof Error ? err.message : "unknown error"}.`,
      materialType: "NOTES",
      syncStatus: "FAILED",
      syncError: err instanceof Error ? err.message : "Unknown error.",
      lmsUpdatedAt: null,
    });
  }
}

async function processSyllabusResource(
  prisma: PrismaClient,
  cfg: CanvasConfig,
  courseId: number,
  classId: string,
  resource: DiscoveredResource
): Promise<"synced" | "failed"> {
  try {
    const html = await fetchCourseSyllabus(cfg, courseId);
    const text = html ? htmlToReadableText(html) : "";
    if (text.trim().length < 20) {
      return upsertMaterial(prisma, classId, resource, {
        title: "Syllabus",
        content: "This course's syllabus has no readable content.",
        materialType: "SYLLABUS",
        syncStatus: "SKIPPED_UNSUPPORTED",
        syncError: "No readable content.",
        lmsUpdatedAt: null,
      });
    }
    return upsertMaterial(prisma, classId, resource, {
      title: "Syllabus",
      content: text,
      materialType: "SYLLABUS",
      syncStatus: "READY",
      // Canvas exposes no separate syllabus-body timestamp, so this can
      // never be detected as "changed" on a future sync — see Known
      // Limitations. Matches how an external link (also no timestamp) is
      // already handled by planSync's "no reliable timestamp" branch.
      lmsUpdatedAt: null,
    });
  } catch (err) {
    return upsertMaterial(prisma, classId, resource, {
      title: "Syllabus",
      content: `Couldn't import this course's syllabus: ${err instanceof Error ? err.message : "unknown error"}.`,
      materialType: "SYLLABUS",
      syncStatus: "FAILED",
      syncError: err instanceof Error ? err.message : "Unknown error.",
      lmsUpdatedAt: null,
    });
  }
}

async function processExternalResource(
  prisma: PrismaClient,
  classId: string,
  resource: DiscoveredResource
): Promise<"synced" | "failed"> {
  // Never fetched — an external/textbook link may sit behind a
  // publisher's own auth or DRM this app has no business trying to
  // bypass. Recorded as metadata + URL only, per the spec.
  return upsertMaterial(prisma, classId, resource, {
    title: resource.title,
    content: `External resource — not automatically imported. Open the link to view it: ${resource.sourceUrl}`,
    materialType: "BOOK",
    syncStatus: "EXTERNAL",
    lmsUpdatedAt: null,
  });
}

async function processOneResource(
  prisma: PrismaClient,
  cfg: CanvasConfig,
  courseId: number,
  classId: string,
  resource: DiscoveredResource,
  options: MaterialSyncOptions
): Promise<"synced" | "failed"> {
  // Each branch catches its own errors and upserts a FAILED row; the
  // engine (processCourseChunk) catches anything that still escapes.
  switch (resource.resourceType) {
    case "file":
      return processFileResource(prisma, cfg, classId, resource, options);
    case "page":
      return processPageResource(prisma, cfg, courseId, classId, resource);
    case "syllabus":
      return processSyllabusResource(prisma, cfg, courseId, classId, resource);
    case "external":
      return processExternalResource(prisma, classId, resource);
  }
}

/** Canvas, for the shared materials engine (materials-sync.ts). */
export function canvasMaterialsSource(cfg: CanvasConfig): MaterialsSource {
  return {
    provider: "canvas",
    discover: (courseId) => discoverCourseResources(cfg, Number(courseId)),
    processOne: (prisma, courseId, classId, resource, options) =>
      processOneResource(prisma, cfg, Number(courseId), classId, resource, options),
  };
}
