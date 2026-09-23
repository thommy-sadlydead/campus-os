// Canvas materials sync orchestration — discovers a course's real
// documents (Files, Modules, Pages, Syllabus, and files linked from
// Assignment descriptions), decides what's new/changed/gone via
// canvas-materials.ts's pure planSync, and writes ClassMaterial rows.
// Driven by src/app/canvas/actions.ts, one bounded chunk of work per call
// (see processCourseChunk) so a course with hundreds of resources never
// risks a function-duration timeout — the client polls repeatedly instead
// of one call doing everything (same shape as Lecture's
// UPLOADED->TRANSCRIBING->GENERATING_NOTES status machine).
//
// Takes a PrismaClient as a parameter rather than importing the app's
// singleton — see the same note in canvas-sync.ts.
//
// Unlike canvas.ts/canvas-sync.ts, this module IS effectively server-only
// (transitively, via pdf-ocr.ts's Anthropic client) — every real caller is
// already a "use server" action in src/app/canvas/actions.ts, so this
// doesn't affect production, but a standalone script importing this module
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
  planSync,
  extractCanvasFileIdsFromHtml,
  type DiscoveredResource,
  type ExistingMaterialRecord,
  type MaterialType,
} from "./canvas-materials";
import { extractDocumentText } from "./office-text";
import { ocrPdf } from "./pdf-ocr";
import { htmlToReadableText } from "./text";
import { MAX_MATERIAL_TITLE_LENGTH, MAX_MATERIAL_CONTENT_LENGTH } from "./lecture-notes";

// How many not-yet-processed resources one processCourseChunk call handles.
// Kept small enough that even DOWNLOAD_CONCURRENCY slow file downloads
// comfortably finish well within a serverless function's duration — the
// client just polls again for the rest, same as Lecture's status polling.
const RESOURCES_PER_CHUNK = 5;
const DOWNLOAD_CONCURRENCY = 3;

/** Hand-rolled bounded-concurrency map — not worth a new dependency for this. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
    canvasResourceId: deriveCanvasResourceId({ resourceType: "file", canvasFileId: String(f.id) }),
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
// isWorthTracking below and processFileResource, which resolves it via
// fetchCanvasFileMeta.
function fileStub(fileId: string, baseUrl: string, courseId: number): DiscoveredResource {
  return {
    canvasResourceId: deriveCanvasResourceId({ resourceType: "file", canvasFileId: fileId }),
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
              canvasResourceId: deriveCanvasResourceId({ resourceType: "page", pageSlug: item.page_url }),
              resourceType: "page",
              title: item.title,
              filename: item.title,
              updatedAt: null, // the Pages list fetch below fills in a real entry with the actual timestamp
              sourceUrl: `${cfg.baseUrl.replace(/\/$/, "")}/courses/${courseId}/pages/${item.page_url}`,
            });
          } else if (item.type === "ExternalUrl" && item.external_url) {
            discovered.push({
              canvasResourceId: deriveCanvasResourceId({ resourceType: "external", externalUrl: item.external_url }),
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
        canvasResourceId: deriveCanvasResourceId({ resourceType: "page", pageSlug: p.url }),
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
          canvasResourceId: deriveCanvasResourceId({ resourceType: "syllabus" }),
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

/**
 * Whether a discovered resource is worth a processing slot at all. A file
 * stub (Modules/Pages/Assignments/Syllabus link with no metadata yet)
 * always passes through — its real type is only knowable after
 * fetchCanvasFileMeta, which happens during processing. Everything else
 * already carries enough to classify for free (no network call), so pure
 * Canvas noise (banner images, etc.) is dropped here, before it can ever
 * occupy a chunk slot a real document could have used.
 */
function isWorthTracking(resource: DiscoveredResource): boolean {
  if (resource.resourceType === "file" && resource.contentType === undefined) return true;
  const result = classifyResource({
    contentType: resource.contentType,
    filename: resource.filename,
    resourceType: resource.resourceType,
  });
  return result.shouldImport || result.recordAsSkipped;
}

interface UpsertInput {
  title: string;
  content: string;
  materialType: MaterialType;
  syncStatus: string;
  syncError?: string | null;
  canvasUpdatedAt: Date | null;
  sourceUrl?: string | null;
}

