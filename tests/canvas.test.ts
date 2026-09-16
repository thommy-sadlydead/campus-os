import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyCanvasUrl, fetchActiveCourses, fetchCourseFiles, CanvasApiError, type CanvasConfig } from "../src/lib/canvas";

const CANVAS_BASE = "https://cedarville.instructure.com";

describe("classifyCanvasUrl", () => {
  it("recognizes a course-scoped file link", () => {
    const result = classifyCanvasUrl(new URL("https://cedarville.instructure.com/courses/29086/files/123456"), CANVAS_BASE);
    expect(result).toEqual({ kind: "file", fileId: "123456" });
  });

  it("recognizes a bare file link", () => {
    const result = classifyCanvasUrl(new URL("https://cedarville.instructure.com/files/123456"), CANVAS_BASE);
    expect(result).toEqual({ kind: "file", fileId: "123456" });
  });

  it("recognizes a file link with a trailing /download and query string", () => {
    const result = classifyCanvasUrl(
      new URL("https://cedarville.instructure.com/courses/29086/files/123456/download?wrap=1"),
      CANVAS_BASE
    );
    expect(result).toEqual({ kind: "file", fileId: "123456" });
  });

  it("treats the course files index (no specific file id) as a canvas-page", () => {
    const result = classifyCanvasUrl(new URL("https://cedarville.instructure.com/courses/29086/files"), CANVAS_BASE);
    expect(result).toEqual({ kind: "canvas-page" });
  });

  it("treats an unrelated Canvas page (e.g. a module) as a canvas-page", () => {
    const result = classifyCanvasUrl(new URL("https://cedarville.instructure.com/courses/29086/modules"), CANVAS_BASE);
    expect(result).toEqual({ kind: "canvas-page" });
  });

  it("treats a different host entirely as external", () => {
    const result = classifyCanvasUrl(new URL("https://en.wikipedia.org/wiki/Photosynthesis"), CANVAS_BASE);
    expect(result).toEqual({ kind: "external" });
  });

  it("treats everything as external when Canvas isn't configured", () => {
    const result = classifyCanvasUrl(new URL("https://cedarville.instructure.com/courses/29086/files/123456"), undefined);
    expect(result).toEqual({ kind: "external" });
  });
});

// ---------------------------------------------------------------------------
// Network layer — pagination and retry/backoff, via vi.stubGlobal("fetch").
// Exercised through the real exported fetch* functions rather than the
// internal canvasGetAllPages/canvasFetchWithRetry helpers directly, since
// those aren't exported (every real caller only ever reaches them this way).
// ---------------------------------------------------------------------------

const cfg: CanvasConfig = { baseUrl: CANVAS_BASE, token: "test-token" };

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: init?.headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Canvas API pagination", () => {
  it("follows Link-header pagination across multiple pages rather than assuming one page is everything", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) {
        return jsonResponse([{ id: 1, display_name: "a.pdf", size: 10, url: "http://x/1", updated_at: "2026-01-01T00:00:00Z" }], {
          headers: { link: `<${CANVAS_BASE}/api/v1/courses/1/files?page=2>; rel="next"` },
        });
      }
      return jsonResponse([{ id: 2, display_name: "b.pdf", size: 20, url: "http://x/2", updated_at: "2026-01-01T00:00:00Z" }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const files = await fetchCourseFiles(cfg, 1);
    expect(files.map((f) => f.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after one page when there's no Link 'next' header", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([{ id: 1, display_name: "a.pdf", size: 10, url: "http://x/1", updated_at: "2026-01-01T00:00:00Z" }])
    );
    vi.stubGlobal("fetch", fetchMock);

    const files = await fetchCourseFiles(cfg, 1);
    expect(files).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Canvas API retry/backoff", () => {
  it("retries a 429, honoring Retry-After, then succeeds", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      return jsonResponse([{ id: 1, name: "ECON 101", course_code: "ECON-101" }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const courses = await fetchActiveCourses(cfg);
    expect(courses).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries on repeated 429s", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchActiveCourses(cfg)).rejects.toThrow(CanvasApiError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries a network error, then succeeds", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error("network blip");
      return jsonResponse([{ id: 1, name: "ECON 101", course_code: "ECON-101" }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const courses = await fetchActiveCourses(cfg);
    expect(courses).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("does not retry a 403 — surfaces it immediately, in one call", async () => {
    const fetchMock = vi.fn(async () => new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchActiveCourses(cfg)).rejects.toThrow(CanvasApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 404 — surfaces it immediately, in one call", async () => {
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchActiveCourses(cfg)).rejects.toThrow(CanvasApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
