import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { hasAiConsent } from "@/lib/ai-consent";
import { applyLmsCourses } from "@/lib/lms/apply";
import { emptyReport, parseReport, type SyncReport } from "@/lib/lms/report";
import { LMS_PROVIDER_INFO } from "@/lib/lms/providers";
import { classifyResource, planSync, type DiscoveredResource, type ExistingMaterialRecord } from "@/lib/canvas-materials";
import { readDocumentText, upsertMaterial, type UpsertInput } from "@/lib/materials-sync";
import { htmlToReadableText } from "@/lib/text";
import { MAX_DOCUMENT_FILE_BYTES } from "@/lib/lecture-notes";
import {
  EXTENSION_ITEM_PREFIXES,
  courseImportStatus,
  matchCalendarDuplicates,
  type CoursesPayload,
  type ExtensionProvider,
  type ExtensionResource,
  type FailurePayload,
  type FinishPayload,
  type MaterialsPayload,
  type UploadHeader,
} from "@/lib/lms/extension-protocol";

// Saving what the Campus OS Chrome extension read from Brightspace or
// Blackboard (see chrome-extension/README.md). Everything goes through the
// same code as Canvas and Schoology: applyLmsCourses for classes,
// assignments and exams; planSync, classifyResource, readDocumentText and
// upsertMaterial for course files; MaterialSyncState for per-course
// progress. The difference is who does the reading: the extension, in the
// student's own signed-in browser, so Campus OS never holds a university
// password, cookie or token.
//
// One sync, from the extension's side: courses → for each course, the list
// of its materials (the reply says which to send: new or changed ones
// only) → each file or page → finish. A course counts as done only when
// every file it was asked for has been saved (resourcesPending reaches 0).

const name = (provider: ExtensionProvider) => LMS_PROVIDER_INFO[provider].name;

/** Classes this import may write to: the student's own, synced from this LMS. */
async function classFor(userId: string, provider: ExtensionProvider, courseId: string) {
  return prisma.class.findUnique({
    where: { userId_lmsProvider_lmsCourseId: { userId, lmsProvider: provider, lmsCourseId: courseId } },
    include: { syncState: true },
  });
}

/**
 * The student's courses, assignments and exams. Makes (or switches) the
 * connection to the extension, then writes through applyLmsCourses. The
 * report is kept on the connection; it's marked synced only at finish.
 */
export async function importCourses(user: User, payload: CoursesPayload, now: Date = new Date()) {
  const { provider, origin } = payload;
  const previous = await prisma.lmsConnection.findUnique({ where: { userId_provider: { userId: user.id, provider } } });
  const fields = { baseUrl: origin, method: "extension", credentialsEnc: encryptSecret("{}"), settings: null };
  await prisma.lmsConnection.upsert({
    where: { userId_provider: { userId: user.id, provider } },
    create: { userId: user.id, provider, ...fields },
    update: fields,
  });

  const applied = await applyLmsCourses(prisma, user.id, provider, payload.courses.map(toCourseInput), now);
  // A student switching from the calendar link: fold its copies of these
  // deadlines into the ones just read, so nothing shows up twice.
  const folded = previous && previous.method !== "extension" ? await foldCalendarDuplicates(user.id, provider, payload) : 0;

  const report: SyncReport = {
    ...emptyReport(provider, now),
    classes: applied.classes,
    skipped: payload.skipped,
    reopened: applied.reopened,
    ...(applied.checkedOff > 0 ? { checkedOff: applied.checkedOff } : {}),
  };
  await prisma.lmsConnection.update({
    where: { userId_provider: { userId: user.id, provider } },
    data: { lastSyncReport: JSON.stringify(report) },
  });

  const classes = await prisma.class.findMany({
    where: { userId: user.id, lmsProvider: provider, lmsCourseId: { in: payload.courses.map((c) => c.id) } },
    select: { id: true, lmsCourseId: true, name: true },
  });
  return {
    classes: classes.map((c) => ({ courseId: c.lmsCourseId as string, classId: c.id, name: c.name })),
    foldedCalendarItems: folded,
  };
}

function toCourseInput(course: CoursesPayload["courses"][number]) {
  return {
    id: course.id,
    name: course.name,
    code: course.code,
    problem: course.problem,
    assignments:
      course.assignments?.map((a) => ({ ...a, dueAt: a.dueAt ? new Date(a.dueAt) : null })) ?? null,
    exams: course.exams.map((e) => ({ ...e, examAt: e.examAt ? new Date(e.examAt) : null })),
  };
}

