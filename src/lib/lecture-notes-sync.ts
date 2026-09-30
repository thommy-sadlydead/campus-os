import "server-only";
import { prisma } from "@/lib/prisma";

// Puts each lecture's generated notes into the class's Notes tab as a real
// note (Note.lectureId), so they can be searched, pinned, moved and edited
// like any other note. The Lectures tab shows that same note, so there's one
// copy to edit, not two that drift apart. Lecture.notesMarkdown keeps the
// notes as first generated.

export const LECTURE_NOTES_SECTION_NAME = "Lecture notes";

/**
 * The section lecture notes go in: whichever section already holds this
 * class's lecture notes (so a student can rename it), else one named
 * "Lecture notes", else a new one at the top of the Notes tab.
 */
async function lectureNotesSectionId(classId: string): Promise<string> {
  const existingLink = await prisma.note.findFirst({
    where: { lectureId: { not: null }, section: { classId } },
    select: { sectionId: true },
    orderBy: { createdAt: "asc" },
  });
  if (existingLink) return existingLink.sectionId;

  const named = await prisma.noteSection.findFirst({ where: { classId, name: LECTURE_NOTES_SECTION_NAME } });
  if (named) return named.id;

  const first = await prisma.noteSection.aggregate({ where: { classId }, _min: { order: true } });
  const section = await prisma.noteSection.create({
    data: { classId, name: LECTURE_NOTES_SECTION_NAME, order: (first._min.order ?? 1) - 1 },
  });
  return section.id;
}

/**
 * Creates the lecture's note if it doesn't have one. Safe to call more than
 * once: without a unique constraint on Note.lectureId (see the schema
 * comment), two overlapping calls could each create one, so any extra copy
 * is deleted right away, keeping the oldest.
 */
export async function addLectureToNotes(lectureId: string): Promise<string | null> {
  const lecture = await prisma.lecture.findUnique({ where: { id: lectureId } });
  if (!lecture?.notesMarkdown) return null;

  const existing = await prisma.note.findFirst({ where: { lectureId }, orderBy: { createdAt: "asc" } });
  if (existing) {
    if (!lecture.noteSyncedAt) {
      await prisma.lecture.update({ where: { id: lectureId }, data: { noteSyncedAt: new Date() } });
    }
    return existing.id;
  }

  const sectionId = await lectureNotesSectionId(lecture.classId);
  const last = await prisma.note.aggregate({ where: { sectionId }, _max: { order: true } });
  await prisma.note.create({
    data: {
      sectionId,
      lectureId,
      title: lecture.title,
      bodyMarkdown: lecture.notesMarkdown,
      order: (last._max.order ?? -1) + 1,
    },
  });
  await prisma.lecture.update({ where: { id: lectureId }, data: { noteSyncedAt: new Date() } });

  const copies = await prisma.note.findMany({ where: { lectureId }, orderBy: { createdAt: "asc" } });
  if (copies.length > 1) {
    await prisma.note.deleteMany({ where: { id: { in: copies.slice(1).map((n) => n.id) } } });
  }
  return copies[0]?.id ?? null;
}

/**
 * Backfill for lectures whose notes were generated before this existed, run
 * when a class page loads. Lectures whose note the student deleted have
 * noteSyncedAt set and are left alone.
 */
export async function addMissingLectureNotes(classId: string): Promise<void> {
  const lectures = await prisma.lecture.findMany({
    where: { classId, status: "READY", notesMarkdown: { not: null }, noteSyncedAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const lecture of lectures) {
    await addLectureToNotes(lecture.id);
  }
}
