// Reading a JSON value out of a model's reply. Asked for JSON only, models
// still sometimes wrap it in a code fence or add a sentence before or after
// it ("[]\n\nNone of these match…"), which JSON.parse rejects. Pure, tested
// in tests/json-text.test.ts.

/** The end (exclusive) of the JSON object or array starting at `start`, or -1 if it never closes. */
function closingIndex(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The JSON value in `text`: all of it when it parses, otherwise the first
 * complete object or array in it. Throws when there isn't one.
 */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] !== "{" && cleaned[i] !== "[") continue;
      const end = closingIndex(cleaned, i);
      if (end < 0) continue;
      try {
        return JSON.parse(cleaned.slice(i, end));
      } catch {
        // Not JSON after all (say, "[see below]"); keep looking.
      }
    }
    throw err;
  }
}