/**
 * Writes one ClassMaterial row, keyed by the (classId, provider,
 * canvasResourceId) dedup constraint — always writes, even for a skip or a
 * failure, not just a success. That's what makes re-discovery-on-every-chunk
 * self-limiting: once a resource has a row, planSync sees it as existing
 * and won't hand it back out for reprocessing unless Canvas reports it
 * changed, so a permanently-unreadable file or a piece of pure noise only
 * ever costs one metadata fetch, not one on every future sync.
 */
async function upsertMaterial(
  prisma: PrismaClient,
  classId: string,
  resource: DiscoveredResource,
  input: UpsertInput
): Promise<"synced" | "failed"> {
  const data = {
    resourceType: resource.resourceType,
    type: input.materialType,
    title: input.title.slice(0, MAX_MATERIAL_TITLE_LENGTH),
    content: input.content.slice(0, MAX_MATERIAL_CONTENT_LENGTH),
    sourceUrl: input.sourceUrl ?? resource.sourceUrl,
    canvasUpdatedAt: input.canvasUpdatedAt,
    lastSyncedAt: new Date(),
    syncStatus: input.syncStatus,
    syncError: input.syncError ?? null,
  };
  await prisma.classMaterial.upsert({
    where: {
      classId_provider_canvasResourceId: { classId, provider: "canvas", canvasResourceId: resource.canvasResourceId },
    },
    create: { classId, provider: "canvas", canvasResourceId: resource.canvasResourceId, ...data },
    update: data,
  });
  return input.syncStatus === "FAILED" ? "failed" : "synced";
}

