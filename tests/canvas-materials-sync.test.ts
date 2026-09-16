import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverCourseResources } from "../src/lib/canvas-materials-sync";
import type { CanvasConfig } from "../src/lib/canvas";

const cfg: CanvasConfig = { baseUrl: "https://cedarville.instructure.com", token: "test-token" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: init?.headers });
}

interface Routes {
  files: () => Response;
  modules: () => Response;
  moduleItems: () => Response;
  pages: () => Response;
  pageBody: () => Response;
  assignments: () => Response;
  syllabus: () => Response;
}

function emptyRoutes(): Routes {
  return {
    files: () => jsonResponse([]),
    modules: () => jsonResponse([]),
    moduleItems: () => jsonResponse([]),
    pages: () => jsonResponse([]),
    pageBody: () => jsonResponse({ page_id: 1, url: "x", title: "x", updated_at: "2026-01-01T00:00:00Z", body: null }),
    assignments: () => jsonResponse([]),
    syllabus: () => jsonResponse({ syllabus_body: null }),
  };
}

// Dispatches a stubbed fetch call to the right canned response by URL shape
// — discoverCourseResources hits several distinct Canvas endpoints per
// course, so a real test needs to answer each one differently rather than
// one blanket mock.
function routeFetch(overrides: Partial<Routes>) {
  const routes = { ...emptyRoutes(), ...overrides };
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/items?")) return routes.moduleItems();
    if (url.includes("/modules?")) return routes.modules();
    if (url.includes("/files?")) return routes.files();
    if (url.includes("/pages?")) return routes.pages();
    if (url.includes("/pages/")) return routes.pageBody();
    if (url.includes("/assignments?")) return routes.assignments();
    if (url.includes("syllabus_body")) return routes.syllabus();
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
}

describe("discoverCourseResources", () => {
  it("returns an empty array for a course with no materials anywhere", async () => {
    vi.stubGlobal("fetch", routeFetch({}));
    expect(await discoverCourseResources(cfg, 101)).toEqual([]);
  });

  it("combines Files, Modules (Page + ExternalUrl items), Pages, Assignment-linked files, and the Syllabus", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        files: () =>
          jsonResponse([
            { id: 1, display_name: "Chapter1.pdf", "content-type": "application/pdf", size: 100, url: "http://x/1", updated_at: "2026-01-01T00:00:00Z" },
          ]),
        modules: () => jsonResponse([{ id: 5, name: "Week 1" }]),
        moduleItems: () =>
          jsonResponse([
            { id: 1, title: "Course overview", type: "Page", page_url: "overview" },
            { id: 2, title: "Publisher textbook", type: "ExternalUrl", external_url: "https://publisher.example.com/book" },
          ]),
        pages: () => jsonResponse([{ page_id: 1, url: "overview", title: "Course overview", updated_at: "2026-01-02T00:00:00Z" }]),
        assignments: () =>
          jsonResponse([
            { id: 9, name: "HW1", description: '<a href="/courses/101/files/77">rubric</a>', due_at: null, points_possible: 10, html_url: "https://x" },
          ]),
        syllabus: () => jsonResponse({ syllabus_body: "<p>" + "Course policies and grading breakdown. ".repeat(3) + "</p>" }),
      })
    );

    const discovered = await discoverCourseResources(cfg, 101);
    const byType = (t: string) => discovered.filter((r) => r.resourceType === t);

    expect(byType("file").map((r) => r.canvasResourceId).sort()).toEqual(["1", "77"]);
    expect(byType("page")).toHaveLength(1);
    expect(byType("external")).toHaveLength(1);
    expect(byType("syllabus")).toHaveLength(1);
  });

  it("falls back to Modules when the Files endpoint 403s (instructor hid the Files tab)", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        files: () => new Response("forbidden", { status: 403 }),
        modules: () => jsonResponse([{ id: 5, name: "Week 1" }]),
        moduleItems: () => jsonResponse([{ id: 1, title: "Hidden reading", type: "File", content_id: 42 }]),
      })
    );

    const discovered = await discoverCourseResources(cfg, 101);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({ canvasResourceId: "42", resourceType: "file" });
  });

  it("one broken discovery source doesn't prevent the others from contributing", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        files: () =>
          jsonResponse([
            { id: 1, display_name: "Chapter1.pdf", "content-type": "application/pdf", size: 100, url: "http://x/1", updated_at: "2026-01-01T00:00:00Z" },
          ]),
        // Simulates the Pages endpoint being broken for this course — a
        // 404 (not retried) keeps the test fast while still exercising
        // discoverCourseResources's per-source try/catch.
        pages: () => new Response("not found", { status: 404 }),
      })
    );

    const discovered = await discoverCourseResources(cfg, 101);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].canvasResourceId).toBe("1");
  });

  it("a file discovered via both Files and a Module item collapses to one entry with the richer metadata", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        files: () =>
          jsonResponse([
            { id: 42, display_name: "Chapter3.pdf", "content-type": "application/pdf", size: 500, url: "http://x/42", updated_at: "2026-01-01T00:00:00Z" },
          ]),
        modules: () => jsonResponse([{ id: 5, name: "Week 3" }]),
        moduleItems: () => jsonResponse([{ id: 1, title: "Chapter 3 reading", type: "File", content_id: 42 }]),
      })
    );

    const discovered = await discoverCourseResources(cfg, 101);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({ canvasResourceId: "42", title: "Chapter3.pdf", contentType: "application/pdf" });
  });

  it("scans a page body for an embedded Canvas file link", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        pages: () => jsonResponse([{ page_id: 1, url: "week-2", title: "Week 2", updated_at: "2026-01-01T00:00:00Z" }]),
        pageBody: () =>
          jsonResponse({
            page_id: 1,
            url: "week-2",
            title: "Week 2",
            updated_at: "2026-01-01T00:00:00Z",
            body: '<p>See <a href="/files/88">the handout</a>.</p>',
          }),
      })
    );

    const discovered = await discoverCourseResources(cfg, 101);
    const fileIds = discovered.filter((r) => r.resourceType === "file").map((r) => r.canvasResourceId);
    expect(fileIds).toContain("88");
  });

  it("skips a syllabus with no substantial content instead of recording an empty entry", async () => {
    vi.stubGlobal("fetch", routeFetch({ syllabus: () => jsonResponse({ syllabus_body: "<p></p>" }) }));
    const discovered = await discoverCourseResources(cfg, 101);
    expect(discovered.filter((r) => r.resourceType === "syllabus")).toHaveLength(0);
  });
});
