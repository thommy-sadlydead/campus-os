import type { CSSProperties } from "react";

// Each class has a color, 1-8 (Class.color), from the --c-N palette in
// globals.css. These helpers put it on an element as --course, which the
// .course-tint class turns into a soft tinted tile in light and dark mode.

export function courseStyle(color: number): CSSProperties {
  return { "--course": `var(--c-${color})` } as CSSProperties;
}

const SMALL_WORDS = new Set(["a", "an", "and", "the", "of", "to", "in", "for", "on", "&"]);

/**
 * "Interm Fin Acct I (01) 2026FA" -> "IF"; "Microeconomics (03) 2026FA" ->
 * "MI". Canvas course names end in a section and term code, so words with
 * digits or brackets are skipped.
 */
export function courseInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((w) => /^[a-z][a-z'&.-]*$/i.test(w) && !SMALL_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