async function processFileResource(
  prisma: PrismaClient,
  cfg: CanvasConfig,
  classId: string,
  resource: DiscoveredResource
): Promise<"synced" | "failed"> {
  let meta: CanvasFile;
  try {
    meta = await fetchCanvasFileMeta(cfg, resource.canvasResourceId);
  } catch (err) {
    // No real metadata to work with — fall back to the stub's own (often
    // null) updatedAt. A null canvasUpdatedAt makes planSync treat this as
    // permanently "unchanged" on future syncs (see the "no reliable
    // timestamp" branch there), which is exactly what's wanted here too:
    // a file that 403s/404s every attempt shouldn't be retried forever.
    return upsertMaterial(prisma, classId, resource, {
      title: resource.title,
      content: `Couldn't import "${resource.title}" from Canvas: ${err instanceof Error ? err.message : "unknown error"}.`,
      materialType: "BOOK",
      syncStatus: "FAILED",
      syncError: err instanceof Error ? err.message : "Unknown error.",
      canvasUpdatedAt: resource.updatedAt ? new Date(resource.updatedAt) : null,
    });
  }

  const classification = classifyResource({
    contentType: meta["content-type"],
    filename: meta.display_name,
    resourceType: "file",
  });
  const canvasUpdatedAt = new Date(meta.updated_at);

  if (!classification.shouldImport) {
    return upsertMaterial(prisma, classId, resource, {
      title: meta.display_name,
      content: `Canvas file "${meta.display_name}" was found but not imported automatically (${classification.skipReason}).`,
      materialType: "BOOK",
      syncStatus: classification.recordAsSkipped ? "SKIPPED_UNSUPPORTED" : "SKIPPED_NOISE",
      syncError: classification.skipReason,
      canvasUpdatedAt,
    });
  }

  if (meta.locked_for_user) {
    // canvasUpdatedAt is deliberately NOT stored here (null instead) even
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
      canvasUpdatedAt: null,
    });
  }
  if (meta.size > MAX_DOCUMENT_FILE_BYTES) {
    return upsertMaterial(prisma, classId, resource, {
      title: meta.display_name,
      content: `Canvas file "${meta.display_name}" is too large to import automatically (${Math.round(meta.size / 1024 / 1024)}MB).`,
      materialType: classification.materialType,
      syncStatus: "SKIPPED_TOO_LARGE",
      canvasUpdatedAt,
    });
  }

  try {
    const buffer = await downloadCanvasFile(meta);
    const contentType = meta["content-type"] || "";
    let content: string | null;
    try {
      content = await extractDocumentText(buffer, contentType, meta.display_name);
    } catch (err) {
      console.error("Canvas file text extraction failed:", err);
      content = null;
    }

    // A PDF with no (or a near-empty) text layer is almost always a
    // scanned document — real course material (textbook chapters,
    // homework solutions) confirmed live, not a rare edge case. Fall back
    // to OCR instead of giving up: send the whole PDF to Claude directly
    // and ask it to transcribe it.
    const isPdf = contentType.includes("pdf") || meta.display_name.toLowerCase().endsWith(".pdf");
    if (isPdf && (content === null || content.trim().length < 20)) {
      content = await ocrPdf(buffer);
    }

    if (content === null || content.trim().length < 20) {
      const ext = meta.display_name.split(".").pop()?.toUpperCase();
      throw new Error(
        content === null
          ? `Can't read ${ext ? `${ext} files` : "that file"} yet — try pasting the text directly instead.`
          : "Couldn't find readable text in that file, even with OCR — it might be blank or too low-quality to read."
      );
    }

    return upsertMaterial(prisma, classId, resource, {
      title: meta.display_name,
      content,
      materialType: classification.materialType,
      syncStatus: "READY",
      canvasUpdatedAt,
      sourceUrl: resource.sourceUrl,
    });
  } catch (err) {
    // canvasUpdatedAt: null here too, for the same reason as the
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
      canvasUpdatedAt: null,
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
  const pageSlug = resource.canvasResourceId.replace(/^page:/, "");
  try {
    const detail = await fetchPageBody(cfg, courseId, pageSlug);
    const text = detail.body ? htmlToReadableText(detail.body) : "";
    const canvasUpdatedAt = new Date(detail.updated_at);
    if (text.trim().length < 20) {
      return upsertMaterial(prisma, classId, resource, {
        title: detail.title,
        content: `Canvas page "${detail.title}" has no readable content.`,
        materialType: "NOTES",
        syncStatus: "SKIPPED_UNSUPPORTED",
        syncError: "No readable content.",
        canvasUpdatedAt,
      });
    }
    return upsertMaterial(prisma, classId, resource, {
      title: detail.title,
      content: text,
      materialType: "NOTES",
      syncStatus: "READY",
      canvasUpdatedAt,
    });
  } catch (err) {
    return upsertMaterial(prisma, classId, resource, {
      title: resource.title,
      content: `Couldn't import Canvas page "${resource.title}": ${err instanceof Error ? err.message : "unknown error"}.`,
      materialType: "NOTES",
      syncStatus: "FAILED",
      syncError: err instanceof Error ? err.message : "Unknown error.",
      canvasUpdatedAt: null,
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
        canvasUpdatedAt: null,
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
      canvasUpdatedAt: null,
    });
  } catch (err) {
    return upsertMaterial(prisma, classId, resource, {
      title: "Syllabus",
      content: `Couldn't import this course's syllabus: ${err instanceof Error ? err.message : "unknown error"}.`,
      materialType: "SYLLABUS",
      syncStatus: "FAILED",
      syncError: err instanceof Error ? err.message : "Unknown error.",
      canvasUpdatedAt: null,
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
    canvasUpdatedAt: null,
  });
}

async function processOneResource(
  prisma: PrismaClient,
  cfg: CanvasConfig,
  courseId: number,
  classId: string,
  resource: DiscoveredResource
): Promise<"synced" | "failed"> {
  try {
    switch (resource.resourceType) {
      case "file":
        return await processFileResource(prisma, cfg, classId, resource);
      case "page":
        return await processPageResource(prisma, cfg, courseId, classId, resource);
      case "syllabus":
        return await processSyllabusResource(prisma, cfg, courseId, classId, resource);
      case "external":
        return await processExternalResource(prisma, classId, resource);
    }
  } catch (err) {
    // Every branch above already catches its own errors internally and
    // upserts a FAILED row — this only catches something escaping that
    // (e.g. a database write itself failing), so the whole chunk can't be
    // brought down by one resource's unexpected error either way.
    console.error(`Canvas materials sync: unexpected error processing ${resource.canvasResourceId} for class ${classId}:`, err);
    return "failed";
  }
}

/**
 * Advances one course's sync by one bounded chunk of work: discover, diff
 * against what's already stored, mark anything that's disappeared, then
 * download+extract up to RESOURCES_PER_CHUNK not-yet-synced resources.
 * Deliberately re-discovers from Canvas and re-plans from scratch on every
 * call rather than persisting a separate work queue — since every
 * processed resource (success, skip, AND failure) writes a ClassMaterial
 * row, the next call's fresh planSync naturally sees it as already done
 * and won't hand it out again, which is what makes this resumable without
 * extra state: an interrupted sync just continues from wherever the
 * database says it left off.
 */
export async function processCourseChunk(
  prisma: PrismaClient,
  cfg: CanvasConfig,
  cls: { id: string; canvasCourseId: string },
  state: { id: string; status: string }
): Promise<void> {
  const courseId = Number(cls.canvasCourseId);
  const isFirstRun = state.status === "PENDING";

  await prisma.canvasSyncCourseState.update({
    where: { id: state.id },
    data: { status: "DISCOVERING", errorMessage: null, ...(isFirstRun ? { startedAt: new Date() } : {}) },
  });

  let discovered: DiscoveredResource[];
  try {
    discovered = await discoverCourseResources(cfg, courseId);
  } catch (err) {
    console.error(`Canvas materials discovery failed for class ${cls.id}:`, err);
    await prisma.canvasSyncCourseState.update({
      where: { id: state.id },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Discovery failed.",
        finishedAt: new Date(),
      },
    });
    return;
  }

  const relevant = discovered.filter(isWorthTracking);

  const existingRows = await prisma.classMaterial.findMany({
    where: { classId: cls.id, provider: "canvas" },
    select: { canvasResourceId: true, canvasUpdatedAt: true, syncStatus: true },
  });
  const existingRecords: ExistingMaterialRecord[] = existingRows
    .filter((r): r is { canvasResourceId: string; canvasUpdatedAt: Date | null; syncStatus: string | null } => r.canvasResourceId !== null)
    .map((r) => ({ canvasResourceId: r.canvasResourceId, canvasUpdatedAt: r.canvasUpdatedAt, syncStatus: r.syncStatus }));

  const plan = planSync(existingRecords, relevant);

  if (plan.toMarkMissing.length > 0) {
    await prisma.classMaterial.updateMany({
      where: { classId: cls.id, provider: "canvas", canvasResourceId: { in: plan.toMarkMissing } },
      data: { syncStatus: "MISSING" },
    });
  }

  const pending = [...plan.toCreate, ...plan.toUpdate];
  const thisChunk = pending.slice(0, RESOURCES_PER_CHUNK);

  await prisma.canvasSyncCourseState.update({
    where: { id: state.id },
    data: { status: "DOWNLOADING", resourcesFound: relevant.length },
  });

  await mapWithConcurrency(thisChunk, DOWNLOAD_CONCURRENCY, (resource) =>
    processOneResource(prisma, cfg, courseId, cls.id, resource)
  );

  const materialRows = await prisma.classMaterial.findMany({
    where: { classId: cls.id, provider: "canvas" },
    select: { syncStatus: true },
  });
  const resourcesFailed = materialRows.filter((m) => m.syncStatus === "FAILED").length;
  const resourcesDone = materialRows.filter((m) => m.syncStatus !== "FAILED" && m.syncStatus !== "MISSING").length;

  const finished = pending.length - thisChunk.length === 0;
  await prisma.canvasSyncCourseState.update({
    where: { id: state.id },
    data: {
      status: finished ? (resourcesFailed > 0 ? "PARTIAL" : "READY") : "DOWNLOADING",
      resourcesFound: relevant.length,
      resourcesDone,
      resourcesFailed,
      finishedAt: finished ? new Date() : null,
    },
  });
}

