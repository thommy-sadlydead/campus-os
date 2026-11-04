"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { DATE_PATTERN, meetingTimeProblem, parseMeetingDays } from "@/lib/meetings";
import { parseGradePercent } from "@/lib/grades";
import { recordGrade } from "@/lib/grade-records";
import { featuresFor } from "@/lib/features-server";

/**
 * Confirms the class belongs to the current user, or throws. These are all
 * Server Actions (form/RPC calls), not page renders, so a plain thrown
 * error is the right signal here — `notFound()` is reserved for the page
 * component itself (src/app/classes/[id]/page.tsx), which does its own
 * ownership check inline before rendering.
 */
async function requireOwnedClass(classId: string, userId: string) {
  const cls = await prisma.class.findUnique({ where: { id: classId } });
  if (!cls || cls.userId !== userId) throw new Error("Not found.");
  return cls;
}

// ---------------------------------------------------------------------------
// Overview — professor / room / current grade, and with Getting help on,
// the professor's email and office hours. The LMS doesn't provide these,
// so they're typed in, found in the syllabus (findHelpInSyllabusAction),
// or filled in later by an accepted email PendingChange. A Canvas grade
// comes from the sync instead (src/lib/grade-records.ts).
// ---------------------------------------------------------------------------

const overviewSchema = z.object({
  professor: z.string().max(120).optional(),
  room: z.string().max(120).optional(),
  currentGrade: z.string().max(20).optional(),
  professorEmail: z.string().trim().max(200).email().optional(),
  officeHours: z.string().trim().max(200).optional(),
});

export async function updateClassOverviewAction(classId: string, formData: FormData) {
  const user = await requireUser();
  const cls = await requireOwnedClass(classId, user.id);
  const features = await featuresFor(user);

  const parsed = overviewSchema.safeParse({
    professor: formData.get("professor") || undefined,
    room: formData.get("room") || undefined,
    currentGrade: formData.get("currentGrade") || undefined,
    professorEmail: formData.get("professorEmail") || undefined,
    officeHours: formData.get("officeHours") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.some((i) => i.path[0] === "professorEmail") ? "That email address doesn't look right." : "Check the details and try again." };
  }

  await prisma.class.update({
    where: { id: classId },
    data: {
      professor: parsed.data.professor ?? null,
      room: parsed.data.room ?? null,
      currentGrade: parsed.data.currentGrade ?? null,
      // Only on the form with Getting help on, so turning it off doesn't clear them.
      ...(features.has("get-help")
        ? { professorEmail: parsed.data.professorEmail ?? null, officeHours: parsed.data.officeHours ?? null }
        : {}),
    },
  });

  // A typed grade with a number in it ("88%", "B+ (88%)") counts as the
  // class's grade, so the dashboard can tell when it slips.
  const typed = parseGradePercent(parsed.data.currentGrade);
  if (features.has("grades") && typed !== null && parsed.data.currentGrade !== cls.currentGrade) {
    await recordGrade(prisma, classId, { percent: typed, letter: null }, "manual");
  }

  revalidatePath(`/classes/${classId}`);
  return undefined;
}

/** The student's goal for a class, for the final-exam calculator and "below your goal". */
export async function setGradeTargetAction(classId: string, target: number | null): Promise<void> {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);
  const value = target === null ? null : Number(target);
  if (value !== null && !(Number.isFinite(value) && value > 0 && value <= 100)) return;
  await prisma.class.update({ where: { id: classId }, data: { gradeTarget: value } });
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Notes — sections and notes. No forced structure: sections are created,
// renamed, deleted, and reordered freely; notes live in exactly one
// section, can be pinned, and are reordered the same way.
// ---------------------------------------------------------------------------

export async function createSectionAction(classId: string, name: string) {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);
  const trimmed = name.trim().slice(0, 80) || "Untitled section";

  const max = await prisma.noteSection.aggregate({
    where: { classId },
    _max: { order: true },
  });
  await prisma.noteSection.create({
    data: { classId, name: trimmed, order: (max._max.order ?? -1) + 1 },
  });
  revalidatePath(`/classes/${classId}`);
}

