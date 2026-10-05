// The course materials sync engine, shared by every LMS that has files to
// import (Canvas and Schoology). An LMS supplies a MaterialsSource: how to
// discover a course's documents and how to fetch and store one. This file
// decides what's new/changed/gone via canvas-materials.ts's pure planSync,
// writes ClassMaterial rows, and drives MaterialSyncState, one bounded chunk
// of work per call (see processCourseChunk) so a course with hundreds of
// resources never risks a function-duration timeout — the client polls
// repeatedly instead of one call doing everything (same shape as Lecture's
// UPLOADED->TRANSCRIBING->GENERATING_NOTES status machine).
//
// Takes a PrismaClient as a parameter rather than importing the app's
// singleton — see the same note in canvas-sync.ts. Effectively server-only
// (transitively, via pdf-ocr.ts's Anthropic client); see CLAUDE.md for
// running it from a standalone script.
import type { PrismaClient } from "@prisma/client";
import {
  classifyResource,
  planSync,
  type DiscoveredResource,
  type ExistingMaterialRecord,
  type MaterialType,
} from "./canvas-materials";
import { extractDocumentText } from "./office-text";
import { ocrPdf } from "./pdf-ocr";
import { MAX_MATERIAL_TITLE_LENGTH, MAX_MATERIAL_CONTENT_LENGTH } from "./lecture-notes";

export type MaterialsProvider = "canvas" | "schoology";

/** Whether a scanned PDF may be sent to Claude to read (the student allowed AI features). */
export interface MaterialSyncOptions {
  readScansWithAi: boolean;
}

export interface MaterialsSource {
  provider: MaterialsProvider;
  /** Every document the course has, deduped. Throws only when nothing at all could be discovered. */
  discover(courseId: string): Promise<DiscoveredResource[]>;
  /**
   * Fetches, reads and stores one resource with upsertMaterial. Always
   * writes a row, even for a skip or a failure (see upsertMaterial).
   */
  processOne(
    prisma: PrismaClient,
    courseId: string,
    classId: string,
    resource: DiscoveredResource,
    options: MaterialSyncOptions
  ): Promise<"synced" | "failed">;
}

// How many not-yet-processed resources one processCourseChunk call handles.
// Kept small enough that even DOWNLOAD_CONCURRENCY slow file downloads
// comfortably finish well within a serverless function's duration — the
// client just polls again for the rest, same as Lecture's status polling.
const RESOURCES_PER_CHUNK = 5;
const DOWNLOAD_CONCURRENCY = 3;

/** Hand-rolled bounded-concurrency map — not worth a new dependency for this. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

/**
 * Whether a discovered resource is worth a processing slot at all. A file
 * stub (a link with no metadata yet) always passes through — its real
 * type is only knowable after fetching its metadata, which happens during
 * processing. Everything else already carries enough to classify for free
 * (no network call), so pure LMS noise (banner images, etc.) is dropped
 * here, before it can ever occupy a chunk slot a real document could have
 * used.
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

export interface UpsertInput {
  title: string;
  content: string;
  materialType: MaterialType;
  syncStatus: string;
  syncError?: string | null;
  lmsUpdatedAt: Date | null;
  sourceUrl?: string | null;
}

/**
 * Writes one ClassMaterial row, keyed by the (classId, provider,
 * lmsResourceId) dedup constraint — always writes, even for a skip or a
 * failure, not just a success. That's what makes re-discovery-on-every-chunk
 * self-limiting: once a resource has a row, planSync sees it as existing
 * and won't hand it back out for reprocessing unless the LMS reports it
 * changed, so a permanently-unreadable file or a piece of pure noise only
 * ever costs one metadata fetch, not one on every future sync.
 */
export async function upsertMaterial(
  prisma: PrismaClient,
  provider: MaterialsProvider,
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
    lmsUpdatedAt: input.lmsUpdatedAt,
    lastSyncedAt: new Date(),
    syncStatus: input.syncStatus,
    syncError: input.syncError ?? null,
  };
  await prisma.classMaterial.upsert({
    where: { classId_provider_lmsResourceId: { classId, provider, lmsResourceId: resource.resourceId } },
    create: { classId, provider, lmsResourceId: resource.resourceId, ...data },
    update: data,
  });
  return input.syncStatus === "FAILED" ? "failed" : "synced";
}