const TERMINAL_STATUSES = new Set(["READY", "PARTIAL", "FAILED"]);
const IN_FLIGHT_STATUSES = new Set(["DISCOVERING", "DOWNLOADING"]);

/**
 * (Re)queues every Canvas-linked class for a materials sync. Used both
 * right after a course/assignment sync finishes connecting Canvas for the
 * first time (every class is new, so every state is freshly created as
 * PENDING) and by the manual "go fetch" button later (existing terminal
 * states reset to PENDING to trigger a fresh incremental scan) — the same
 * call serves both, which is what makes first-time and future sync "the
 * same underlying engine" at this level too. A course already mid-sync
 * (DISCOVERING/DOWNLOADING) is left alone rather than interrupted.
 */
export async function queueCourseMaterialSync(prisma: PrismaClient, userId: string): Promise<void> {
  const classes = await prisma.class.findMany({
    where: { userId, canvasCourseId: { not: null } },
    select: { id: true, syncState: { select: { status: true } } },
  });

  for (const cls of classes) {
    if (cls.syncState && IN_FLIGHT_STATUSES.has(cls.syncState.status)) continue;
    await prisma.canvasSyncCourseState.upsert({
      where: { classId: cls.id },
      update: { status: "PENDING", errorMessage: null, finishedAt: null },
      create: { classId: cls.id, status: "PENDING" },
    });
  }
}

