// Copying from a button, in browsers and in the iPhone app's web view. The
// Clipboard API is tried first; some web views refuse it, and copying a
// selection still works there.

function copySelectionOf(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  const ok = document.execCommand("copy");
  selection.removeAllRanges();
  return ok;
}

/**
 * Copies `text`, or `element` with its formatting (headings and lists
 * survive a paste into Notes or Docs) plus plain text for apps that only
 * take text. Returns whether it worked.
 */
export async function copyToClipboard(input: { text: string; element?: HTMLElement | null }): Promise<boolean> {
  try {
    if (input.element && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([input.element.innerHTML], { type: "text/html" }),
          "text/plain": new Blob([input.text], { type: "text/plain" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(input.text);
    }
    return true;
  } catch {
    if (input.element) return copySelectionOf(input.element);
    // Plain text: copy it from an off-screen textarea, keeping its tabs and line breaks.
    const area = document.createElement("textarea");
    area.value = input.text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
