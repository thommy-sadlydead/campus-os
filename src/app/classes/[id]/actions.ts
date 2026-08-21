"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

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
// Overview — professor / room / current grade. Canvas never provides these
// (confirmed by inspecting scripts/sync-canvas.ts), so this is either typed
// in directly or filled in later by an accepted email PendingChange.
// ---------------------------------------------------------------------------

const overviewSchema = z.object({
  professor: z.string().max(120).optional(),
  room: z.string().max(120).optional(),
  currentGrade: z.string().max(20).optional(),
});

export async function updateClassOverviewAction(classId: string, formData: FormData) {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const parsed = overviewSchema.parse({
    professor: formData.get("professor") || undefined,
    room: formData.get("room") || undefined,
    currentGrade: formData.get("currentGrade") || undefined,
  });

  await prisma.class.update({
    where: { id: classId },
    data: {
      professor: parsed.professor ?? null,
      room: parsed.room ?? null,
      currentGrade: parsed.currentGrade ?? null,
    },
  });

  revalidatePath(`/classes/${classId}`);
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
  revalidatePath("/notes");
}

export async function renameSectionAction(sectionId: string, name: string) {
  const user = await requireUser();
  const section = await prisma.noteSection.findUnique({ where: { id: sectionId }, include: { class: true } });
  if (!section || section.class.userId !== user.id) throw new Error("Not found.");
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) throw new Error("Section name can't be empty.");
  await prisma.noteSection.update({ where: { id: sectionId }, data: { name: trimmed } });
  revalidatePath(`/classes/${section.classId}`);
  revalidatePath("/notes");
}

export async function deleteSectionAction(sectionId: string) {
  const user = await requireUser();
  const section = await prisma.noteSection.findUnique({ where: { id: sectionId }, include: { class: true } });
  if (!section || section.class.userId !== user.id) throw new Error("Not found.");
  await prisma.noteSection.delete({ where: { id: sectionId } }); // cascades to its notes
  revalidatePath(`/classes/${section.classId}`);
  revalidatePath("/notes");
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
  revalidatePath("/notes");
}

const noteSchema = z.object({
  title: z.string().max(160),
  bodyMarkdown: z.string().max(20000),
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
  revalidatePath("/notes");
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
  revalidatePath("/notes");
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
  revalidatePath("/notes");
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
  revalidatePath("/notes");
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
  revalidatePath("/notes");
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
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().max(80).optional(),
  label: z.string().max(60).optional(),
});

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function addScheduleEventAction(classId: string, formData: FormData) {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const parsed = scheduleEventSchema.parse({
    dayOfWeek: formData.get("dayOfWeek"),
    start: formData.get("start"),
    end: formData.get("end"),
    location: formData.get("location") || undefined,
    label: formData.get("label") || undefined,
  });

  const startMinute = hhmmToMinutes(parsed.start);
  const endMinute = hhmmToMinutes(parsed.end);
  if (endMinute <= startMinute) throw new Error("End time must be after start time.");

  await prisma.scheduleEvent.create({
    data: {
      classId,
      dayOfWeek: parsed.dayOfWeek,
      startMinute,
      endMinute,
      location: parsed.location || null,
      label: parsed.label || null,
    },
  });
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/schedule");
}

export async function deleteScheduleEventAction(eventId: string) {
  const user = await requireUser();
  const event = await prisma.scheduleEvent.findUnique({ where: { id: eventId }, include: { class: true } });
  if (!event || event.class.userId !== user.id) throw new Error("Not found.");
  await prisma.scheduleEvent.delete({ where: { id: eventId } });
  revalidatePath(`/classes/${event.classId}`);
  revalidatePath("/schedule");
}
