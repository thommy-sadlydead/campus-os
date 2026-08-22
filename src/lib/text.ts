// Small text-cleanup helpers. Currently just one job: Canvas's assignment
// `description` field comes back as raw HTML (Canvas is a rich-text editor
// under the hood), and we don't want to either (a) pull in an HTML
// sanitizer dependency just to render it safely, or (b) risk
// dangerouslySetInnerHTML on content we don't control. So we strip tags
// down to plain text for display. It loses rich formatting (bold, links,
// bullet lists), but it's safe and dependency-free, consistent with the
// rest of this codebase's minimal-dependency approach (see canvas.ts,
// google-oauth.ts).

const ENTITY_MAP: Record<string, string> = {
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