export interface CourseSyncProgress {
  classId: string;
  className: string;
  status: string;
  resourcesFound: number;
  resourcesDone: number;
  resourcesFailed: number;
  errorMessage: string | null;
}

/**
 * Advances the sync by exactly one chunk of work for one not-yet-finished
 * course, then returns fresh progress for every Canvas-linked class — the
 * client polls this on an interval (see MaterialSyncPanel) and stops once
 * every course reports a terminal status. One course per call, not "keep
 * going until everything's done in one request," so a class with a huge
 * number of resources can't starve its siblings from ever being picked up
 * (each call's course choice is oldest-updated-first) and every call stays
 * fast regardless of how much total work remains.
 */
export async function advanceCanvasMaterialSync(
  prisma: PrismaClient,
  cfg: CanvasConfig,
  userId: string
): Promise<CourseSyncProgress[]> {
  const classes = await prisma.class.findMany({
    where: { userId, canvasCourseId: { not: null } },
    include: { syncState: true },
  });

  const next = classes
    .filter((c) => c.syncState && !TERMINAL_STATUSES.has(c.syncState.status))
    .sort((a, b) => a.syncState!.updatedAt.getTime() - b.syncState!.updatedAt.getTime())[0];

  if (next?.canvasCourseId && next.syncState) {
    try {
      await processCourseChunk(prisma, cfg, { id: next.id, canvasCourseId: next.canvasCourseId }, next.syncState);
    } catch (err) {
      console.error(`Canvas materials sync chunk failed for class ${next.id}:`, err);
      // This write can itself fail (confirmed live: a transient database
      // connection-pool timeout hit here too, right after tripping the
      // same error in processCourseChunk above) — without its own
      // try/catch, that second failure would propagate out of this
      // function uncaught, breaking the caller (the client's polling
      // loop) instead of just leaving this one course's state as-is for
      // the next tick to reconcile, which is the same self-healing
      // recovery every other transient failure here already gets.
      try {
        await prisma.canvasSyncCourseState.update({
          where: { id: next.syncState.id },
          data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : "Sync failed.", finishedAt: new Date() },
        });
      } catch (writeErr) {
        console.error(`Canvas materials sync: also failed to record the failure for class ${next.id}:`, writeErr);
      }
    }
  }

  // Re-fetched rather than reusing `classes` from the top of this
  // function, since that snapshot predates whatever this call just did —
  // but that same staleness makes it a reasonable fallback if this
  // specific query is what a transient failure (e.g. the connection-pool
  // timeout confirmed live above) happens to hit: better to return
  // one-tick-stale progress than to throw and break the caller entirely,
  // especially since the caller's own next poll will refresh it anyway.
  let refreshed;
  try {
    refreshed = await prisma.class.findMany({
      where: { userId, canvasCourseId: { not: null } },
      include: { syncState: true },
      orderBy: { name: "asc" },
    });
  } catch (err) {
    console.error(`Canvas materials sync: failed to refresh progress for user ${userId}, returning last-known state:`, err);
    refreshed = [...classes].sort((a, b) => a.name.localeCompare(b.name));
  }

  return refreshed.map((c) => ({
    classId: c.id,
    className: c.name,
    status: c.syncState?.status ?? "PENDING",
    resourcesFound: c.syncState?.resourcesFound ?? 0,
    resourcesDone: c.syncState?.resourcesDone ?? 0,
    resourcesFailed: c.syncState?.resourcesFailed ?? 0,
    errorMessage: c.syncState?.errorMessage ?? null,
  }));
}
