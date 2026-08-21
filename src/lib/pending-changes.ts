import "server-only";
import { prisma } from "@/lib/prisma";
import { ENTITY_FIELDS, decideChangeOutcome, isAllowedField, type EntityType } from "@/lib/change-rules";

export type { EntityType };
export { ENTITY_FIELDS };

// The conflict-resolution engine behind "email never overwrites your
// schedule/assignments directly." Every fact an email-intelligence pass
// finds comes through proposeChange() here, which uses decideChangeOutcome
// (src/lib/change-rules.ts) to pick one of three outcomes:
//
//   1. The field already holds the same value -> nothing to do. Logged as
//      an already-resolved PendingChange for the record ("confirmed"),
//      but never surfaced as something the student needs to act on.
//   2. The field is empty on our side (Canvas never had it) -> genuinely
//      unambiguous new information, applied immediately. Still logged, so
//      there's a visible trail of what changed and why.
//   3. The field holds a *different* value -> a real conflict. Always
//      PENDING, always shown to the student with both versions, never
//      auto-applied.
//
// A proposal for a brand-new record (entityId === null — an exam or
// assignment Canvas doesn't list at all) is always PENDING too: creating a
// new academic record is a bigger deal than filling in one field, and the
// class-matching step upstream is a best-effort heuristic, not certain.

export async function getCurrentFieldValue(entityType: EntityType, entityId: string, field: string): Promise<string | null> {
  switch (entityType) {
    case "Exam": {
      const e = await prisma.exam.findUnique({ where: { id: entityId } });
      if (!e) return null;
      if (field === "examAt") return e.examAt?.toISOString() ?? null;
      if (field === "location") return e.location;
      if (field === "weight") return e.weight != null ? String(e.weight) : null;
      if (field === "name") return e.name;
      return null;
    }
    case "Assignment": {
      const a = await prisma.assignment.findUnique({ where: { id: entityId } });
      if (!a) return null;
      if (field === "dueAt") return a.dueAt?.toISOString() ?? null;
      if (field === "name") return a.name;
      if (field === "description") return a.description;
      if (field === "pointsPossible") return a.pointsPossible != null ? String(a.pointsPossible) : null;
      return null;
    }
    case "ScheduleEvent": {
      const s = await prisma.scheduleEvent.findUnique({ where: { id: entityId } });
      if (!s) return null;
      if (field === "location") return s.location;
      return null;
    }
    case "Class": {
      const c = await prisma.class.findUnique({ where: { id: entityId } });
      if (!c) return null;
      if (field === "professor") return c.professor;
      if (field === "room") return c.room;
      if (field === "currentGrade") return c.currentGrade;
      return null;
    }
  }
}

async function applyFieldValue(entityType: EntityType, entityId: string, field: string, value: string): Promise<void> {
  const dateValue = () => {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new Error(`"${value}" isn't a valid date for ${field}.`);
    return d;
  };
  const numberValue = () => {
    const n = Number(value);
    if (isNaN(n)) throw new Error(`"${value}" isn't a valid number for ${field}.`);
    return n;
  };

  switch (entityType) {
    case "Exam":
      await prisma.exam.update({
        where: { id: entityId },
        data:
          field === "examAt" ? { examAt: dateValue() } :
          field === "location" ? { location: value } :
          field === "weight" ? { weight: numberValue() } :
          field === "name" ? { name: value } : {},
      });
      return;
    case "Assignment":
      await prisma.assignment.update({
        where: { id: entityId },
        data:
          field === "dueAt" ? { dueAt: dateValue() } :
          field === "name" ? { name: value } :
          field === "description" ? { description: value } :
          field === "pointsPossible" ? { pointsPossible: numberValue() } : {},
      });
      return;
    case "ScheduleEvent":
      if (field === "location") await prisma.scheduleEvent.update({ where: { id: entityId }, data: { location: value } });
      return;
    case "Class":
      await prisma.class.update({
        where: { id: entityId },
        data:
          field === "professor" ? { professor: value } :
          field === "room" ? { room: value } :
          field === "currentGrade" ? { currentGrade: value } : {},
      });
      return;
  }
}

export interface ProposeChangeInput {
  userId: string;
  classId: string;
  sourceEmailId: string;
  sourceLabel: string; // e.g. "an email from your professor" — used in the human-readable reason
  entityType: EntityType;
  entityId: string | null; // null = propose creating a new record
  field: string;
  newValueText: string;
  newRecordName?: string; // required context when entityId is null
}