export async function renameSectionAction(sectionId: string, name: string) {
  const user = await requireUser();
  const section = await prisma.noteSection.findUnique({ where: { id: sectionId }, include: { class: true } });
  if (!section || section.class.userId !== user.id) throw new Error("Not found.");
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) throw new Error("Section name can't be empty.");
  await prisma.noteSection.update({ where: { id: sectionId }, data: { name: trimmed } });
  revalidatePath(`/classes/${section.classId}`);
}

export async function deleteSectionAction(sectionId: string) {
  const user = await requireUser();
  const section = await prisma.noteSection.findUnique({ where: { id: sectionId }, include: { class: true } });
  if (!section || section.class.userId !== user.id) throw new Error("Not found.");
  await prisma.noteSection.delete({ where: { id: sectionId } }); // cascades to its notes
  revalidatePath(`/classes/${section.classId}`);
}

export async function moveSectionAction(sectionId: string, direction: "up" | "down") {
  const user = await requireUser();
  const section = await prisma.noteSection.findUnique({ where: { id: sectionId }, include: { class: true } });
  if (!section || section.class.userId !== user.id) throw new Error("Not found.");

  const siblings = await prisma.noteSection.findMany({
    where: { classId: section.classId },
    orderBy: { order: "asc" },
  });
  const idx = siblings.findIndex((s) => s.id === sectionId);
  const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) return; // already at the edge — no-op

  await prisma.$transaction([
    prisma.noteSection.update({ where: { id: section.id }, data: { order: swapWith.order } }),
    prisma.noteSection.update({ where: { id: swapWith.id }, data: { order: section.order } }),
  ]);
  revalidatePath(`/classes/${section.classId}`);
}

// Lecture notes land here too (src/lib/lecture-notes-sync.ts), and a full
// lecture's notes can run well past 20,000 characters.
const noteSchema = z.object({
  title: z.string().max(160),
  bodyMarkdown: z.string().max(100_000),
});

export async function createNoteAction(sectionId: string, formData: FormData) {
  const user = await requireUser();
  const section = await prisma.noteSection.findUnique({ where: { id: sectionId }, include: { class: true } });
  if (!section || section.class.userId !== user.id) throw new Error("Not found.");

  const parsed = noteSchema.parse({
    title: (formData.get("title") as string) || "Untitled note",
    bodyMarkdown: (formData.get("bodyMarkdown") as string) || "",
  });

  const max = await prisma.note.aggregate({ where: { sectionId }, _max: { order: true } });
  await prisma.note.create({
    data: { sectionId, title: parsed.title, bodyMarkdown: parsed.bodyMarkdown, order: (max._max.order ?? -1) + 1 },
  });
  revalidatePath(`/classes/${section.classId}`);
}

export async function updateNoteAction(noteId: string, formData: FormData) {
  const user = await requireUser();
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { section: { include: { class: true } } },
  });
  if (!note || note.section.class.userId !== user.id) throw new Error("Not found.");

  const parsed = noteSchema.parse({
    title: (formData.get("title") as string) || "Untitled note",
    bodyMarkdown: (formData.get("bodyMarkdown") as string) || "",
  });

  await prisma.note.update({
    where: { id: noteId },
    data: { title: parsed.title, bodyMarkdown: parsed.bodyMarkdown },
  });
  revalidatePath(`/classes/${note.section.classId}`);
}

export async function deleteNoteAction(noteId: string) {
  const user = await requireUser();
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { section: { include: { class: true } } },
  });
  if (!note || note.section.class.userId !== user.id) throw new Error("Not found.");
  await prisma.note.delete({ where: { id: noteId } });
  revalidatePath(`/classes/${note.section.classId}`);
}

export async function toggleNotePinAction(noteId: string) {
  const user = await requireUser();
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { section: { include: { class: true } } },
  });
  if (!note || note.section.class.userId !== user.id) throw new Error("Not found.");
  await prisma.note.update({ where: { id: noteId }, data: { pinned: !note.pinned } });
  revalidatePath(`/classes/${note.section.classId}`);
}

