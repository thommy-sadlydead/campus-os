import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDueLabel } from "@/lib/time";
import { classMaterialTypeLabel, joinWithBudget } from "@/lib/lecture-notes";

/**
 * Everything the per-class AI assistant is allowed to see for one class —
 * and nothing else. Per the spec: "It should NOT mix information from
 * unrelated classes unless explicitly asked." Building this object is what
 * enforces that scope; the prompt built from it never mentions other
 * classes' data.
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

export async function loadClassContext(classId: string, userId: string, tz: string): Promise<ClassContext> {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    include: {
      noteSections: { include: { notes: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
      assignments: { include: { tasks: true }, orderBy: { dueAt: "asc" } },
      exams: { orderBy: { examAt: "asc" } },
      resources: true,
      lectures: { where: { status: "READY" }, orderBy: { createdAt: "desc" } },
      materials: { orderBy: { createdAt: "asc" } },
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

  const notesText = cls.noteSections
    .map((s) => {
      if (s.notes.length === 0) return null;
      const body = s.notes
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
        return `- ${a.name} — ${due} — status: ${a.status}${steps}`;
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
      cls.lectures.map((l) => `## ${l.title}\n${l.notesMarkdown ?? ""}`),
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

export function classSystemPrompt(ctx: ClassContext): string {
  return [
    `You are a study assistant scoped ONLY to the class "${ctx.className}"${ctx.professor ? ` (taught by ${ctx.professor})` : ""}.`,
    "Use ONLY the context below. Never invent facts, dates, grades, or content that isn't present in it.",
    "If the context doesn't have what's needed to answer, say so plainly instead of guessing.",
    "Do not reference or compare to the student's other classes — you don't have that information here.",
    "",
    "When writing a study guide, summary, or other reference document (not a short direct answer or an " +
      "iterative quiz), format it for fast studying, not exhaustive transcription: open each major topic with " +
      "its core question or a one-line \"big idea\"; use compact markdown tables for comparisons and " +
      "multi-item lists (e.g. a table of terms/types and what each means) instead of long nested bullet " +
      "sub-sections; use → to show short cause-effect or process chains; bold only the handful of terms " +
      "that actually matter most, not most of the text; and close with a condensed high-yield recap (a short " +
      "comparison table plus a one-sentence takeaway per topic) for a last-minute review. Stay concise and " +
      "scannable, but don't drop real content to get there — the shorter feel should come from tighter " +
      "formatting (tables, arrows, selective bolding), not from covering less of what's actually in the " +
      "context below.",
    "",
    "=== NOTES ===",
    ctx.notesText,
    "",
    "=== ASSIGNMENTS ===",
    ctx.assignmentsText,
    "",
    "=== EXAMS ===",
    ctx.examsText,
    "",
    "=== RESOURCES ===",
    ctx.resourcesText,
    "",
    "=== LECTURE NOTES (from uploaded/pasted lecture transcripts) ===",
    ctx.lecturesText,
    "",
    "=== BOOKS & SLIDES ===",
    ctx.materialsText,
    "",
    "=== RELEVANT EMAILS ===",
    ctx.emailsText,
  ].join("\n");
}
