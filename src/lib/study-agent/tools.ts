import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatInTimeZone } from "date-fns-tz";
import { formatDueLabel, formatPastMoment } from "@/lib/time";
import { assignmentStatusLabel } from "@/lib/assignment-status";
import { classMaterialTypeLabel } from "@/lib/lecture-notes";
import { stripHtml } from "@/lib/text";
import { capText, rankSearchResults, readChunk, searchTerms, type SearchCandidate } from "@/lib/study-agent/text";

// What the study assistant (src/lib/study-agent/agent.ts) can look up, all
// read-only and always limited to the signed-in student's own classes. In
// a class's assistant, `classId` pins every tool to that one class, which
// is what keeps it from mixing in other classes.

export interface StudyScope {
  userId: string;
  tz: string;
  now: Date;
  /** Set inside one class's assistant: every tool sees only this class. */
  classId?: string;
}

const READ_CHARS = 14_000;
const MAX_RESULT_CHARS = 18_000;
const SEARCH_LIMIT = 12;
const SNIPPET_BEFORE = 220;
const SNIPPET_LENGTH = 520;

const nullableId = { type: ["string", "null"], description: "A class id from list_classes, or null for all classes." } as const;

export function studyTools(scope: StudyScope): Anthropic.Beta.BetaTool[] {
  const inClass = Boolean(scope.classId);
  const classIdParam = inClass
    ? ({ type: ["string", "null"], description: "Ignored here: this assistant only sees the current class." } as const)
    : nullableId;
  const tools: Anthropic.Beta.BetaTool[] = [
    {
      name: "find_upcoming_work",
      description:
        "Lists the student's assignments, quizzes and exams due in a window around now, soonest first, with ids for get_work_item. " +
        "Use it first whenever the student refers to something by time or kind (\"my quiz tomorrow\", \"this week's homework\", \"the next exam\"). " +
        "Quizzes usually show up as assignments with \"quiz\" in the name; exams also come from the class's exam list.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          days_ahead: { type: "integer", description: "How many days ahead to include (1-120). Use 14 when unsure." },
          days_back: { type: "integer", description: "How many days back to include, for things just past due (0-30). Usually 0 or 1." },
          class_id: classIdParam,
          include_done: { type: "boolean", description: "Include work already turned in or graded." },
        },
        required: ["days_ahead", "days_back", "class_id", "include_done"],
        additionalProperties: false,
      },
    },
    {
      name: "get_work_item",
      description:
        "Full details of one assignment, quiz or exam: its directions from the school's site (which often say what it covers), " +
        "points, status, steps, and for exams the location, weight and the student's notes. Read this before deciding what an item covers.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["assignment", "exam"] },
          id: { type: "string", description: "The id from find_upcoming_work." },
        },
        required: ["kind", "id"],
        additionalProperties: false,
      },
    },
    {
      name: "list_class_contents",
      description:
        "A table of contents for one class: its lectures (with dates), the student's notes, course files and pages (syllabus, slides, readings), " +
        "and saved resources, each with an id for read_class_content. Use it to see what exists when searching by topic isn't enough, " +
        "for example to find \"chapter 3\" or the lectures from the last two weeks.",
      strict: true,
      input_schema: {
        type: "object",
        properties: { class_id: { type: "string", description: inClass ? "The current class's id." : "A class id from list_classes." } },
        required: ["class_id"],
        additionalProperties: false,
      },
    },
    {
      name: "search_class_content",
      description:
        "Searches the student's lecture notes, own notes, and course files and pages for topic words, and returns the best matches with a snippet " +
        "and an id for read_class_content. Search with the specific topics, terms or chapter names something covers (e.g. \"enzyme kinetics\" or " +
        "\"\\\"chapter 3\\\" mitosis\"); put an exact phrase in double quotes. Run several searches for different topics rather than one long one.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Topic words to look for." },
          class_id: classIdParam,
        },
        required: ["query", "class_id"],
        additionalProperties: false,
      },
    },
    {
      name: "read_class_content",
      description:
        "Reads a lecture's notes, one of the student's notes, or a course file or page, in pieces of about 14,000 characters. " +
        "If the result has a next_offset, call again with it to keep reading. Read what you'll rely on instead of guessing from snippets.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["lecture", "note", "material"] },
          id: { type: "string" },
          offset: { type: "integer", description: "Where to start, in characters; 0 for the beginning." },
        },
        required: ["kind", "id", "offset"],
        additionalProperties: false,
      },
    },
  ];
  if (!inClass) {
    tools.unshift({
      name: "list_classes",
      description: "Lists the student's current classes with their ids, codes, professors and grades.",
      strict: true,
      input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    });
  }
  return tools;
}

