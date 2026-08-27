import { describe, it, expect } from "vitest";
import { classifyCanvasUrl } from "../src/lib/canvas";

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
