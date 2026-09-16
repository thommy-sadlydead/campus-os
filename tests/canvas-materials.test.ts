import { describe, it, expect } from "vitest";
import {
  classifyResource,
  deriveCanvasResourceId,
  dedupeDiscovered,
  planSync,
  extractCanvasFileIdsFromHtml,
  type DiscoveredResource,
  type ExistingMaterialRecord,
} from "../src/lib/canvas-materials";

describe("classifyResource", () => {
  it("imports a PDF as a BOOK", () => {
    expect(classifyResource({ contentType: "application/pdf", filename: "chapter1.pdf", resourceType: "file" })).toEqual({
      shouldImport: true,
      materialType: "BOOK",
    });
  });

  it("imports a modern PPTX as SLIDES", () => {
    const result = classifyResource({
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename: "week3.pptx",
      resourceType: "file",
    });
    expect(result).toEqual({ shouldImport: true, materialType: "SLIDES" });
  });

  it("imports a modern DOCX as a BOOK", () => {
    const result = classifyResource({
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "reading.docx",
      resourceType: "file",
    });
    expect(result).toEqual({ shouldImport: true, materialType: "BOOK" });
  });

  it("imports a TXT file as a BOOK", () => {
    expect(classifyResource({ contentType: "text/plain", filename: "reading1.txt", resourceType: "file" })).toEqual({
      shouldImport: true,
      materialType: "BOOK",
    });
  });

  it("a .txt file literally named with 'notes' is classified as NOTES, not BOOK — the resourceType/filename signal wins", () => {
    expect(classifyResource({ contentType: "text/plain", filename: "lecture-notes.txt", resourceType: "file" })).toEqual({
      shouldImport: true,
      materialType: "NOTES",
    });
  });

  it("imports an EPUB as a BOOK", () => {
    expect(classifyResource({ contentType: "application/epub+zip", filename: "textbook.epub", resourceType: "file" })).toEqual({
      shouldImport: true,
      materialType: "BOOK",
    });
  });

  it("classifies a filename containing 'syllabus' as SYLLABUS even without the resourceType hint", () => {
    expect(classifyResource({ contentType: "application/pdf", filename: "ECON-2330-syllabus.pdf", resourceType: "file" })).toEqual(
      { shouldImport: true, materialType: "SYLLABUS" }
    );
  });

  it("classifies a study guide / handout as NOTES", () => {
    expect(classifyResource({ contentType: "application/pdf", filename: "Week 4 Study Guide.pdf", resourceType: "file" })).toEqual(
      { shouldImport: true, materialType: "NOTES" }
    );
  });

  it("always imports an external resource regardless of filename", () => {
    expect(classifyResource({ filename: "textbook access", resourceType: "external" })).toEqual({
      shouldImport: true,
      materialType: "BOOK",
    });
  });

  it("a page resourceType is imported as NOTES even if its title looks like a book", () => {
    expect(classifyResource({ filename: "Chapter 1 Reading", resourceType: "page" })).toEqual({
      shouldImport: true,
      materialType: "NOTES",
    });
  });

  it("a syllabus resourceType is always imported as SYLLABUS", () => {
    expect(classifyResource({ filename: "anything", resourceType: "syllabus" })).toEqual({
      shouldImport: true,
      materialType: "SYLLABUS",
    });
  });

  const noiseCases: Array<[string, { contentType?: string; filename: string }]> = [
    ["image", { contentType: "image/png", filename: "banner.png" }],
    ["video", { contentType: "video/mp4", filename: "intro.mp4" }],
    ["audio", { contentType: "audio/mpeg", filename: "podcast.mp3" }],
    ["spreadsheet", { contentType: "application/vnd.ms-excel", filename: "grades.xlsx" }],
    ["archive", { contentType: "application/zip", filename: "bundle.zip" }],
  ];
  it.each(noiseCases)("treats a %s file as pure noise (not worth recording)", (_label, input) => {
    const result = classifyResource({ ...input, resourceType: "file" });
    expect(result).toEqual({ shouldImport: false, skipReason: expect.any(String), recordAsSkipped: false });
  });

  it("treats a legacy .ppt as an unsupported-but-worth-recording document", () => {
    const result = classifyResource({ contentType: "application/vnd.ms-powerpoint", filename: "old.ppt", resourceType: "file" });
    expect(result).toEqual({ shouldImport: false, skipReason: expect.any(String), recordAsSkipped: true });
  });

  it("treats a legacy .doc as an unsupported-but-worth-recording document", () => {
    const result = classifyResource({ contentType: "application/msword", filename: "old.doc", resourceType: "file" });
    expect(result).toEqual({ shouldImport: false, skipReason: expect.any(String), recordAsSkipped: true });
  });

  it("treats a genuinely unrecognized type as unsupported-but-worth-recording", () => {
    const result = classifyResource({ contentType: "application/x-weird", filename: "mystery.xyz", resourceType: "file" });
    expect(result).toEqual({ shouldImport: false, skipReason: expect.any(String), recordAsSkipped: true });
  });
});

