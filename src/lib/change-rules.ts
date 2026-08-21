// Pure decision rules behind the email -> PendingChange conflict system —
// no Prisma, no Next.js, so it's unit-testable the same way
// priority-engine.ts is (see tests/change-rules.test.ts). The Prisma-backed
// read/write/apply layer lives in src/lib/pending-changes.ts, which is to
// this file what src/lib/workload.ts is to priority-engine.ts.

export type EntityType = "Exam" | "Assignment" | "ScheduleEvent" | "Class";

export const ENTITY_FIELDS: Record<EntityType, string[]> = {
  Exam: ["examAt", "location", "weight", "name"],
  Assignment: ["dueAt", "name", "description", "pointsPossible"],
  ScheduleEvent: ["location"],
  Class: ["professor", "room", "currentGrade"],
};

const DATE_FIELDS = new Set(["examAt", "dueAt"]);
const NUMBER_FIELDS = new Set(["weight", "pointsPossible"]);

/** Canonicalizes a field's text value so date/number formatting differences don't look like real conflicts. */
export function normalizeForCompare(field: string, value: string | null): string {
  if (value == null) return "";
  if (DATE_FIELDS.has(field)) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value.trim().toLowerCase() : d.toISOString();
  }
  if (NUMBER_FIELDS.has(field)) {
    const n = Number(value);
    return isNaN(n) ? value.trim().toLowerCase() : String(n);
  }
  return value.trim().toLowerCase();
}

export type ChangeOutcome = "same" | "auto-apply" | "conflict";

/**
 * The heart of "email never silently overwrites your schedule": given
 * what's currently on file and what an email proposes, decide whether
 * this is nothing new (same), safe to apply automatically (auto-apply —
 * the field was empty, so there's nothing to conflict with), or a real
 * conflict that must be shown to the student (conflict).
 */
export function decideChangeOutcome(oldValueText: string | null, newValueText: string, field: string): ChangeOutcome {
  if (normalizeForCompare(field, oldValueText) === normalizeForCompare(field, newValueText)) return "same";
  if (oldValueText == null || oldValueText === "") return "auto-apply";
  return "conflict";
}

export function isAllowedField(entityType: EntityType, field: string): boolean {
  return ENTITY_FIELDS[entityType]?.includes(field) ?? false;
}