export async function moveNoteAction(noteId: string, direction: "up" | "down") {
  const user = await requireUser();
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { section: { include: { class: true } } },
  });
  if (!note || note.section.class.userId !== user.id) throw new Error("Not found.");

  const siblings = await prisma.note.findMany({
    where: { sectionId: note.sectionId },
    orderBy: { order: "asc" },
  });
  const idx = siblings.findIndex((n) => n.id === noteId);
  const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) return;

  await prisma.$transaction([
    prisma.note.update({ where: { id: note.id }, data: { order: swapWith.order } }),
    prisma.note.update({ where: { id: swapWith.id }, data: { order: note.order } }),
  ]);
  revalidatePath(`/classes/${note.section.classId}`);
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const resourceSchema = z.object({
  title: z.string().min(1).max(160),
  type: z.enum(["link", "file", "document"]),
  url: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

export async function addResourceAction(classId: string, formData: FormData) {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const parsed = resourceSchema.safeParse({
    title: formData.get("title"),
    type: formData.get("type") || "link",
    url: formData.get("url") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error("Enter at least a title.");

  await prisma.resource.create({
    data: {
      classId,
      title: parsed.data.title,
      type: parsed.data.type,
      url: parsed.data.url || null,
      notes: parsed.data.notes || null,
    },
  });
  revalidatePath(`/classes/${classId}`);
}

export async function deleteResourceAction(resourceId: string) {
  const user = await requireUser();
  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, include: { class: true } });
  if (!resource || resource.class.userId !== user.id) throw new Error("Not found.");
  await prisma.resource.delete({ where: { id: resourceId } });
  revalidatePath(`/classes/${resource.classId}`);
}

// ---------------------------------------------------------------------------
// Schedule (meeting times) — Canvas doesn't provide these either.
// ---------------------------------------------------------------------------

const scheduleEventSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day."),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().max(80).optional(),
  label: z.string().max(60).optional(),
  startsOn: z.string().regex(DATE_PATTERN).optional(),
  endsOn: z.string().regex(DATE_PATTERN).optional(),
});

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * A weekly meeting on every day picked (one ScheduleEvent per weekday), from
 * the semester's first day to its last when they're given. A day that
 * already has this exact meeting isn't added twice.
 */
export async function addScheduleEventAction(classId: string, formData: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const result = scheduleEventSchema.safeParse({
    days: parseMeetingDays(formData.getAll("dayOfWeek")),
    start: formData.get("start"),
    end: formData.get("end"),
    location: formData.get("location") || undefined,
    label: formData.get("label") || undefined,
    startsOn: formData.get("startsOn") || undefined,
    endsOn: formData.get("endsOn") || undefined,
  });
  if (!result.success) {
    return { error: result.error.issues.some((i) => i.path[0] === "days") ? "Pick at least one day." : "Check the times and dates." };
  }
  const parsed = result.data;

  const startMinute = hhmmToMinutes(parsed.start);
  const endMinute = hhmmToMinutes(parsed.end);
  const problem = meetingTimeProblem({ startMinute, endMinute, startsOn: parsed.startsOn ?? null, endsOn: parsed.endsOn ?? null });
  if (problem) return { error: problem };

  const meeting = {
    classId,
    startMinute,
    endMinute,
    location: parsed.location || null,
    label: parsed.label || null,
    startsOn: parsed.startsOn ?? null,
    endsOn: parsed.endsOn ?? null,
  };
  const existing = await prisma.scheduleEvent.findMany({ where: meeting, select: { dayOfWeek: true } });
  const days = parsed.days.filter((d) => !existing.some((e) => e.dayOfWeek === d));
  if (days.length) await prisma.scheduleEvent.createMany({ data: days.map((dayOfWeek) => ({ ...meeting, dayOfWeek })) });
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/schedule");
  return {};
}

export async function deleteScheduleEventAction(eventId: string) {
  await deleteScheduleEventsAction([eventId]);
}

/** Removes a meeting on all its days at once (the class Overview lists them grouped). */
export async function deleteScheduleEventsAction(eventIds: string[]) {
  const user = await requireUser();
  const ids = z.array(z.string()).min(1).max(7).parse(eventIds);
  const events = await prisma.scheduleEvent.findMany({ where: { id: { in: ids } }, include: { class: true } });
  if (events.length !== ids.length || events.some((e) => e.class.userId !== user.id)) throw new Error("Not found.");
  await prisma.scheduleEvent.deleteMany({ where: { id: { in: ids } } });
  for (const classId of new Set(events.map((e) => e.classId))) revalidatePath(`/classes/${classId}`);
  revalidatePath("/schedule");
}