describe("deriveCanvasResourceId", () => {
  it("uses the Canvas file id directly for a file resource", () => {
    expect(deriveCanvasResourceId({ resourceType: "file", canvasFileId: "12345" })).toBe("12345");
  });

  it("throws if a file resource is missing its file id", () => {
    expect(() => deriveCanvasResourceId({ resourceType: "file" })).toThrow();
  });

  it("prefixes a page slug", () => {
    expect(deriveCanvasResourceId({ resourceType: "page", pageSlug: "week-1-overview" })).toBe("page:week-1-overview");
  });

  it("is a fixed constant for the syllabus", () => {
    expect(deriveCanvasResourceId({ resourceType: "syllabus" })).toBe("syllabus");
  });

  it("hashes an external URL to a stable id", () => {
    const a = deriveCanvasResourceId({ resourceType: "external", externalUrl: "https://example.com/textbook" });
    const b = deriveCanvasResourceId({ resourceType: "external", externalUrl: "https://example.com/textbook" });
    expect(a).toBe(b);
    expect(a).toMatch(/^url:[0-9a-f]{64}$/);
  });
});

function resource(overrides: Partial<DiscoveredResource>): DiscoveredResource {
  return {
    canvasResourceId: "1",
    resourceType: "file",
    title: "File",
    filename: "file.pdf",
    updatedAt: "2026-01-01T00:00:00Z",
    sourceUrl: "https://cedarville.instructure.com/files/1",
    ...overrides,
  };
}