async function foldCalendarDuplicates(userId: string, provider: ExtensionProvider, payload: CoursesPayload): Promise<number> {
  let folded = 0;
  for (const course of payload.courses) {
    if (!course.assignments) continue;
    const cls = await prisma.class.findUnique({
      where: { userId_lmsProvider_lmsCourseId: { userId, lmsProvider: provider, lmsCourseId: course.id } },
      include: { assignments: { select: { id: true, name: true, dueAt: true, lmsItemId: true, status: true } } },
    });
    if (!cls) continue;
    const fromExtension = cls.assignments.filter((a) => a.lmsItemId && EXTENSION_ITEM_PREFIXES.some((p) => a.lmsItemId!.startsWith(p)));
    const fromCalendar = cls.assignments.filter((a) => a.lmsItemId && !EXTENSION_ITEM_PREFIXES.some((p) => a.lmsItemId!.startsWith(p)));
    for (const { fromId, toId } of matchCalendarDuplicates(fromCalendar, fromExtension)) {
      const old = fromCalendar.find((a) => a.id === fromId)!;
      const replacement = fromExtension.find((a) => a.id === toId)!;
      await prisma.$transaction([
        // The student's own steps and check-off come along.
        prisma.task.updateMany({ where: { assignmentId: fromId }, data: { assignmentId: toId } }),
        ...(old.status !== "NOT_STARTED" && replacement.status === "NOT_STARTED"
          ? [prisma.assignment.update({ where: { id: toId }, data: { status: old.status } })]
          : []),
        prisma.assignment.delete({ where: { id: fromId } }),
      ]);
      folded++;
    }
  }
  return folded;
}

/**
 * A course's materials: which of them to send (new or changed since the
 * last import, and readable), recording the rest right away (links, files
 * that aren't documents, ones too big) without the extension downloading
 * anything for them.
 */
export async function planMaterials(user: User, payload: MaterialsPayload, now: Date = new Date()) {
  const { provider } = payload;
  const cls = await classFor(user.id, provider, payload.courseId);
  if (!cls) return { error: "That course hasn't been imported yet." as const };

  const existingRows = await prisma.classMaterial.findMany({
    where: { classId: cls.id, provider },
    select: { lmsResourceId: true, lmsUpdatedAt: true, syncStatus: true },
  });
  const existing: ExistingMaterialRecord[] = existingRows.flatMap((r) =>
    r.lmsResourceId === null ? [] : [{ resourceId: r.lmsResourceId, lmsUpdatedAt: r.lmsUpdatedAt, syncStatus: r.syncStatus }]
  );
  const discovered = dedupe(payload.resources).map(asDiscovered);
  const plan = planSync(existing, discovered);
  if (payload.complete && plan.toMarkMissing.length > 0) {
    await prisma.classMaterial.updateMany({
      where: { classId: cls.id, provider, lmsResourceId: { in: plan.toMarkMissing } },
      data: { syncStatus: "MISSING" },
    });
  }

  const toFetch: string[] = [];
  for (const resource of [...plan.toCreate, ...plan.toUpdate]) {
    const recorded = await recordWithoutDownload(provider, cls.id, resource);
    if (!recorded) toFetch.push(resource.resourceId);
  }

  await prisma.materialSyncState.upsert({
    where: { classId: cls.id },
    create: { classId: cls.id, status: "DOWNLOADING", startedAt: now },
    update: { status: "DOWNLOADING", startedAt: now, finishedAt: null },
  });
  await refreshCounts(cls.id, provider, { pending: toFetch.length, problem: payload.problem });
  return { toFetch, unchanged: plan.toSkip.length };
}

function dedupe(resources: ExtensionResource[]): ExtensionResource[] {
  return [...new Map(resources.map((r) => [r.resourceId, r])).values()];
}

function asDiscovered(r: ExtensionResource): DiscoveredResource {
  return {
    resourceId: r.resourceId,
    resourceType: r.resourceType,
    title: r.title,
    filename: r.filename,
    contentType: r.contentType,
    size: r.size,
    updatedAt: r.updatedAt,
    sourceUrl: r.sourceUrl,
  };
}

