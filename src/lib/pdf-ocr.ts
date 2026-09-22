// OCR fallback for scanned/image-only PDFs — used only by the Canvas
// materials sync (canvas-materials-sync.ts) when a PDF's normal text
// extraction (office-text.ts, via unpdf's text layer reader) comes back
// empty. Real course PDFs are commonly scanned textbook pages or homework
// solution sheets with no text layer at all, which unpdf correctly can't
// read — this renders each page as an image instead and asks Claude to
// transcribe it, the same way a student would just read the page.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { getAnthropicClient, MODEL } from "./anthropic";

// Bounds one file's worst-case OCR time (and cost) — this runs inside a
// bounded processing chunk alongside up to two other concurrent resources
// (see DOWNLOAD_CONCURRENCY in canvas-materials-sync.ts), so an unbounded
// page count on a multi-hundred-page scanned textbook could blow well past
// the route's maxDuration. 15 pages comfortably covers a homework solution
// set or a single scanned chapter excerpt; a longer scan gets a partial
// transcription rather than none, with a note appended (see ocrPdfPages).
const MAX_OCR_PAGES = 15;
const OCR_IMAGE_SCALE = 2;

const OCR_SYSTEM = [
  "You transcribe the visible text from a scanned document page image, exactly as printed.",
  "Preserve reading order, paragraph breaks, and tables (as markdown tables).",
  "Do not add commentary, and do not describe images, diagrams, or figures beyond a short bracketed note like [diagram] or [figure] so the reader knows something was skipped — never invent text that isn't actually printed on the page.",
  "If the page is blank or has no legible text, respond with exactly: [blank page]",
  "Respond with ONLY the transcribed text — no preamble like \"Here is the transcription\".",
].join(" ");

/**
 * Renders up to MAX_OCR_PAGES pages of a PDF as images and asks Claude to
 * transcribe each one. Returns null if OCR isn't available (no API key) or
 * every page genuinely came back with nothing legible — callers should
 * treat that like any other "couldn't read this file" outcome, not a hard
 * error. Throws instead if a page fails with a real Anthropic API error
 * (auth, billing, rate limit, outage) — that's a service-level problem
 * worth surfacing honestly rather than reporting as a low-quality scan.
 */
export async function ocrPdfPages(buffer: Buffer): Promise<string | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    console.error("OCR: failed to open PDF for page rendering:", err);
    return null;
  }

  const totalPages = pdf.numPages;
  const pageCount = Math.min(totalPages, MAX_OCR_PAGES);
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    let dataUrl: string;
    try {
      dataUrl = await renderPageAsImage(pdf, pageNum, {
        scale: OCR_IMAGE_SCALE,
        toDataURL: true,
        canvasImport: () => import("@napi-rs/canvas"),
      });
    } catch (err) {
      console.error(`OCR: failed to render page ${pageNum}:`, err);
      continue;
    }

    const base64 = dataUrl.split(",")[1];
    if (!base64) continue;

    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: OCR_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
              { type: "text", text: "Transcribe this page." },
            ],
          },
        ],
      });
      const block = res.content.find((b) => b.type === "text");
      const text = block && block.type === "text" ? block.text.trim() : "";
      if (text && text !== "[blank page]") pageTexts.push(text);
    } catch (err) {
      // A service-level error (bad/missing key, exhausted billing, rate
      // limit, an Anthropic outage) affects every remaining page
      // identically — confirmed live: a depleted API credit balance kept
      // failing the exact same way on every page, on every retry, for as
      // long as it went unnoticed. Failing fast here, with the real reason
      // attached, stops that pointless repeat spend and — more
      // importantly — surfaces something actionable, instead of the whole
      // file quietly ending up with the same generic "couldn't find
      // readable text" a genuinely low-quality scan would also get.
      if (err instanceof Anthropic.APIError) {
        throw new Error(`OCR unavailable right now: ${err.message}`);
      }
      console.error(`OCR: Claude transcription failed for page ${pageNum}:`, err);
    }
  }

  if (pageTexts.length === 0) return null;

  const truncatedNote =
    totalPages > pageCount ? `\n\n[Only the first ${pageCount} of ${totalPages} pages were transcribed.]` : "";
  return pageTexts.join("\n\n") + truncatedNote;
}