describe("dedupeDiscovered", () => {
  it("collapses the same file discovered via both Files and a Module item into one entry, keeping the richer one", () => {
    const viaModuleStub = resource({ canvasResourceId: "42", title: "File 42", contentType: undefined, updatedAt: null });
    const viaFilesEndpoint = resource({
      canvasResourceId: "42",
      title: "Chapter 3.pdf",
      contentType: "application/pdf",
      size: 1024,
      updatedAt: "2026-02-01T00:00:00Z",
    });

    const result = dedupeDiscovered([viaModuleStub, viaFilesEndpoint]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Chapter 3.pdf");
    expect(result[0].contentType).toBe("application/pdf");
  });

  it("keeps unrelated resources separate", () => {
    const a = resource({ canvasResourceId: "1" });
    const b = resource({ canvasResourceId: "2" });
    expect(dedupeDiscovered([a, b])).toHaveLength(2);
  });

  it("returns an empty array for a course with no resources", () => {
    expect(dedupeDiscovered([])).toEqual([]);
  });
});

describe("planSync", () => {
  it("puts a never-before-seen resource in toCreate", () => {
    const plan = planSync([], [resource({ canvasResourceId: "1" })]);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
  });

  it("skips a resource whose canvasUpdatedAt hasn't changed", () => {
    const existing: ExistingMaterialRecord[] = [{ canvasResourceId: "1", canvasUpdatedAt: new Date("2026-01-01T00:00:00Z") }];
    const plan = planSync(existing, [resource({ canvasResourceId: "1", updatedAt: "2026-01-01T00:00:00Z" })]);
    expect(plan.toSkip).toHaveLength(1);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it("re-imports a resource whose canvasUpdatedAt is newer", () => {
    const existing: ExistingMaterialRecord[] = [{ canvasResourceId: "1", canvasUpdatedAt: new Date("2026-01-01T00:00:00Z") }];
    const plan = planSync(existing, [resource({ canvasResourceId: "1", updatedAt: "2026-03-01T00:00:00Z" })]);
    expect(plan.toUpdate).toHaveLength(1);
  });

  it("treats a resource with no discoverable timestamp (e.g. an external link) as unchanged rather than re-importing every sync", () => {
    const existing: ExistingMaterialRecord[] = [{ canvasResourceId: "u1", canvasUpdatedAt: null }];
    const plan = planSync(existing, [resource({ canvasResourceId: "u1", resourceType: "external", updatedAt: null })]);
    expect(plan.toSkip).toHaveLength(1);
  });

  it("marks a previously-synced resource missing when it's no longer discovered", () => {
    const existing: ExistingMaterialRecord[] = [{ canvasResourceId: "1", canvasUpdatedAt: new Date() }];
    const plan = planSync(existing, []);
    expect(plan.toMarkMissing).toEqual(["1"]);
  });

  it("always reprocesses a resource that was MISSING and has reappeared, even if its timestamp looks unchanged", () => {
    const existing: ExistingMaterialRecord[] = [
      { canvasResourceId: "1", canvasUpdatedAt: new Date("2026-01-01T00:00:00Z"), syncStatus: "MISSING" },
    ];
    const plan = planSync(existing, [resource({ canvasResourceId: "1", updatedAt: "2026-01-01T00:00:00Z" })]);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toSkip).toHaveLength(0);
  });

  it("re-running with identical input produces zero creates or updates (no duplication)", () => {
    const discovered = [resource({ canvasResourceId: "1", updatedAt: "2026-01-01T00:00:00Z" })];
    const firstPlan = planSync([], discovered);
    expect(firstPlan.toCreate).toHaveLength(1);

    // Simulate the created row now existing, then re-plan with the same discovery.
    const existing: ExistingMaterialRecord[] = [{ canvasResourceId: "1", canvasUpdatedAt: new Date("2026-01-01T00:00:00Z") }];
    const secondPlan = planSync(existing, discovered);
    expect(secondPlan.toCreate).toHaveLength(0);
    expect(secondPlan.toUpdate).toHaveLength(0);
    expect(secondPlan.toSkip).toHaveLength(1);
  });

  it("handles a course with zero existing and zero discovered resources", () => {
    const plan = planSync([], []);
    expect(plan).toEqual({ toCreate: [], toUpdate: [], toSkip: [], toMarkMissing: [] });
  });
});

describe("extractCanvasFileIdsFromHtml", () => {
  const HOST = "cedarville.instructure.com";

  it("finds a course-scoped absolute link", () => {
    const html = `<a href="https://cedarville.instructure.com/courses/1/files/2">reading</a>`;
    expect(extractCanvasFileIdsFromHtml(html, HOST)).toEqual(["2"]);
  });

  it("finds a bare host-relative link", () => {
    const html = `<a href="/files/99">slides</a>`;
    expect(extractCanvasFileIdsFromHtml(html, HOST)).toEqual(["99"]);
  });

  it("finds a course-scoped host-relative link with a download suffix", () => {
    const html = `<a href="/courses/1/files/7/download?wrap=1">handout</a>`;
    expect(extractCanvasFileIdsFromHtml(html, HOST)).toEqual(["7"]);
  });

  it("excludes a link to a different Canvas host", () => {
    const html = `<a href="https://otherschool.instructure.com/courses/1/files/2">not ours</a>`;
    expect(extractCanvasFileIdsFromHtml(html, HOST)).toEqual([]);
  });

  it("dedupes multiple mentions of the same file id", () => {
    const html = `<a href="/files/5">link 1</a> ... <a href="/courses/1/files/5/download">link 2</a>`;
    expect(extractCanvasFileIdsFromHtml(html, HOST)).toEqual(["5"]);
  });

  it("returns an empty array when the HTML has no file links", () => {
    expect(extractCanvasFileIdsFromHtml("<p>No links here.</p>", HOST)).toEqual([]);
  });
});
