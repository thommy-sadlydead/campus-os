import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDueLabel } from "@/lib/time";

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
  emailsText: string;
  hasAnyContent: boolean;
}

export async function loadClassContext(classId: string, userId: string, tz: string): Promise<ClassContext> {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    include: {
      noteSections: { include: { notes: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
      assignments: { include: { tasks: true }, orderBy: { dueAt: "asc" } },
      exams: { orderBy: { examAt: "asc" } },
      resources: true,
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
    emailsText,
    hasAnyContent:
      cls.noteSections.some((s) => s.notes.length > 0) ||
      cls.assignments.length > 0 ||
      cls.exams.length > 0 ||
      cls.resources.length > 0 ||
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
    "=== RELEVANT EMAILS ===",
    ctx.emailsText,
  ].join("\n");
}