/** Saves what needs no download (a link, a file that isn't a document, one too big). True when it did. */
async function recordWithoutDownload(provider: ExtensionProvider, classId: string, resource: DiscoveredResource): Promise<boolean> {
  const save = (input: UpsertInput) => upsertMaterial(prisma, provider, classId, resource, input);
  const lmsUpdatedAt = resource.updatedAt ? new Date(resource.updatedAt) : null;
  if (resource.resourceType === "external") {
    // Never fetched: it may sit behind a publisher's own sign-in.
    await save({
      title: resource.title,
      content: `External resource — not automatically imported. Open the link to view it: ${resource.sourceUrl}`,
      materialType: "BOOK",
      syncStatus: "EXTERNAL",
      lmsUpdatedAt: null,
    });
    return true;
  }
  if (resource.resourceType === "page") return false;
  const classification = classifyResource({ contentType: resource.contentType, filename: resource.filename, resourceType: "file" });
  if (!classification.shouldImport) {
    await save({
      title: resource.title,
      content: `${name(provider)} file "${resource.title}" was found but not imported automatically (${classification.skipReason}).`,
      materialType: "BOOK",
      syncStatus: classification.recordAsSkipped ? "SKIPPED_UNSUPPORTED" : "SKIPPED_NOISE",
      syncError: classification.skipReason,
      lmsUpdatedAt,
    });
    return true;
  }
  if ((resource.size ?? 0) > MAX_DOCUMENT_FILE_BYTES) {
    await save({
      title: resource.title,
      content: `${name(provider)} file "${resource.title}" is too large to import automatically (${Math.round((resource.size ?? 0) / 1024 / 1024)}MB).`,
      materialType: classification.materialType,
      syncStatus: "SKIPPED_TOO_LARGE",
      lmsUpdatedAt,
    });
    return true;
  }
  return false;
}

/** Counts from what's actually saved (like processCourseChunk), and the course's status from them. */
async function refreshCounts(classId: string, provider: ExtensionProvider, change: { pending?: number; decrement?: boolean; problem?: string | null }) {
  const rows = await prisma.classMaterial.findMany({ where: { classId, provider }, select: { syncStatus: true } });
  const live = rows.filter((r) => r.syncStatus !== "SKIPPED_NOISE" && r.syncStatus !== "MISSING");
  const failed = live.filter((r) => r.syncStatus === "FAILED").length;
  const state = await prisma.materialSyncState.update({
    where: { classId },
    data: {
      resourcesFound: live.length,
      resourcesDone: live.length - failed,
      resourcesFailed: failed,
      ...(change.pending !== undefined ? { resourcesPending: change.pending } : {}),
      ...(change.decrement ? { resourcesPending: { decrement: 1 } } : {}),
      ...(change.problem !== undefined ? { errorMessage: change.problem } : {}),
    },
  });
  if ((state.resourcesPending ?? 0) <= 0 && state.status === "DOWNLOADING") {
    const status = courseImportStatus({ found: state.resourcesFound, done: state.resourcesDone, failed: state.resourcesFailed });
    await prisma.materialSyncState.update({
      where: { classId },
      data: { status: status === "DOWNLOADING" ? "READY" : status, resourcesPending: 0, finishedAt: new Date() },
    });
  }
}

/**
 * Whether this resource still counts as to-do in the current run: it has
 * no row yet, or its row is older than the run. Retrying a file then
 * doesn't count it twice.
 */
async function firstTimeThisRun(classId: string, provider: ExtensionProvider, resourceId: string, startedAt: Date | null) {
  const row = await prisma.classMaterial.findUnique({
    where: { classId_provider_lmsResourceId: { classId, provider, lmsResourceId: resourceId } },
    select: { lastSyncedAt: true, syncStatus: true },
  });
  return !row || !startedAt || !row.lastSyncedAt || row.lastSyncedAt < startedAt || row.syncStatus === "MISSING";
}

export type UploadResult = { status: "part-saved" } | { status: "synced" | "failed"; message?: string } | { error: string; code: 400 | 404 };

/**
 * One part of a file or page. Parts are kept until the last arrives; the
 * whole file is then read (PDF, PowerPoint, Word, EPUB, text; scanned PDFs
 * by AI when the student allowed it) and saved as the class's material.
 */
