/**
 * Converts the model's raw text response into safe HTML for the editor.
 *
 * The model is instructed to avoid Markdown, but this is a defensive net:
 * if it still emits heading/list/emphasis syntax, we render it as real
 * formatting instead of leaving literal Markdown punctuation in the output.
 * All text content is HTML-escaped before any tag is introduced, so this
 * is safe to assign to innerHTML even though the source is model output.
 */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^([-*•]|\d+[.)])\s+(.*)$/;
const ORDERED_MARKER_RE = /^\d+[.)]/;

export function markdownToSafeHtml(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const html: string[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const nonEmpty = paragraphLines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length > 0) {
      html.push(`<p>${nonEmpty.map((l) => inline(l.trim())).join("<br>")}</p>`);
    }
    paragraphLines = [];
  }

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === "") {
      flushParagraph();
      i++;
      continue;
    }

    const headingMatch = trimmed.match(HEADING_RE);
    if (headingMatch) {
      flushParagraph();
      html.push(`<p><strong>${inline(headingMatch[2])}</strong></p>`);
      i++;
      continue;
    }

    const listMatch = trimmed.match(LIST_ITEM_RE);
    if (listMatch) {
      flushParagraph();
      const ordered = ORDERED_MARKER_RE.test(trimmed);
      const tag = ordered ? "ol" : "ul";
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = t.match(LIST_ITEM_RE);
        if (!m || ORDERED_MARKER_RE.test(t) !== ordered) break;
        items.push(`<li>${inline(m[2])}</li>`);
        i++;
      }
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    paragraphLines.push(lines[i]);
    i++;
  }
  flushParagraph();

  return html.join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes text, then applies inline emphasis markup on top of the escaped string. */
function inline(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, "<em>$1</em>")
    .replace(/(?<![_\w])_([^_]+)_(?![_\w])/g, "<em>$1</em>");
}

/** Best-effort plain text from the rendered HTML, used for the .txt clipboard entry. */
export function htmlToPlainText(root: HTMLElement): string {
  return root.innerText.replace(/\u00A0/g, " ").trim();
}
