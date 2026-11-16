// Tidies the name an LMS gives a course for showing to the student: Canvas
// course names often end in the section and term ("US History to 1877 (01)
// 2026FA"), which is clutter on every screen. Pure; tested in
// tests/lms-course-name.test.ts.
//
// Only things that are clearly a section or a term come off, and only at an
// end of the name: "(01)", "(Section 2)", "2026FA", "FA2026", "Fall 2026",
// "202610". "(Honors)", "(Online)" and course numbers like "(101)" stay.
// When nothing meaningful would be left, the name is returned as it came.

const SEASON = "(?:FA|SP|SU|WI|FALL|SPRING|SUMMER|WINTER)";
const YEAR = "(?:19|20)\\d{2}";
// "2026FA", "2026-FA", "FA2026", "Fall 2026", and a six-digit term code ("202610").
const TERM = `(?:${YEAR}\\s*[-_]?\\s*${SEASON}\\b|\\b${SEASON}\\s*[-_]?\\s*${YEAR}|${YEAR}(?:10|20|30|40|50|60|70|80)\\b)`;
// "01", "001", "7" (not "101": that's a course number), "A", "L1", "Section 02".
const SECTION_CORE = "(?:0{1,2}\\d{1,2}|\\d{1,2}|[A-Za-z]\\d{0,2}|sec(?:tion)?\\.?\\s*#?\\w{1,4})";
const SEPARATORS = "[\\s\\-–—:,|/]";

const ENDING = [
  // A bracketed term and/or section: "(01)", "[2026FA]", "(Fall 2026)", "(Section 02)".
  new RegExp(`${SEPARATORS}*[\\(\\[]\\s*(?:${TERM}|${SECTION_CORE})\\s*[\\)\\]]\\s*$`, "i"),
  // A bare term: "... 2026FA", "... - Fall 2026".
  new RegExp(`${SEPARATORS}+${TERM}\\s*$`, "i"),
  // A bare section word: "... - Section 02", "..., Sec. 3".
  new RegExp(`${SEPARATORS}+sec(?:tion)?\\.?\\s*#?\\w{1,4}\\s*$`, "i"),
];
const BEGINNING = [
  new RegExp(`^\\s*[\\(\\[]\\s*(?:${TERM})\\s*[\\)\\]]${SEPARATORS}*`, "i"),
  new RegExp(`^\\s*${TERM}${SEPARATORS}+`, "i"),
];

export function cleanCourseName(raw: string): string {
  const original = raw.replace(/\s+/g, " ").trim();
  let name = original;
  for (let pass = 0; pass < 8; pass++) {
    let next = name;
    for (const pattern of ENDING) next = next.replace(pattern, "");
    for (const pattern of BEGINNING) next = next.replace(pattern, "");
    next = next.trim();
    if (next === name) break;
    name = next;
  }
  name = name.replace(new RegExp(`${SEPARATORS}+$`), "").trim();
  // Nothing left that reads as a name (all numbers or a single character): keep what the LMS said.
  return /[A-Za-z]{2}/.test(name) ? name : original;
}