export async function ingestUpload(user: User, header: UploadHeader, body: Buffer): Promise<UploadResult> {
  const cls = await classFor(user.id, header.provider, header.courseId);
  if (!cls?.syncState) return { error: "That course hasn't been imported yet.", code: 404 };

  let buffer = body;
  if (header.parts > 1) {
    await prisma.extensionUploadPart.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 60 * 60_000) } } });
    await prisma.extensionUploadPart.upsert({
      where: { uploadId_part: { uploadId: header.uploadId, part: header.part } },
      create: { userId: user.id, uploadId: header.uploadId, part: header.part, data: body },
      update: { data: body },
    });
    const parts = await prisma.extensionUploadPart.findMany({
      where: { uploadId: header.uploadId, userId: user.id },
      orderBy: { part: "asc" },
      select: { part: true, data: true },
    });
    if (parts.length < header.parts) return { status: "part-saved" };
    buffer = Buffer.concat(parts.map((p) => Buffer.from(p.data)));
    await prisma.extensionUploadPart.deleteMany({ where: { uploadId: header.uploadId } });
  }
  if (buffer.length !== header.totalBytes) {
    return finishResource(user, header.provider, cls.id, cls.syncState.startedAt, asDiscovered(header.resource), {
      title: header.resource.title,
      content: `Couldn't import "${header.resource.title}": it didn't arrive in one piece.`,
      materialType: "BOOK",
      syncStatus: "FAILED",
      syncError: "Incomplete upload.",
      lmsUpdatedAt: null,
    });
  }

  const resource = asDiscovered(header.resource);
  const lmsUpdatedAt = resource.updatedAt ? new Date(resource.updatedAt) : null;
  if (resource.resourceType === "page") {
    const text = htmlToReadableText(buffer.toString("utf8"));
    return finishResource(
      user,
      header.provider,
      cls.id,
      cls.syncState.startedAt,
      resource,
      text.trim().length < 20
        ? {
            title: resource.title,
            content: `${name(header.provider)} page "${resource.title}" has no readable content.`,
            materialType: "NOTES",
            syncStatus: "SKIPPED_UNSUPPORTED",
            syncError: "No readable content.",
            lmsUpdatedAt,
          }
        : { title: resource.title, content: text, materialType: "NOTES", syncStatus: "READY", lmsUpdatedAt }
    );
  }

  const classification = classifyResource({ contentType: resource.contentType, filename: resource.filename, resourceType: "file" });
  if (!classification.shouldImport) {
    // planMaterials records these without asking for them, so this only
    // happens when the LMS reported a different type at download time.
    return finishResource(user, header.provider, cls.id, cls.syncState.startedAt, resource, {
      title: resource.title,
      content: `${name(header.provider)} file "${resource.title}" was found but not imported automatically (${classification.skipReason}).`,
      materialType: "BOOK",
      syncStatus: classification.recordAsSkipped ? "SKIPPED_UNSUPPORTED" : "SKIPPED_NOISE",
      syncError: classification.skipReason,
      lmsUpdatedAt,
    });
  }
  try {
    const content = await readDocumentText(buffer, resource.contentType || "", resource.filename, { readScansWithAi: hasAiConsent(user) });
    return finishResource(user, header.provider, cls.id, cls.syncState.startedAt, resource, {
      title: resource.title,
      content,
      materialType: classification.materialType,
      syncStatus: "READY",
      lmsUpdatedAt,
    });
  } catch (err) {
    // A null lmsUpdatedAt means it's tried again next sync, like Canvas's.
    return finishResource(user, header.provider, cls.id, cls.syncState.startedAt, resource, {
      title: resource.title,
      content: `Couldn't import "${resource.title}": ${err instanceof Error ? err.message : "unknown error"}.`,
      materialType: classification.materialType,
      syncStatus: "FAILED",
      syncError: err instanceof Error ? err.message : "Unknown error.",
      lmsUpdatedAt: null,
    });
  }
}

async function finishResource(
  user: User,
  provider: ExtensionProvider,
  classId: string,
  startedAt: Date | null,
  resource: DiscoveredResource,
  input: UpsertInput
): Promise<UploadResult> {
  const first = await firstTimeThisRun(classId, provider, resource.resourceId, startedAt);
  const result = await upsertMaterial(prisma, provider, classId, resource, input);
  await refreshCounts(classId, provider, { decrement: first });
  return { status: result, ...(result === "failed" ? { message: input.syncError ?? undefined } : {}) };
}

