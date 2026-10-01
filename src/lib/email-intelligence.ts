import "server-only";
import { askClaudeForJson } from "@/lib/anthropic";
import { ENTITY_FIELDS, type EntityType } from "@/lib/change-rules";
import {
  matchClassId,
  classifyHeuristic,
  looksLikeNewsletter,
  SPECIFIC_CATEGORIES,
  STRONG_CLASS_MATCH,
  type ClassLite,
  type EmailCategory,
} from "@/lib/email-classify-heuristic";
import type { GmailMessageSummary } from "@/lib/gmail";

export type { ClassLite, EmailCategory };
export { matchClassId };

export interface ExtractedFact {
  entityType: EntityType;
  entityMatchHint: string | null; // name/title text to fuzzy-match against an existing record
  field: string;
  newValue: string;
  isNewRecord: boolean;
  newRecordName?: string;
}

export interface ClassificationResult {
  relevant: boolean;
  classId: string | null;
  category: EmailCategory;
  summary: string;
  confidence: number; // 0-1
  facts: ExtractedFact[];
  usedAi: boolean;
}

// The heuristic (no-AI-key) relevance/category/class-matching logic lives
// in src/lib/email-classify-heuristic.ts — pure and unit-tested on its
// own (see tests/email-classify-heuristic.test.ts). It never proposes
// structured facts; that requires real language understanding and only
// happens on the AI path below, per the app's "never fabricate" rule.

// ---------------------------------------------------------------------------
// AI path: real extraction, still constrained to an explicit allowlist of
// fields (enforced again in pending-changes.ts as defense in depth) and
// told never to guess.
// ---------------------------------------------------------------------------

interface AiClassificationJson {
  relevant: boolean;
  classCode: string | null;
  category: EmailCategory;
  summary: string;
  confidence: number;
  facts: Array<{
    entityType: EntityType;
    targetHint: string | null;
    field: string;
    newValue: string;
    isNewRecord: boolean;
    newRecordName: string | null;
  }>;
}

const CATEGORIES: EmailCategory[] = [
  "EXAM",
  "ASSIGNMENT",
  "SCHEDULE_CHANGE",
  "SYLLABUS",
  "ANNOUNCEMENT",
  "OTHER_ACADEMIC",
  "IRRELEVANT",
];

function fieldAllowlistText(): string {
  return (Object.entries(ENTITY_FIELDS) as Array<[EntityType, string[]]>)
    .map(([type, fields]) => `${type}: ${fields.join(", ")}`)
    .join("\n");
}

export async function classifyWithAi(email: GmailMessageSummary, classes: ClassLite[]): Promise<ClassificationResult | null> {
  const classList = classes.map((c) => `- ${c.code} — ${c.name}${c.professor ? ` (Prof. ${c.professor})` : ""}`).join("\n");

  const system = `You classify a college student's email for academic relevance and extract only facts you are confident about. Never invent a date, name, or fact not clearly stated in the email. If unsure, leave "facts" empty and lower "confidence" — being wrong is worse than saying nothing.

The student's classes:
${classList}

Allowed fields per entity type (do not propose any field outside this list):
${fieldAllowlistText()}

Dates must be ISO 8601 (e.g. "2026-09-03T14:00:00"). This email was received on ${email.receivedAt.toISOString()} — use that as "today" to resolve relative dates like "next Wednesday." If you can't confidently resolve a date, omit that fact entirely rather than guessing.

Reply with one JSON object with exactly these keys:
- "relevant": true only if the email is about the student's classes, coursework, grades or academic schedule.
- "classCode": the code (as listed above) of the one class it's about, or null.
- "category": one of:
  - "EXAM": about a specific exam, quiz or test in one of the student's classes.
  - "ASSIGNMENT": about a specific assignment in one of the student's classes.
  - "SCHEDULE_CHANGE": a class meeting, exam or deadline moved, cancelled or relocated.
  - "SYLLABUS": a syllabus or course policy.
  - "ANNOUNCEMENT": a general academic announcement, including academic newsletters and digests.
  - "OTHER_ACADEMIC": academic, but none of the above.
  - "IRRELEVANT": not academic (personal mail, shopping, campus events, marketing).
- "summary": one plain sentence saying what the student needs to know.
- "confidence": a number from 0 to 1.
- "facts": a list (often empty) of objects with "entityType", "targetHint" (the name of the existing exam or assignment it changes, or null), "field", "newValue", "isNewRecord" and "newRecordName" (or null).

Newsletters, digests, event roundups and automated summaries (like Canvas's weekly notification report) mention exams and assignments in passing without being about one. They are never EXAM, ASSIGNMENT, SCHEDULE_CHANGE or SYLLABUS: use ANNOUNCEMENT if they're academic, IRRELEVANT if not, and give no facts.`;

  const prompt = `From: ${email.fromName ?? ""} <${email.fromAddress}>\nSubject: ${email.subject}\nSent to a mailing list: ${email.isBulk ? "yes" : "no"}\n\n${email.bodyText || email.snippet}`;

  const result = await askClaudeForJson<AiClassificationJson>({ system, prompt, maxTokens: 800 });
  if (!result) return null;

  // The model saw the class list. When it names no class, only a course
  // code or the professor's name in the email overrides that, not a
  // class-name word in passing.
  const namedClassId = result.classCode
    ? classes.find((c) => c.code.toLowerCase() === result.classCode!.toLowerCase())?.id ?? matchClassId(`${result.classCode} ${email.subject}`, classes)
    : matchClassId(`${email.subject} ${email.bodyText}`, classes, STRONG_CLASS_MATCH);

  const relevant = !!result.relevant;
  let category: EmailCategory = CATEGORIES.includes(result.category) ? result.category : relevant ? "OTHER_ACADEMIC" : "IRRELEVANT";
  // Checked here as well as asked for above: a newsletter is never the
  // source of an exam, an assignment or a change to either. It covers
  // several things, so it's tagged with a class only when its subject
  // names one.
  const newsletter = looksLikeNewsletter(email, namedClassId);
  if (newsletter && SPECIFIC_CATEGORIES.has(category)) category = "ANNOUNCEMENT";
  const classId = newsletter ? matchClassId(email.subject, classes, STRONG_CLASS_MATCH) : namedClassId;

  const facts: ExtractedFact[] = (newsletter ? [] : result.facts ?? [])
    .filter((f) => ENTITY_FIELDS[f.entityType]?.includes(f.field))
    .map((f) => ({
      entityType: f.entityType,
      entityMatchHint: f.targetHint,
      field: f.field,
      newValue: f.newValue,
      isNewRecord: f.isNewRecord,
      newRecordName: f.newRecordName ?? undefined,
    }));

  return {
    relevant,
    classId,
    category,
    summary: result.summary || email.snippet,
    confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
    facts,
    usedAi: true,
  };
}

export async function classifyEmail(email: GmailMessageSummary, classes: ClassLite[]): Promise<ClassificationResult> {
  const ai = await classifyWithAi(email, classes);
  if (ai) return ai;
  const heuristic = classifyHeuristic(email, classes);
  return { ...heuristic, facts: [], usedAi: false };
}
