// Schoology course materials for the shared engine (src/lib/materials-sync.ts):
// a section's documents (files and links), pages, and files or links
// attached to its assignments, read into ClassMaterial rows the same way
// Canvas's are (classification, OCR fallback, statuses).
//
// Schoology gives every attachment an id and an upload timestamp, and a
// page only a creation time, so an edited page isn't picked up again
// (the same limit as a Canvas syllabus; see CLAUDE.md).

import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { classifyResource, dedupeDiscovered, type DiscoveredResource } from "@/lib/canvas-materials";
import { MAX_DOCUMENT_FILE_BYTES } from "@/lib/lecture-notes";
import {
  readDocumentText,
  upsertMaterial,
  type MaterialSyncOptions,
  type MaterialsSource,
  type UpsertInput,
} from "@/lib/materials-sync";
import { htmlToReadableText } from "@/lib/text";
import {
  downloadSchoologyFile,
  fetchSchoologyDocuments,
  fetchSchoologyGradeItems,
  fetchSchoologyPages,
  flag,
  num,
  type SchoologyAttachments,
  type SchoologyClient,
} from "@/lib/lms/schoology";

function timestampIso(value: unknown): string | null {
  const seconds = num(value);
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * Schoology, for the shared materials engine. Discovery remembers each
 * file's download path and each page's body, which processing (always in
 * the same call, right after discovery) then uses.
 */
export function schoologyMaterialsSource(client: SchoologyClient): MaterialsSource {
  const downloads = new Map<string, string>();
  const pageBodies = new Map<string, string>();

  function addAttachments(found: DiscoveredResource[], attachments: SchoologyAttachments | undefined, sourceUrl: string) {
    for (const file of attachments?.files?.file ?? []) {
      const resourceId = `file:${file.id}`;
      const filename = file.filename || file.title || `File ${file.id}`;
      if (file.download_path) downloads.set(resourceId, file.download_path);
      found.push({
        resourceId,
        resourceType: "file",
        title: file.title || filename,
        filename,
        contentType: file.filemime || "",
        size: num(file.filesize) ?? undefined,
        updatedAt: timestampIso(file.timestamp),
        sourceUrl,
      });
    }
    for (const link of attachments?.links?.link ?? []) {
      if (!link.url) continue;
      found.push({
        resourceId: `url:${crypto.createHash("sha256").update(link.url).digest("hex")}`,
        resourceType: "external",
        title: link.title || link.url,
        filename: link.title || link.url,
        updatedAt: null,
        sourceUrl: link.url,
      });
    }
  }

  async function discover(sectionId: string): Promise<DiscoveredResource[]> {
    const found: DiscoveredResource[] = [];
    const materialsUrl = `${client.domain}/course/${sectionId}/materials`;
    let anySource = false;
    let lastError: unknown = null;

    try {
      for (const doc of await fetchSchoologyDocuments(client, sectionId)) {
        if (doc.published !== undefined && !flag(doc.published)) continue;
        addAttachments(found, doc.attachments, materialsUrl);
      }
      anySource = true;
    } catch (err) {
      lastError = err;
      console.error(`Schoology documents couldn't be loaded for section ${sectionId}:`, err);
    }

    try {
      for (const page of await fetchSchoologyPages(client, sectionId)) {
        if (page.published !== undefined && !flag(page.published)) continue;
        const resourceId = `page:${page.id}`;
        if (page.body) pageBodies.set(resourceId, page.body);
        found.push({
          resourceId,
          resourceType: "page",
          title: page.title || "Page",
          filename: page.title || "Page",
          updatedAt: timestampIso(page.created),
          sourceUrl: materialsUrl,
        });
      }
      anySource = true;
    } catch (err) {
      lastError = err;
      console.error(`Schoology pages couldn't be loaded for section ${sectionId}:`, err);
    }

    try {
      for (const item of await fetchSchoologyGradeItems(client, sectionId)) {
        addAttachments(found, item.attachments, materialsUrl);
      }
      anySource = true;
    } catch (err) {
      lastError = err;
      console.error(`Schoology assignment attachments couldn't be loaded for section ${sectionId}:`, err);
    }

    if (!anySource) throw lastError instanceof Error ? lastError : new Error("Couldn't read this course's materials.");
    return dedupeDiscovered(found);
  }

  async function processOne(
    prisma: PrismaClient,
    _sectionId: string,
    classId: string,
    resource: DiscoveredResource,
    options: MaterialSyncOptions
  ): Promise<"synced" | "failed"> {
    const save = (input: UpsertInput) => upsertMaterial(prisma, "schoology", classId, resource, input);

    if (resource.resourceType === "external") {
      // Never fetched — like Canvas's external links, it may sit behind a
      // publisher's own sign-in. Recorded as the link.
      return save({
        title: resource.title,
        content: `External resource — not automatically imported. Open the link to view it: ${resource.sourceUrl}`,
        materialType: "BOOK",
        syncStatus: "EXTERNAL",
        lmsUpdatedAt: null,
      });
    }

    if (resource.resourceType === "page") {
      const text = htmlToReadableText(pageBodies.get(resource.resourceId) ?? "");
      const lmsUpdatedAt = resource.updatedAt ? new Date(resource.updatedAt) : null;
      if (text.trim().length < 20) {
        return save({
          title: resource.title,
          content: `Schoology page "${resource.title}" has no readable content.`,
          materialType: "NOTES",
          syncStatus: "SKIPPED_UNSUPPORTED",
          syncError: "No readable content.",
          lmsUpdatedAt,
        });
      }
      return save({ title: resource.title, content: text, materialType: "NOTES", syncStatus: "READY", lmsUpdatedAt });
    }

    const classification = classifyResource({
      contentType: resource.contentType,
      filename: resource.filename,
      resourceType: "file",
    });
    const lmsUpdatedAt = resource.updatedAt ? new Date(resource.updatedAt) : null;
    if (!classification.shouldImport) {
      return save({
        title: resource.title,
        content: `Schoology file "${resource.title}" was found but not imported automatically (${classification.skipReason}).`,
        materialType: "BOOK",
        syncStatus: classification.recordAsSkipped ? "SKIPPED_UNSUPPORTED" : "SKIPPED_NOISE",
        syncError: classification.skipReason,
        lmsUpdatedAt,
      });
    }
    if ((resource.size ?? 0) > MAX_DOCUMENT_FILE_BYTES) {
      return save({
        title: resource.title,
        content: `Schoology file "${resource.title}" is too large to import automatically (${Math.round((resource.size ?? 0) / 1024 / 1024)}MB).`,
        materialType: classification.materialType,
        syncStatus: "SKIPPED_TOO_LARGE",
        lmsUpdatedAt,
      });
    }

    try {
      const downloadPath = downloads.get(resource.resourceId);
      if (!downloadPath) throw new Error("Schoology didn't give a download link for this file.");
      const buffer = await downloadSchoologyFile(client, downloadPath);
      if (buffer.length > MAX_DOCUMENT_FILE_BYTES) throw new Error("That file is too large to read.");
      const content = await readDocumentText(buffer, resource.contentType || "", resource.filename, options);
      return save({
        title: resource.title,
        content,
        materialType: classification.materialType,
        syncStatus: "READY",
        lmsUpdatedAt,
      });
    } catch (err) {
      // A null lmsUpdatedAt means it's tried again next sync (see the same
      // note in canvas-materials-sync.ts's processFileResource).
      return save({
        title: resource.title,
        content: `Couldn't import "${resource.title}": ${err instanceof Error ? err.message : "unknown error"}.`,
        materialType: classification.materialType,
        syncStatus: "FAILED",
        syncError: err instanceof Error ? err.message : "Unknown error.",
        lmsUpdatedAt: null,
      });
    }
  }

  return { provider: "schoology", discover, processOne };
}
