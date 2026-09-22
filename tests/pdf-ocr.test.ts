import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// unpdf's renderPageAsImage needs @napi-rs/canvas + a real PDF.js render
// pipeline — mocked here so this test exercises pdf-ocr.ts's own
// page-loop/prompt/fallback logic, not unpdf's rendering internals (which
// are unpdf's responsibility, not this app's).
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({ numPages: 2 })),
  renderPageAsImage: vi.fn(async () => "data:image/png;base64,ZmFrZS1wbmc="),
}));

const originalKey = process.env.ANTHROPIC_API_KEY;

// Matches the real SDK's shape closely enough for `instanceof
// Anthropic.APIError` in pdf-ocr.ts to behave correctly against mocked
// errors — see error.d.ts: Anthropic.APIError is a static property on the
// default-exported class, and BadRequestError etc. all extend it.
class FakeAPIError extends Error {}

function mockAnthropicSdk(createImpl: () => Promise<{ content: Array<{ type: string; text: string }> }>) {
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class {
      static APIError = FakeAPIError;
      messages = { create: vi.fn(createImpl) };
    },
  }));
}

afterEach(() => {
  vi.doUnmock("@anthropic-ai/sdk");
  vi.resetModules();
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

describe("ocrPdfPages", () => {
  it("returns null when no ANTHROPIC_API_KEY is configured, without attempting to render anything", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    const { ocrPdfPages } = await import("../src/lib/pdf-ocr");
    const result = await ocrPdfPages(Buffer.from("fake pdf bytes"));
    expect(result).toBeNull();
  });

  it("transcribes each rendered page and joins them in order", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const pageTexts = ["Page one text.", "Page two text."];
    let call = 0;
    mockAnthropicSdk(async () => ({ content: [{ type: "text", text: pageTexts[call++] }] }));
    vi.resetModules();
    const { ocrPdfPages } = await import("../src/lib/pdf-ocr");

    const result = await ocrPdfPages(Buffer.from("fake pdf bytes"));
    expect(result).toBe("Page one text.\n\nPage two text.");
  });

  it("skips a page Claude reports as blank", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const pageTexts = ["[blank page]", "Real content here."];
    let call = 0;
    mockAnthropicSdk(async () => ({ content: [{ type: "text", text: pageTexts[call++] }] }));
    vi.resetModules();
    const { ocrPdfPages } = await import("../src/lib/pdf-ocr");

    const result = await ocrPdfPages(Buffer.from("fake pdf bytes"));
    expect(result).toBe("Real content here.");
  });

  it("returns null when every page hits a non-API-error failure (e.g. an unexpected response shape)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicSdk(async () => {
      throw new Error("unexpected shape");
    });
    vi.resetModules();
    const { ocrPdfPages } = await import("../src/lib/pdf-ocr");

    const result = await ocrPdfPages(Buffer.from("fake pdf bytes"));
    expect(result).toBeNull();
  });

  it("one page's non-API-error failure doesn't stop the others from being included", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    let call = 0;
    mockAnthropicSdk(async () => {
      call++;
      if (call === 1) throw new Error("transient failure");
      return { content: [{ type: "text", text: "Second page succeeded." }] };
    });
    vi.resetModules();
    const { ocrPdfPages } = await import("../src/lib/pdf-ocr");

    const result = await ocrPdfPages(Buffer.from("fake pdf bytes"));
    expect(result).toBe("Second page succeeded.");
  });

  it("fails fast with the real reason on a genuine Anthropic API error (billing, auth, rate limit) instead of silently retrying every remaining page", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const createSpy = vi.fn(async () => {
      throw new FakeAPIError("credit balance is too low");
    });
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        static APIError = FakeAPIError;
        messages = { create: createSpy };
      },
    }));
    vi.resetModules();
    const { ocrPdfPages } = await import("../src/lib/pdf-ocr");

    await expect(ocrPdfPages(Buffer.from("fake pdf bytes"))).rejects.toThrow(/credit balance is too low/);
    // getDocumentProxy reports numPages: 2 (see the unpdf mock above) — a
    // real fail-fast should stop after the first page's API error instead
    // of also attempting the second.
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});
