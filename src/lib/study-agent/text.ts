// Pure helpers for the study assistant's tools (src/lib/study-agent):
// turning a search into terms, picking the best matches, cutting snippets
// and reading long text a piece at a time. No database, so they're tested
// directly (tests/study-agent.test.ts).

const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have how i in is it its me my of on or our over study " +
    "that the their this to was what when where which who why will with you your about into than then " +
    "quiz test exam help tomorrow today week"
  ).split(" ")
);

export const MAX_TERMS = 6;

/**
 * Search terms from what the model asked for: "quoted phrases" stay
 * whole, other words are split out, and filler words ("the", "quiz",
 * "help") are dropped. Numbers stay, so "chapter 3" still finds chapter 3.
 */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  const add = (t: string) => {
    const term = t.trim().toLowerCase();
    if (term && !terms.includes(term)) terms.push(term);
  };
  const rest = query.replace(/"([^"]+)"/g, (_, phrase: string) => {
    add(phrase);
    return " ";
  });
  for (const word of rest.toLowerCase().split(/[^\p{L}\p{N}'-]+/u)) {
    const w = word.replace(/^['-]+|['-]+$/g, "");
    if (!w || STOPWORDS.has(w)) continue;
    if (w.length < 3 && !/^\d+$/.test(w)) continue;
    add(w);
  }
  return terms.slice(0, MAX_TERMS);
}

export interface SearchCandidate {
  kind: "lecture" | "note" | "material";
  id: string;
  title: string;
  subtype: string | null;
  classId: string;
  className: string;
  chars: number;
  /** Per term, in order: whether the title has it, and a stretch of the text around its first match (null if the text doesn't). */
  titleHits: boolean[];
  snippets: (string | null)[];
}

export interface SearchResult {
  kind: SearchCandidate["kind"];
  id: string;
  title: string;
  type: string | null;
  class_id: string;
  class_name: string;
  matched: string[];
  snippet: string;
  chars: number;
}

/** Best matches first: more distinct terms, then title matches, then lecture notes and the student's own notes over long files. */
export function rankSearchResults(terms: string[], candidates: SearchCandidate[], limit: number): SearchResult[] {
  const kindBonus = { lecture: 0.3, note: 0.2, material: 0 } as const;
  return candidates
    .map((c) => {
      const matched = terms.filter((_, i) => c.titleHits[i] || c.snippets[i] != null);
      const titleCount = c.titleHits.filter(Boolean).length;
      const score = matched.length * 2 + titleCount * 1.5 + kindBonus[c.kind];
      // Two terms close together give overlapping stretches; keep one.
      const stretches: string[] = [];
      for (const s of c.snippets) {
        const flat = s?.replace(/\s+/g, " ").trim();
        if (!flat || stretches.some((kept) => kept.includes(flat.slice(0, 60)) || flat.includes(kept.slice(0, 60)))) continue;
        stretches.push(flat);
        if (stretches.length === 2) break;
      }
      const snippet = stretches.map((s) => `…${s}…`).join(" ");
      return { c, matched, score, snippet };
    })
    .filter((r) => r.matched.length > 0)
    .sort((a, b) => b.score - a.score || a.c.chars - b.c.chars)
    .slice(0, limit)
    .map(({ c, matched, snippet }) => ({
      kind: c.kind,
      id: c.id,
      title: c.title,
      type: c.subtype,
      class_id: c.classId,
      class_name: c.className,
      matched,
      snippet: snippet || "(matched in the title)",
      chars: c.chars,
    }));
}

/** One piece of a long text, starting at `offset`, ending at a paragraph or line break when there's one near the end. */
export function readChunk(text: string, offset: number, size: number): { text: string; nextOffset: number | null } {
  const start = Math.max(0, Math.min(offset, text.length));
  let end = Math.min(text.length, start + size);
  if (end < text.length) {
    const window = text.slice(start, end);
    const lastBreak = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    if (lastBreak > size * 0.7) end = start + lastBreak + 1;
  }
  return { text: text.slice(start, end), nextOffset: end < text.length ? end : null };
}

/** A tool result that can't run away with the context: anything over `max` characters is cut, and says so. */
export function capText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[…cut at ${max} characters]`;
}