/**
 * A downloaded document's readable text. A PDF with no (or a near-empty)
 * text layer is almost always a scanned document — real course material
 * (textbook chapters, homework solutions) confirmed live, not a rare edge
 * case — so it falls back to OCR: the whole PDF goes to Claude to
 * transcribe, when the student allowed AI features. Throws a message
 * meant for the student when there's nothing readable.
 */
export async function readDocumentText(
  buffer: Buffer,
  contentType: string,
  filename: string,
  options: MaterialSyncOptions
): Promise<string> {
  let content: string | null;
  try {
    content = await extractDocumentText(buffer, contentType, filename);
  } catch (err) {
    console.error("Material text extraction failed:", err);
    content = null;
  }

  const isPdf = contentType.includes("pdf") || filename.toLowerCase().endsWith(".pdf");
  if (isPdf && (content === null || content.trim().length < 20)) {
    if (!options.readScansWithAi) {
      throw new Error("This PDF is a scan. Reading scans uses AI, which is turned off in Account.");
    }
    content = await ocrPdf(buffer);
  }

  if (content === null || content.trim().length < 20) {
    const ext = filename.split(".").pop()?.toUpperCase();
    throw new Error(
      content === null
        ? `Can't read ${ext ? `${ext} files` : "that file"} yet — try pasting the text directly instead.`
        : "Couldn't find readable text in that file, even with OCR — it might be blank or too low-quality to read."
    );
  }
  return content;
}

/**
 * Advances one course's sync by one bounded chunk of work: discover, diff
 * against what's already stored, mark anything that's disappeared, then
 * download+extract up to RESOURCES_PER_CHUNK not-yet-synced resources.
 * Deliberately re-discovers from the LMS and re-plans from scratch on every
 * call rather than persisting a separate work queue — since every
 * processed resource (success, skip, AND failure) writes a ClassMaterial
 * row, the next call's fresh planSync naturally sees it as already done
 * and won't hand it out again, which is what makes this resumable without
 * extra state: an interrupted sync just continues from wherever the
 * database says it left off.
 */
