export type CopyOutcome = "rich" | "plain" | "legacy";

export class ClipboardUnavailableError extends Error {}
export class ClipboardPermissionError extends Error {}

/** Wraps editor HTML in an inline style so Times New Roman survives into Word/Docs. */
export function wrapAsTimesNewRomanHtml(innerHtml: string): string {
  return `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; color: #000000;">${innerHtml}</div>`;
}

/**
 * Copies both a plain-text and a Times New Roman-styled HTML representation
 * of the generated writing to the clipboard, preferring the rich
 * ClipboardItem API and falling back progressively for older browsers.
 */
export async function copyGeneratedText(
  plainText: string,
  html: string
): Promise<CopyOutcome> {
  const richHtml = wrapAsTimesNewRomanHtml(html);

  if (typeof window !== "undefined" && "ClipboardItem" in window && navigator.clipboard?.write) {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([richHtml], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return "rich";
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        throw new ClipboardPermissionError(
          "Clipboard permission was denied. Allow clipboard access, or select the text and press Ctrl/Cmd+C."
        );
      }
      // Some browsers support ClipboardItem but reject certain MIME types.
      // Fall through to the plain-text API below.
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(plainText);
      return "plain";
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        throw new ClipboardPermissionError(
          "Clipboard permission was denied. Allow clipboard access, or select the text and press Ctrl/Cmd+C."
        );
      }
      // Fall through to the legacy fallback below.
    }
  }

  if (legacyCopy(plainText)) {
    return "legacy";
  }

  throw new ClipboardUnavailableError(
    "Copying isn't supported in this browser. Select the text and press Ctrl/Cmd+C instead."
  );
}

/** Last-resort fallback for browsers without the async Clipboard API. */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  }
  document.body.removeChild(textarea);
  return succeeded;
}
