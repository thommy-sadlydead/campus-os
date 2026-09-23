import { describe, it, expect, vi, afterEach } from "vitest";

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

describe("ocrPdf", () => {
  it("returns null when no ANTHROPIC_API_KEY is configured, without attempting a request", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const createSpy = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: class { static APIError = FakeAPIError; messages = { create: createSpy }; } }));
    vi.resetModules();
    const { ocrPdf } = await import("../src/lib/pdf-ocr");

    const result = await ocrPdf(Buffer.from("fake pdf bytes"));
    expect(result).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("returns null without a request when the buffer exceeds Claude's document size limit", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const createSpy = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: class { static APIError = FakeAPIError; messages = { create: createSpy }; } }));
    vi.resetModules();
    const { ocrPdf, MAX_OCR_PDF_BYTES } = await import("../src/lib/pdf-ocr");

    const oversized = Buffer.alloc(MAX_OCR_PDF_BYTES + 1);
    const result = await ocrPdf(oversized);
    expect(result).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("returns the transcribed text from a successful response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicSdk(async () => ({ content: [{ type: "text", text: "Transcribed page content." }] }));
    vi.resetModules();
    const { ocrPdf } = await import("../src/lib/pdf-ocr");

    const result = await ocrPdf(Buffer.from("fake pdf bytes"));
    expect(result).toBe("Transcribed page content.");
  });

  it("sends the PDF as a base64 document content block", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const createSpy = vi.fn(async (_req: { messages: Array<{ content: Array<{ type: string }> }> }) => ({
      content: [{ type: "text", text: "ok" }],
    }));
    vi.doMock("@anthropic-ai/sdk", () => ({ default: class { static APIError = FakeAPIError; messages = { create: createSpy }; } }));
    vi.resetModules();
    const { ocrPdf } = await import("../src/lib/pdf-ocr");

    const buffer = Buffer.from("fake pdf bytes");
    await ocrPdf(buffer);

    const call = createSpy.mock.calls[0][0];
    const documentBlock = call.messages[0].content.find((c: { type: string }) => c.type === "document");
    expect(documentBlock).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
    });
  });

  it("returns null when the response has no usable text", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicSdk(async () => ({ content: [{ type: "text", text: "" }] }));
    vi.resetModules();
    const { ocrPdf } = await import("../src/lib/pdf-ocr");

    const result = await ocrPdf(Buffer.from("fake pdf bytes"));
    expect(result).toBeNull();
  });

  it("returns null on a non-API-error failure", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicSdk(async () => {
      throw new Error("unexpected shape");
    });
    vi.resetModules();
    const { ocrPdf } = await import("../src/lib/pdf-ocr");

    const result = await ocrPdf(Buffer.from("fake pdf bytes"));
    expect(result).toBeNull();
  });

  it("throws with the real reason on a genuine Anthropic API error (billing, auth, rate limit)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicSdk(async () => {
      throw new FakeAPIError("credit balance is too low");
    });
    vi.resetModules();
    const { ocrPdf } = await import("../src/lib/pdf-ocr");

    await expect(ocrPdf(Buffer.from("fake pdf bytes"))).rejects.toThrow(/credit balance is too low/);
  });
});