export async function proposeChange(input: ProposeChangeInput): Promise<void> {
  if (!isAllowedField(input.entityType, input.field)) {
    throw new Error(`"${input.field}" isn't a field email intelligence is allowed to touch on ${input.entityType}.`);
  }

  if (input.entityId === null) {
    // New record — always requires a human decision.
    await prisma.pendingChange.create({
      data: {
        userId: input.userId,
        classId: input.classId,
        sourceEmailId: input.sourceEmailId,
        entityType: input.entityType,
        entityId: null,
        field: input.field,
        oldValueText: null,
        newValueText: input.newValueText,
        reason: `${input.sourceLabel} mentions a ${input.entityType.toLowerCase()}${
          input.newRecordName ? ` ("${input.newRecordName}")` : ""
        } that isn't on file yet.`,
        status: "PENDING",
      },
    });
    return;
  }

  const oldValueText = await getCurrentFieldValue(input.entityType, input.entityId, input.field);
  const outcome = decideChangeOutcome(oldValueText, input.newValueText, input.field);

  if (outcome === "same") {
    // Already matches — nothing to change, but worth a quiet audit trail
    // entry rather than silently discarding what the email confirmed.
    await prisma.pendingChange.create({
      data: {
        userId: input.userId,
        classId: input.classId,
        sourceEmailId: input.sourceEmailId,
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
        oldValueText,
        newValueText: input.newValueText,
        reason: `${input.sourceLabel} confirmed what was already on file — no change needed.`,
        status: "ACCEPTED",
        resolvedAt: new Date(),
      },
    });
    return;
  }

  if (outcome === "auto-apply") {
    // Genuinely new information Canvas never had — unambiguous, apply now.
    await applyFieldValue(input.entityType, input.entityId, input.field, input.newValueText);
    await prisma.pendingChange.create({
      data: {
        userId: input.userId,
        classId: input.classId,
        sourceEmailId: input.sourceEmailId,
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
        oldValueText,
        newValueText: input.newValueText,
        reason: `Canvas didn't have this — added automatically from ${input.sourceLabel}.`,
        status: "ACCEPTED",
        resolvedAt: new Date(),
      },
    });
    return;
  }

  // A real conflict — always ask.
  await prisma.pendingChange.create({
    data: {
      userId: input.userId,
      classId: input.classId,
      sourceEmailId: input.sourceEmailId,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field,
      oldValueText,
      newValueText: input.newValueText,
      reason: `${input.sourceLabel} disagrees with what's currently on file.`,
      status: "PENDING",
    },
  });
}

export async function resolvePendingChange(id: string, userId: string, decision: "accept" | "reject"): Promise<void> {
  const change = await prisma.pendingChange.findUnique({ where: { id } });
  if (!change || change.userId !== userId) throw new Error("Not found.");
  if (change.status !== "PENDING") return; // already resolved — no-op, not an error

  if (decision === "reject") {
    await prisma.pendingChange.update({ where: { id }, data: { status: "REJECTED", resolvedAt: new Date() } });
    return;
  }

  const entityType = change.entityType as EntityType;
  if (change.entityId) {
    await applyFieldValue(entityType, change.entityId, change.field, change.newValueText ?? "");
  } else {
    await createNewEntity(entityType, change.classId, change.field, change.newValueText ?? "");
  }
  await prisma.pendingChange.update({ where: { id }, data: { status: "ACCEPTED", resolvedAt: new Date() } });
}

async function createNewEntity(entityType: EntityType, classId: string | null, field: string, value: string): Promise<void> {
  if (!classId) throw new Error("A new record needs a class to attach to.");
  if (entityType === "Exam") {
    await prisma.exam.create({
      data: {
        classId,
        name: field === "name" ? value : "Exam (from email)",
        examAt: field === "examAt" ? new Date(value) : null,
      },
    });
  } else if (entityType === "Assignment") {
    await prisma.assignment.create({
      data: {
        classId,
        name: field === "name" ? value : "Assignment (from email)",
        dueAt: field === "dueAt" ? new Date(value) : null,
      },
    });
  } else if (entityType === "ScheduleEvent") {
    // A brand-new meeting time from an email is unusual enough (and
    // under-specified without a day/time pair) that we don't try to guess
    // the rest — this path is a placeholder the student fills in from the
    // Schedule tab rather than a fabricated meeting time.
    throw new Error("New meeting times need day/time details — add this one from the Schedule tab instead.");
  }
}