const inputs = {
  list_classes: z.object({}),
  find_upcoming_work: z.object({
    days_ahead: z.number().int(),
    days_back: z.number().int(),
    class_id: z.string().nullable(),
    include_done: z.boolean(),
  }),
  get_work_item: z.object({ kind: z.enum(["assignment", "exam"]), id: z.string() }),
  list_class_contents: z.object({ class_id: z.string() }),
  search_class_content: z.object({ query: z.string(), class_id: z.string().nullable() }),
  read_class_content: z.object({ kind: z.enum(["lecture", "note", "material"]), id: z.string(), offset: z.number().int() }),
};

export type StudyToolName = keyof typeof inputs;

export class StudyToolError extends Error {}

/** Runs one tool call and returns its result as text for the model. Throws StudyToolError for bad input or anything not found. */
export async function runStudyTool(name: string, rawInput: unknown, scope: StudyScope): Promise<string> {
  if (!(name in inputs)) throw new StudyToolError(`There's no tool called ${name}.`);
  const parsed = inputs[name as StudyToolName].safeParse(rawInput);
  if (!parsed.success) throw new StudyToolError(`Invalid input for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const input = parsed.data as never;
  const result = await handlers[name as StudyToolName](input, scope);
  return capText(JSON.stringify(result), MAX_RESULT_CHARS);
}

/** The class a tool may look at: the pinned class inside a class's assistant, otherwise the one asked for (if it's the student's). */
function classFilter(scope: StudyScope, requested: string | null | undefined): { userId: string; id?: string; archived?: boolean } {
  if (scope.classId) return { userId: scope.userId, id: scope.classId };
  if (requested) return { userId: scope.userId, id: requested };
  return { userId: scope.userId, archived: false };
}

async function ownedClass(scope: StudyScope, classId: string) {
  const cls = await prisma.class.findFirst({ where: classFilter(scope, classId) });
  if (!cls) throw new StudyToolError("No class with that id.");
  return cls;
}

function due(at: Date | null, scope: StudyScope) {
  if (!at) return { label: "no date", at: null, past: false };
  return { label: formatDueLabel(at, scope.now, scope.tz), at: at.toISOString(), past: at < scope.now };
}

function plain(text: string | null): string | null {
  if (!text) return null;
  return /<[a-z][\s\S]*>/i.test(text) ? stripHtml(text) : text;
}

const handlers: { [K in StudyToolName]: (input: z.infer<(typeof inputs)[K]>, scope: StudyScope) => Promise<unknown> } = {
  async list_classes(_input, scope) {
    const classes = await prisma.class.findMany({ where: { userId: scope.userId, archived: false }, orderBy: { name: "asc" } });
    return classes.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      professor: c.professor,
      grade: c.gradeLetter ?? c.currentGrade ?? null,
    }));
  },

  async find_upcoming_work(input, scope) {
    const from = new Date(scope.now.getTime() - Math.min(Math.max(input.days_back, 0), 30) * 86_400_000 - 12 * 3_600_000);
    const to = new Date(scope.now.getTime() + Math.min(Math.max(input.days_ahead, 1), 120) * 86_400_000);
    const cls = classFilter(scope, input.class_id);
    const [assignments, exams] = await Promise.all([
      prisma.assignment.findMany({
        where: {
          class: cls,
          dueAt: { gte: from, lte: to },
          ...(input.include_done ? {} : { status: { notIn: ["SUBMITTED", "GRADED"] } }),
        },
        include: { class: { select: { id: true, name: true } }, tasks: { select: { completed: true } } },
        orderBy: { dueAt: "asc" },
        take: 60,
      }),
      prisma.exam.findMany({
        where: { class: cls, examAt: { gte: from, lte: to } },
        include: { class: { select: { id: true, name: true } } },
        orderBy: { examAt: "asc" },
        take: 30,
      }),
    ]);
    const items = [
      ...assignments.map((a) => ({
        kind: "assignment" as const,
        id: a.id,
        name: a.name,
        class_id: a.class.id,
        class_name: a.class.name,
        due: due(a.dueAt, scope),
        status: assignmentStatusLabel(a.status).toLowerCase(),
        has_directions: Boolean(a.description?.trim()),
        steps_left: a.tasks.length ? a.tasks.filter((t) => !t.completed).length : null,
      })),
      ...exams.map((e) => ({
        kind: "exam" as const,
        id: e.id,
        name: e.name,
        class_id: e.class.id,
        class_name: e.class.name,
        due: due(e.examAt, scope),
        has_notes: Boolean(e.notes?.trim()),
      })),
    ].sort((a, b) => (a.due.at ?? "").localeCompare(b.due.at ?? ""));
    return { now: formatInTimeZone(scope.now, scope.tz, "EEEE, MMM d 'at' h:mm a"), items };
  },

  async get_work_item(input, scope) {
    if (input.kind === "assignment") {
      const a = await prisma.assignment.findFirst({
        where: { id: input.id, class: classFilter(scope, null) },
        include: { class: { select: { id: true, name: true } }, tasks: { orderBy: { order: "asc" } } },
      });
      if (!a) throw new StudyToolError("No assignment with that id.");
      return {
        kind: "assignment",
        id: a.id,
        name: a.name,
        class_id: a.class.id,
        class_name: a.class.name,
        due: due(a.dueAt, scope),
        status: assignmentStatusLabel(a.status).toLowerCase(),
        points: a.pointsPossible,
        directions: capText(plain(a.description) ?? "(no directions on file)", 10_000),
        steps: a.tasks.map((t) => ({ title: t.title, done: t.completed })),
      };
    }
    const e = await prisma.exam.findFirst({
      where: { id: input.id, class: classFilter(scope, null) },
      include: { class: { select: { id: true, name: true } } },
    });
    if (!e) throw new StudyToolError("No exam with that id.");
    return {
      kind: "exam",
      id: e.id,
      name: e.name,
      class_id: e.class.id,
      class_name: e.class.name,
      when: due(e.examAt, scope),
      location: e.location,
      weight: e.weight,
      notes: e.notes ?? "(no notes on file)",
    };
  },

  async list_class_contents(input, scope) {
    const cls = await ownedClass(scope, input.class_id);
    const [lectures, sections, materials, resources] = await Promise.all([
      prisma.lecture.findMany({
        where: { classId: cls.id, status: "READY" },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 150,
      }),
      prisma.noteSection.findMany({
        where: { classId: cls.id },
        include: { notes: { where: { lectureId: null }, select: { id: true, title: true, updatedAt: true }, orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      }),
      prisma.$queryRaw<{ id: string; title: string; type: string; chars: number }[]>`
        SELECT id, title, type, length(content)::int AS chars FROM "ClassMaterial"
        WHERE "classId" = ${cls.id} AND ("syncStatus" IS NULL OR "syncStatus" IN ('READY', 'EXTERNAL'))
        ORDER BY "createdAt" ASC LIMIT 200`,
      prisma.resource.findMany({ where: { classId: cls.id }, take: 60 }),
    ]);
    return {
      class: { id: cls.id, name: cls.name, code: cls.code, professor: cls.professor },
      lectures: lectures.map((l) => ({ id: l.id, title: l.title, added: formatPastMoment(l.createdAt, scope.now, scope.tz) })),
      notes: sections.flatMap((s) => s.notes.map((n) => ({ id: n.id, section: s.name, title: n.title }))),
      files_and_pages: materials.map((m) => ({ id: m.id, title: m.title, type: classMaterialTypeLabel(m.type), chars: m.chars })),
      resources: resources.map((r) => ({ title: r.title, url: r.url, notes: r.notes })),
    };
  },

  async search_class_content(input, scope) {
    const terms = searchTerms(input.query);
    if (terms.length === 0) throw new StudyToolError("Search with at least one topic word.");
    const cls = classFilter(scope, input.class_id);
    const classWhere = Prisma.sql`c."userId" = ${cls.userId}${cls.id ? Prisma.sql` AND c.id = ${cls.id}` : Prisma.empty}${
      cls.archived === false ? Prisma.sql` AND c.archived = false` : Prisma.empty
    }`;
    const termColumns = terms.map(
      (t, i) => Prisma.sql`, position(${t} in lower(title)) > 0 AS ${Prisma.raw(`t${i}`)},
        CASE WHEN position(${t} in lower(body)) > 0
          THEN substring(body from greatest(1, position(${t} in lower(body)) - ${SNIPPET_BEFORE}::int) for ${SNIPPET_LENGTH}::int) END AS ${Prisma.raw(`s${i}`)}`
    );
    const anyMatch = Prisma.join(
      terms.map((t) => Prisma.sql`position(${t} in lower(title)) > 0 OR position(${t} in lower(body)) > 0`),
      " OR "
    );
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      WITH src AS (
        SELECT 'material' AS kind, m.id, m.title, m.type AS subtype, c.id AS class_id, c.name AS class_name, m.content AS body
        FROM "ClassMaterial" m JOIN "Class" c ON c.id = m."classId"
        WHERE ${classWhere} AND (m."syncStatus" IS NULL OR m."syncStatus" IN ('READY', 'EXTERNAL'))
        UNION ALL
        SELECT 'note', n.id, n.title, s.name, c.id, c.name, n."bodyMarkdown"
        FROM "Note" n JOIN "NoteSection" s ON s.id = n."sectionId" JOIN "Class" c ON c.id = s."classId"
        WHERE ${classWhere} AND n."lectureId" IS NULL
        UNION ALL
        SELECT 'lecture', l.id, l.title, NULL, c.id, c.name,
          coalesce((SELECT n2."bodyMarkdown" FROM "Note" n2 WHERE n2."lectureId" = l.id ORDER BY n2."createdAt" ASC LIMIT 1), l."notesMarkdown", '')
        FROM "Lecture" l JOIN "Class" c ON c.id = l."classId"
        WHERE ${classWhere} AND l.status = 'READY'
      )
      SELECT kind, id, title, subtype, class_id, class_name, length(body)::int AS chars ${Prisma.join(termColumns, "")}
      FROM src WHERE ${anyMatch}
      LIMIT 80`;
    const candidates: SearchCandidate[] = rows.map((r) => ({
      kind: r.kind as SearchCandidate["kind"],
      id: String(r.id),
      title: String(r.title),
      subtype: r.kind === "material" && r.subtype ? classMaterialTypeLabel(String(r.subtype)) : (r.subtype as string | null),
      classId: String(r.class_id),
      className: String(r.class_name),
      chars: Number(r.chars),
      titleHits: terms.map((_, i) => Boolean(r[`t${i}`])),
      snippets: terms.map((_, i) => (r[`s${i}`] as string | null) ?? null),
    }));
    const results = rankSearchResults(terms, candidates, SEARCH_LIMIT);
    return { searched_for: terms, results, note: results.length ? undefined : "Nothing matched. Try other words, or list_class_contents." };
  },

  async read_class_content(input, scope) {
    const cls = classFilter(scope, null);
    let title: string;
    let className: string;
    let body: string;
    if (input.kind === "material") {
      const m = await prisma.classMaterial.findFirst({ where: { id: input.id, class: cls }, include: { class: { select: { name: true } } } });
      if (!m) throw new StudyToolError("No course file or page with that id.");
      title = `${m.title} (${classMaterialTypeLabel(m.type)})`;
      className = m.class.name;
      body = m.content;
    } else if (input.kind === "note") {
      const n = await prisma.note.findFirst({
        where: { id: input.id, section: { class: cls } },
        include: { section: { select: { name: true, class: { select: { name: true } } } } },
      });
      if (!n) throw new StudyToolError("No note with that id.");
      title = `${n.title} (notes: ${n.section.name})`;
      className = n.section.class.name;
      body = n.bodyMarkdown;
    } else {
      const l = await prisma.lecture.findFirst({
        where: { id: input.id, class: cls },
        include: { class: { select: { name: true } }, notes: { select: { bodyMarkdown: true }, orderBy: { createdAt: "asc" }, take: 1 } },
      });
      if (!l) throw new StudyToolError("No lecture with that id.");
      title = `${l.title} (lecture, ${formatPastMoment(l.createdAt, scope.now, scope.tz)})`;
      className = l.class.name;
      // The student's edited copy when there is one; the transcript only when there are no notes at all.
      body = l.notes[0]?.bodyMarkdown || l.notesMarkdown || (l.transcriptText ? `Transcript:\n${l.transcriptText}` : "");
    }
    const chunk = readChunk(body, input.offset, READ_CHARS);
    return {
      title,
      class_name: className,
      total_chars: body.length,
      offset: Math.max(0, input.offset),
      next_offset: chunk.nextOffset,
      text: chunk.text || "(empty)",
    };
  },
};
