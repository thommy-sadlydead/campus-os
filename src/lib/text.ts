// Small text-cleanup helpers. Currently just one job: Canvas's assignment
// `description` field comes back as raw HTML (Canvas is a rich-text editor
// under the hood), and we don't want to either (a) pull in an HTML
// sanitizer dependency just to render it safely, or (b) risk
// dangerouslySetInnerHTML on content we don't control. So we strip tags
// down to plain text for display. It loses rich formatting (bold, links,
// bullet lists), but it's safe and dependency-free, consistent with the
// rest of this codebase's minimal-dependency approach (see canvas.ts,
// google-oauth.ts).

// Exported so office-text.ts can decode the same entities in OOXML
// (pptx/docx) text runs without duplicating this table.
export const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function stripHtml(html: string): string {
  return html
    // Block-level tags become line breaks so paragraphs/list items don't
    // run together into one wall of text.
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

// Full web pages (unlike Canvas's controlled rich-text HTML) carry real
// structural noise — scripts, styles, nav bars, headers/footers — that
// stripHtml alone would leave as garbage text (it only removes tags, not
// the content of things like <script>). Used for class materials added by
// link (see addClassMaterialFromUrlAction): strips those blocks entirely
// first, then reuses stripHtml for the rest.
const NOISE_BLOCK_PATTERN = /<(script|style|noscript|nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi;

export function htmlToReadableText(html: string): string {
  // Real pages nest content much deeper than Canvas's flat rich-text HTML
  // (Wikipedia's sidebar/nav chrome alone is dozens of empty <li>/<div>
  // levels), which stripHtml turns into lines that are individually
  // non-empty (e.g. a lone space) when it collapses 3+ blank lines, but
  // become empty only after its later per-line trim — so runs of blank
  // lines survive. One more collapse pass after stripHtml cleans those up
  // without changing stripHtml's existing Canvas-description behavior.
  return stripHtml(html.replace(NOISE_BLOCK_PATTERN, " "))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const decoded = match[1].replace(/&[a-z#0-9]+;/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? m).trim();
  return decoded || null;
}