const FAILURE_TEXT: Record<FailurePayload["reason"], string> = {
  "too-large": "is too large to import automatically",
  forbidden: "can't be downloaded with your account",
  "not-found": "is listed but its file is missing",
  "other-host": "is stored on another site the extension can't read",
  "download-failed": "couldn't be downloaded",
};

/** A file the extension couldn't get: saved as such, so the student sees why, and tried again next sync. */
export async function recordFailure(user: User, payload: FailurePayload): Promise<UploadResult> {
  const cls = await classFor(user.id, payload.provider, payload.courseId);
  if (!cls?.syncState) return { error: "That course hasn't been imported yet.", code: 404 };
  const resource = asDiscovered(payload.resource);
  const tooLarge = payload.reason === "too-large";
  return finishResource(user, payload.provider, cls.id, cls.syncState.startedAt, resource, {
    title: resource.title,
    content: `${name(payload.provider)} file "${resource.title}" ${FAILURE_TEXT[payload.reason]}.`,
    materialType: "BOOK",
    syncStatus: tooLarge ? "SKIPPED_TOO_LARGE" : "FAILED",
    syncError: payload.message || FAILURE_TEXT[payload.reason],
    lmsUpdatedAt: tooLarge && resource.updatedAt ? new Date(resource.updatedAt) : null,
  });
}

/**
 * The end of a sync. A finished one is marked synced; one that stopped
 * early (signed out, an error) says so, and any course still waiting on
 * files is left PARTIAL with how far it got, never READY.
 */
export async function finishSync(user: User, payload: FinishPayload, now: Date = new Date()) {
  const connection = await prisma.lmsConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: payload.provider } } });
  if (!connection || connection.method !== "extension") return { error: `${name(payload.provider)} isn't connected through the extension.` };

  const waiting = await prisma.materialSyncState.findMany({
    where: { class: { userId: user.id, lmsProvider: payload.provider }, status: "DOWNLOADING" },
  });
  for (const state of waiting) {
    const missing = state.resourcesPending ?? 0;
    await prisma.materialSyncState.update({
      where: { id: state.id },
      data: {
        status: missing > 0 ? "PARTIAL" : courseImportStatus({ found: state.resourcesFound, done: state.resourcesDone, failed: state.resourcesFailed }) === "PARTIAL" ? "PARTIAL" : "READY",
        finishedAt: now,
        ...(missing > 0 ? { errorMessage: `Stopped with ${missing} file${missing === 1 ? "" : "s"} still to import. Sync again to finish.` } : {}),
      },
    });
  }

  const report = parseReport(connection.lastSyncReport) ?? emptyReport(payload.provider, now);
  const stoppedMessage =
    payload.stopped === "signed-out"
      ? `You were signed out of ${name(payload.provider)} partway through. Sign in there and sync again to finish.`
      : payload.stopped === "error"
        ? payload.message || "The sync stopped partway through. Sync again to finish it."
        : null;
  await prisma.lmsConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncReport: JSON.stringify({ ...report, finishedAt: now.toISOString(), ...(stoppedMessage ? { error: stoppedMessage } : {}) }),
      // Only a sync that got to the end counts as the last sync.
      ...(payload.stopped ? {} : { lastSyncedAt: now }),
    },
  });
  return { ok: true as const, summary: await importSummary(user.id, payload.provider) };
}

/** What's actually in Campus OS from this LMS, for the extension to show when it's done. */
export async function importSummary(userId: string, provider: ExtensionProvider) {
  const classes = await prisma.class.findMany({
    where: { userId, lmsProvider: provider, archived: false },
    select: {
      id: true,
      name: true,
      lmsCourseId: true,
      _count: { select: { assignments: true, exams: true, materials: { where: { syncStatus: "READY" } } } },
      syncState: { select: { status: true, resourcesFound: true, resourcesDone: true, resourcesFailed: true, resourcesPending: true, errorMessage: true } },
    },
    orderBy: { name: "asc" },
  });
  return classes.map((c) => ({
    courseId: c.lmsCourseId,
    name: c.name,
    assignments: c._count.assignments,
    exams: c._count.exams,
    materials: c._count.materials,
    status: c.syncState?.status ?? null,
    failed: c.syncState?.resourcesFailed ?? 0,
    pending: c.syncState?.resourcesPending ?? 0,
    problem: c.syncState?.errorMessage ?? null,
  }));
}
