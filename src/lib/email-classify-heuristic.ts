// The no-AI-key path for email intelligence: class matching + relevance/
// category classification, using only regex and word matching. Pure,
// dependency-free (no Prisma, no Next.js, no "server-only" marker) so it's
// unit-testable the same way priority-engine.ts and change-rules.ts are —
// see tests/email-classify-heuristic.test.ts.
//
// Deliberately does NOT extract structured facts (a new exam date, a
// changed room, etc.) — reliably pulling a fact out of free text needs
// real language understanding, and guessing would violate the app's core
// "never fabricate" rule. The AI path (src/lib/email-intelligence.ts) is
// what proposes actual PendingChange facts; this module only filters,
// categorizes, tags a likely class, and produces a plain-text summary.

export type EmailCategory =
  | "ASSIGNMENT"
  | "EXAM"
  | "SCHEDULE_CHANGE"
  | "ANNOUNCEMENT"
  | "SYLLABUS"
  | "OTHER_ACADEMIC"
  | "IRRELEVANT";

export interface ClassLite {
  id: string;
  code: string;
  name: string;
  professor: string | null;
}

export interface HeuristicEmailInput {
  subject: string;
  snippet: string;
  bodyText: string;
}

export interface HeuristicClassificationResult {
  relevant: boolean;
  classId: string | null;
  category: EmailCategory;
  summary: string;
  confidence: number; // 0-1 — heuristic guesses are never high-confidence
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function codeVariants(code: string): string[] {
  // "ECON-2330-03" -> ["econ233003" (full compact), "econ2330", "econ 2330", "econ-2330"]
  //
  // The course-number match runs against the *lowercased-but-not-yet-
  // compacted* string on purpose: compacting first ("econ233003") merges
  // the course number ("2330") with the section suffix ("03") into one
  // digit run, so a plain "ECON 2330" in an email would never match. This
  // way we grab just the first digit run (the part after the subject
  // prefix) as the course number, the way people actually write it.
  const lower = code.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  const match = lower.match(/^([a-z]+)[\s-]*(\d+)/);
  const variants = [compact];
  if (match) {
    const [, prefix, num] = match;
    variants.push(`${prefix}${num}`, `${prefix} ${num}`, `${prefix}-${num}`);
  }
  return variants;
}

/** Best-effort: scores each of the student's classes against free text and returns the clear winner, or null. */
export function matchClassId(text: string, classes: ClassLite[]): string | null {
  const haystack = normalize(text);
  const haystackCompact = text.toLowerCase().replace(/[^a-z0-9]/g, "");

  let best: { id: string; score: number } | null = null;
  for (const cls of classes) {
    let score = 0;
    for (const variant of codeVariants(cls.code)) {
      if (haystackCompact.includes(variant.replace(/[^a-z0-9]/g, ""))) score += 5;
      else if (haystack.includes(variant)) score += 3;
    }
    if (cls.professor) {
      const lastName = cls.professor.trim().split(/\s+/).pop();
      if (lastName && lastName.length > 2 && haystack.includes(lastName.toLowerCase())) score += 4;
    }
    const nameWords = normalize(cls.name).split(" ").filter((w) => w.length >= 4);
    for (const w of nameWords) {
      if (haystack.includes(w)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { id: cls.id, score };
  }
  return best ? best.id : null;
}

const CATEGORY_KEYWORDS: Array<[EmailCategory, RegExp]> = [
  ["EXAM", /\b(exam|midterm|final exam)\b/i],
  ["SCHEDULE_CHANGE", /\b(moved|rescheduled|reschedule|cancel(l)?ed|cancel(l)?ation|room change|relocated|new (room|time|location))\b/i],
  ["SYLLABUS", /\bsyllabus\b/i],
  ["ASSIGNMENT", /\b(assignment|homework|due date|deadline|submit|problem set|project)\b/i],
  ["ANNOUNCEMENT", /\b(announcement|reminder|update|office hours)\b/i],
];

const ACADEMIC_HINTS = /\b(class|course|professor|prof\.?|lecture|section|grade|quiz|instructor|canvas|blackboard)\b/i;

export function classifyHeuristic(email: HeuristicEmailInput, classes: ClassLite[]): HeuristicClassificationResult {
  const text = `${email.subject} ${email.snippet} ${email.bodyText}`;
  const classId = matchClassId(text, classes);

  let category: EmailCategory = "IRRELEVANT";
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(text)) {
      category = cat;
      break;
    }
  }
  if (category === "IRRELEVANT" && (classId || ACADEMIC_HINTS.test(text))) {
    category = "OTHER_ACADEMIC";
  }

  const relevant = category !== "IRRELEVANT";
  return {
    relevant,
    classId,
    category,
    summary: email.snippet || email.subject,
    confidence: relevant ? 0.4 : 0.6,
  };
}
