import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDueLabel } from "@/lib/time";
import { assignmentStatusLabel } from "@/lib/assignment-status";
import { classMaterialTypeLabel, joinWithBudget } from "@/lib/lecture-notes";

/**
 * Everything on file for one class, flattened to text. The class assistant
 * shows this when the AI isn't set up (a local copy without an API key);
 * with AI, the study assistant (src/lib/study-agent) looks things up with
 * its own tools, pinned to the class, which is what keeps it from mixing in
 * other classes.
 */
export interface ClassContext {
  className: string;
  professor: string | null;
  notesText: string; // every section + note, flattened, section headers preserved
  assignmentsText: string;
  examsText: string;
  resourcesText: string;
  lecturesText: string; // AI-generated notes from each ready lecture (see Lecture.notesMarkdown)
  materialsText: string; // books/slides (see ClassMaterial)
  emailsText: string;
  hasAnyContent: boolean;
}

// Combined (not per-item) budgets for lecture notes and materials — a
// class with a handful of items gets them in full, while a class with
// dozens (e.g. after a bulk Canvas import) still gets bounded to something
// that fits Claude's context window and stays cost-sane. Whole items are
// included in original order up to the budget rather than slicing every
// item down uniformly, so what's included is actually complete rather than
// every single item being cut to an unreadable fragment.
const MAX_LECTURES_CHARS = 100_000;
const MAX_MATERIALS_CHARS = 100_000;

/**
 * Materials with real text in them, for anything that sends materials to
 * the AI (this file, and note generation in lecture-actions.ts). Hand-added
 * materials have no syncStatus. SKIPPED_* and MISSING rows are placeholders
 * and FAILED rows hold an error message: the Resources tab lists those, but
 * they'd only be noise (and cost) in a prompt.
 */
export const MATERIALS_WITH_TEXT = {
  OR: [{ syncStatus: null }, { syncStatus: { in: ["READY", "EXTERNAL"] } }],
} satisfies Prisma.ClassMaterialWhereInput;

export async function loadClassContext(classId: string, userId: string, tz: string): Promise<ClassContext> {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    include: {
      noteSections: { include: { notes: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
      assignments: { include: { tasks: true }, orderBy: { dueAt: "asc" } },
      exams: { orderBy: { examAt: "asc" } },
      resources: true,
      lectures: {
        where: { status: "READY" },
        orderBy: { createdAt: "desc" },
        include: { notes: { select: { bodyMarkdown: true }, orderBy: { createdAt: "asc" }, take: 1 } },
      },
      materials: { where: MATERIALS_WITH_TEXT, orderBy: { createdAt: "asc" } },
      emails: {
        where: { category: { notIn: ["IRRELEVANT", "UNCLASSIFIED"] } },
        orderBy: { receivedAt: "desc" },
        take: 20,
      },
    },
  });
  if (!cls || cls.userId !== userId) {
    throw new Error("Class not found.");
  }

  const now = new Date();

  // A lecture's note (Note.lectureId) goes in with the lecture notes below,
  // in full, rather than twice.
  const notesText = cls.noteSections
    .map((s) => {
      const ownNotes = s.notes.filter((n) => !n.lectureId);
      if (ownNotes.length === 0) return null;
      const body = ownNotes
        .map((n) => `  - ${n.title}${n.pinned ? " (pinned)" : ""}: ${n.bodyMarkdown.slice(0, 1500)}`)
        .join("\n");
      return `## ${s.name}\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n") || "(no notes yet)";

  const assignmentsText =
    cls.assignments
      .map((a) => {
        const due = formatDueLabel(a.dueAt, now, tz);
        const steps = a.tasks.length
          ? ` [${a.tasks.filter((t) => !t.completed).length}/${a.tasks.length} steps remaining]`
          : "";
        return `- ${a.name} — ${due} — status: ${assignmentStatusLabel(a.status).toLowerCase()}${steps}`;
      })
      .join("\n") || "(no assignments on file)";

  const examsText =
    cls.exams
      .map((e) => `- ${e.name} — ${formatDueLabel(e.examAt, now, tz)}${e.location ? ` at ${e.location}` : ""}${e.notes ? ` — ${e.notes}` : ""}`)
      .join("\n") || "(no exams on file)";

  const resourcesText =
    cls.resources.map((r) => `- ${r.title}${r.notes ? `: ${r.notes}` : ""}`).join("\n") || "(no resources saved)";

  const lecturesText =
    joinWithBudget(
      // The student's edited copy in the Notes tab, when there is one.
      cls.lectures.map((l) => `## ${l.title}\n${l.notes[0]?.bodyMarkdown ?? l.notesMarkdown ?? ""}`),
      MAX_LECTURES_CHARS
    ) || "(no lecture notes yet)";

  const materialsText =
    joinWithBudget(
      cls.materials.map((m) => `- [${classMaterialTypeLabel(m.type)}] ${m.title}: ${m.content}`),
      MAX_MATERIALS_CHARS
    ) || "(no books or slides added yet)";

  const emailsText =
    cls.emails
      .map((e) => `- [${e.category}] "${e.subject}" (${e.receivedAt.toDateString()}): ${e.snippet ?? ""}`)
      .join("\n") || "(no relevant emails on file)";

  return {
    className: cls.name,
    professor: cls.professor,
    notesText,
    assignmentsText,
    examsText,
    resourcesText,
    lecturesText,
    materialsText,
    emailsText,
    hasAnyContent:
      cls.noteSections.some((s) => s.notes.length > 0) ||
      cls.assignments.length > 0 ||
      cls.exams.length > 0 ||
      cls.resources.length > 0 ||
      cls.lectures.length > 0 ||
      cls.materials.length > 0 ||
      cls.emails.length > 0,
  };
}

/**
 * Tutor mode (src/lib/features.ts): for anything that looks like graded
 * work, hints and questions instead of the finished answer. Students who
 * leaned on an unguarded AI tutor did worse once it was gone; with these
 * guardrails they didn't (Bastani et al., PNAS 2025).
 */
export const TUTOR_MODE_INSTRUCTIONS = [
  "Tutor mode is on. When the student asks you to solve, answer or write something that looks like graded work " +
    "(a homework or assignment problem, a quiz or test question, an essay, a lab write-up or a discussion post), " +
    "don't give the finished answer and don't write it for them.",
  "Instead, in one short line say you'll help them work it out, then do one of these: give a hint or the first step, " +
    "ask a guiding question, point to the part of their notes that covers it, or work a similar example with different numbers.",
  "Let them try. When they share an attempt, check it: say what's right, what to fix and why, without rewriting the whole thing.",
  "If they ask for the answer anyway, explain that tutor mode is on and they can turn it off under Account → Features.",
  "Explaining concepts, summarizing their notes, making study guides and quizzing them are fine as usual.",
].join(" ");