export async function processCourseChunk(
  prisma: PrismaClient,
  source: MaterialsSource,
  cls: { id: string; lmsCourseId: string },
  state: { id: string; status: string },
  options: MaterialSyncOptions
): Promise<void> {
  const isFirstRun = state.status === "PENDING";
  const provider = source.provider;

  await prisma.materialSyncState.update({
    where: { id: state.id },
    data: { status: "DISCOVERING", errorMessage: null, ...(isFirstRun ? { startedAt: new Date() } : {}) },
  });

  let discovered: DiscoveredResource[];
  try {
    discovered = await source.discover(cls.lmsCourseId);
  } catch (err) {
    console.error(`Materials discovery (${provider}) failed for class ${cls.id}:`, err);
    await prisma.materialSyncState.update({
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
    where: { classId: cls.id, provider },
    select: { lmsResourceId: true, lmsUpdatedAt: true, syncStatus: true },
  });
  const existingRecords: ExistingMaterialRecord[] = existingRows.flatMap((r) =>
    r.lmsResourceId === null ? [] : [{ resourceId: r.lmsResourceId, lmsUpdatedAt: r.lmsUpdatedAt, syncStatus: r.syncStatus }]
  );

  const plan = planSync(existingRecords, relevant);

  if (plan.toMarkMissing.length > 0) {
    await prisma.classMaterial.updateMany({
      where: { classId: cls.id, provider, lmsResourceId: { in: plan.toMarkMissing } },
      data: { syncStatus: "MISSING" },
    });
  }

  const pending = [...plan.toCreate, ...plan.toUpdate];
  const thisChunk = pending.slice(0, RESOURCES_PER_CHUNK);

  await prisma.materialSyncState.update({
    where: { id: state.id },
    data: { status: "DOWNLOADING", resourcesFound: relevant.length },
  });

  await mapWithConcurrency(thisChunk, DOWNLOAD_CONCURRENCY, async (resource) => {
    try {
      return await source.processOne(prisma, cls.lmsCourseId, cls.id, resource, options);
    } catch (err) {
      // Every source catches its own errors and upserts a FAILED row — this
      // only catches something escaping that (e.g. a database write itself
      // failing), so the whole chunk can't be brought down by one
      // resource's unexpected error either way.
      console.error(`Materials sync (${provider}): unexpected error processing ${resource.resourceId} for class ${cls.id}:`, err);
      return "failed" as const;
    }
  });

  const materialRows = await prisma.classMaterial.findMany({
    where: { classId: cls.id, provider },
    select: { syncStatus: true },
  });
  const resourcesFailed = materialRows.filter((m) => m.syncStatus === "FAILED").length;
  const resourcesDone = materialRows.filter((m) => m.syncStatus !== "FAILED" && m.syncStatus !== "MISSING").length;

  const finished = pending.length - thisChunk.length === 0;
  await prisma.materialSyncState.update({
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
 * (Re)queues every class synced from this LMS for a materials sync. Used
 * both right after a course/assignment sync finishes connecting the LMS
 * for the first time (every class is new, so every state is freshly
 * created as PENDING) and by the manual "go fetch" button later (existing
 * terminal states reset to PENDING to trigger a fresh incremental scan) —
 * the same call serves both, which is what makes first-time and future
 * sync "the same underlying engine" at this level too. A course already
 * mid-sync (DISCOVERING/DOWNLOADING) is left alone rather than interrupted.
 */
export async function queueCourseMaterialSync(
  prisma: PrismaClient,
  userId: string,
  provider: MaterialsProvider
): Promise<void> {
  const classes = await prisma.class.findMany({
    where: { userId, lmsProvider: provider, lmsCourseId: { not: null } },
    select: { id: true, syncState: { select: { status: true } } },
  });

  for (const cls of classes) {
    if (cls.syncState && IN_FLIGHT_STATUSES.has(cls.syncState.status)) continue;
    await prisma.materialSyncState.upsert({
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
 * course, then returns fresh progress for every class from this LMS — the
 * client polls this on an interval (see MaterialSyncPanel) and stops once
 * every course reports a terminal status. One course per call, not "keep
 * going until everything's done in one request," so a class with a huge
 * number of resources can't starve its siblings from ever being picked up
 * (each call's course choice is oldest-updated-first) and every call stays
 * fast regardless of how much total work remains.
 */
export async function advanceMaterialSync(
  prisma: PrismaClient,
  source: MaterialsSource,
  userId: string,
  options: MaterialSyncOptions
): Promise<CourseSyncProgress[]> {
  const where = { userId, lmsProvider: source.provider, lmsCourseId: { not: null } };
  const classes = await prisma.class.findMany({ where, include: { syncState: true } });

  const next = classes
    .filter((c) => c.syncState && !TERMINAL_STATUSES.has(c.syncState.status))
    .sort((a, b) => a.syncState!.updatedAt.getTime() - b.syncState!.updatedAt.getTime())[0];

  if (next?.lmsCourseId && next.syncState) {
    try {
      await processCourseChunk(prisma, source, { id: next.id, lmsCourseId: next.lmsCourseId }, next.syncState, options);
    } catch (err) {
      console.error(`Materials sync chunk (${source.provider}) failed for class ${next.id}:`, err);
      // This write can itself fail (confirmed live: a transient database
      // connection-pool timeout hit here too, right after tripping the
      // same error in processCourseChunk above) — without its own
      // try/catch, that second failure would propagate out of this
      // function uncaught, breaking the caller (the client's polling
      // loop) instead of just leaving this one course's state as-is for
      // the next tick to reconcile, which is the same self-healing
      // recovery every other transient failure here already gets.
      try {
        await prisma.materialSyncState.update({
          where: { id: next.syncState.id },
          data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : "Sync failed.", finishedAt: new Date() },
        });
      } catch (writeErr) {
        console.error(`Materials sync: also failed to record the failure for class ${next.id}:`, writeErr);
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
    refreshed = await prisma.class.findMany({ where, include: { syncState: true }, orderBy: { name: "asc" } });
  } catch (err) {
    console.error(`Materials sync: failed to refresh progress for user ${userId}, returning last-known state:`, err);
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
