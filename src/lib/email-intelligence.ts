import "server-only";
import { askClaudeForJson } from "@/lib/anthropic";
import { ENTITY_FIELDS, type EntityType } from "@/lib/change-rules";
import { matchClassId, classifyHeuristic, type ClassLite, type EmailCategory } from "@/lib/email-classify-heuristic";
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

Dates must be ISO 8601 (e.g. "2026-09-03T14:00:00"). This email was received on ${email.receivedAt.toISOString()} — use that as "today" to resolve relative dates like "next Wednesday." If you can't confidently resolve a date, omit that fact entirely rather than guessing.`;

  const prompt = `From: ${email.fromName ?? ""} <${email.fromAddress}>\nSubject: ${email.subject}\n\n${email.bodyText || email.snippet}`;

  const result = await askClaudeForJson<AiClassificationJson>({ system, prompt, maxTokens: 800 });
  if (!result) return null;

  const classId = result.classCode
    ? classes.find((c) => c.code.toLowerCase() === result.classCode!.toLowerCase())?.id ?? matchClassId(`${result.classCode} ${email.subject}`, classes)
    : matchClassId(`${email.subject} ${email.bodyText}`, classes);

  const facts: ExtractedFact[] = (result.facts ?? [])
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
    relevant: !!result.relevant,
    classId,
    category: result.category,
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
