// OCR fallback for scanned/image-only PDFs — used only by the Canvas
// materials sync (canvas-materials-sync.ts) when a PDF's normal text
// extraction (office-text.ts, via unpdf's text layer reader) comes back
// empty. Real course PDFs are commonly scanned textbook pages or homework
// solution sheets with no text layer at all.
//
// Sends the whole PDF directly to Claude as a native "document" content
// block, rather than rendering each page as an image locally first — an
// earlier version of this file did that (via unpdf's renderPageAsImage +
// the @napi-rs/canvas native dependency), but real scanned course PDFs
// confirmed live use JBIG2 image compression that PDF.js's decoder can't
// initialize, silently rendering blank pages. Claude's own PDF ingestion
// reads the exact same files correctly (also confirmed live), so this
// skips local rendering entirely — simpler, and it actually works.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, MODEL } from "./anthropic";

// Anthropic's PDF support caps a single document at 32MB — checked before
// sending rather than letting an oversized file round-trip to a doomed
// request. (Course PDFs are already capped much lower, at
// MAX_DOCUMENT_FILE_BYTES in canvas.ts, before ever reaching here — this
// is a second, independent bound specific to what Claude's document input
// itself accepts.)
export const MAX_OCR_PDF_BYTES = 32 * 1024 * 1024;

const OCR_SYSTEM = [
  "You transcribe the visible text from a PDF document exactly as printed, including pages that are scanned images with no separate text layer.",
  "Preserve reading order, paragraph breaks, and tables (as markdown tables).",
  "Do not add commentary, and do not describe images, diagrams, or figures beyond a short bracketed note like [diagram] or [figure] — never invent text that isn't actually in the document.",
  "Respond with ONLY the transcribed text — no preamble like \"Here is the transcription\", no summary at the end.",
].join(" ");

/**
 * The installed @anthropic-ai/sdk version predates typed support for the
 * "document" content block (PDF input), even though the API itself
 * accepts it — confirmed live. This mirrors ImageBlockParam's shape
 * closely enough to satisfy the SDK's request serialization; the `as`
 * below is a narrow, deliberate escape hatch around that typing gap, not
 * a general loosening.
 */
interface PdfDocumentBlockParam {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
}

/**
 * Returns null if OCR isn't available (no API key), the file exceeds
 * Claude's document size limit, or the response came back with nothing
 * usable — callers should treat that like any other "couldn't read this
 * file" outcome, not a hard error. Throws instead on a genuine Anthropic
 * API error (auth, billing, rate limit, outage) — a service-level problem
 * worth surfacing honestly rather than reporting as a low-quality scan.
 */
export async function ocrPdf(buffer: Buffer): Promise<string | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;
  if (buffer.length > MAX_OCR_PDF_BYTES) return null;

  const documentBlock: PdfDocumentBlockParam = {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
  };

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: OCR_SYSTEM,
      messages: [
        {
          role: "user",
          content: [documentBlock, { type: "text", text: "Transcribe this document." }] as Anthropic.MessageParam["content"],
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text.trim() : "";
    return text || null;
  } catch (err) {
    // A service-level error affects the whole request, not "one page" the
    // way per-page rendering used to — confirmed live: a depleted API
    // credit balance failed this exact call every time until resolved.
    // Surfacing the real reason here, instead of a generic "couldn't read
    // this file", is what makes that kind of problem discoverable instead
    // of looking like every scan is just unreadable.
    if (err instanceof Anthropic.APIError) {
      throw new Error(`OCR unavailable right now: ${err.message}`);
    }
    console.error("OCR: PDF transcription failed:", err);
    return null;
  }
}
