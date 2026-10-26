import "server-only";
import { prisma } from "@/lib/prisma";
import { getAccess, paymentsEnabled } from "@/lib/billing-server";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assignmentStatusLabel } from "@/lib/assignment-status";
import { classMaterialTypeLabel } from "@/lib/lecture-notes";
import { MATERIALS_WITH_TEXT } from "@/lib/class-context";
import { formatDueLabel } from "@/lib/time";
import { htmlToReadableText } from "@/lib/text";
import { profileIdFor } from "@/lib/oauth/oauth";
import { meetingFor, snippetAround, takeWithinBudget, TOOL_INPUTS, type ToolName } from "@/lib/mcp/tool-defs";

// What each MCP tool does (descriptions and schemas in tool-defs.ts). Every
// query is scoped to the account behind the access token: a class, note or
// file id from another account reads as "not found".

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

const DONE = ["SUBMITTED", "GRADED"];
const NOTES_BUDGET = 60_000;
const MAX_NOTE_CHARS = 30_000;

function ok(data: Record<string, unknown>): ToolResult {
  return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function toolError(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

const notFound = (what: string) => toolError(`That ${what} isn't in this Campus OS account. Use list_classes or get_class for valid ids.`);

const whenLabel = (at: Date | null, now: Date, tz: string) =>
  at ? formatDueLabel(at, now, tz).replace(/^Due /, "").replace(/^Was due /, "Was ") : "No date set";

async function loadUser(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, timezone: true } });
}

function assignmentItem(
  a: { id: string; classId: string; name: string; dueAt: Date | null; status: string; pointsPossible: number | null; tasks: { completed: boolean }[] },
  className: string,
  now: Date,
  tz: string
) {
  return {
    id: a.id,
    class_id: a.classId,
    class_name: className,
    name: a.name,
    due_at: a.dueAt?.toISOString() ?? null,
    due_label: formatDueLabel(a.dueAt, now, tz),
    status: assignmentStatusLabel(a.status),
    points_possible: a.pointsPossible,
    steps_left: a.tasks.length ? a.tasks.filter((t) => !t.completed).length : null,
  };
}

function examItem(e: { id: string; classId: string; name: string; examAt: Date | null; location: string | null }, className: string, now: Date, tz: string) {
  return {
    id: e.id,
    class_id: e.classId,
    class_name: className,
    name: e.name,
    exam_at: e.examAt?.toISOString() ?? null,
    when_label: whenLabel(e.examAt, now, tz),
    location: e.location,
  };
}

const CLASS_SUMMARY_INCLUDE = {
  scheduleEvents: { orderBy: [{ dayOfWeek: "asc" as const }, { startMinute: "asc" as const }] },
  assignments: { select: { status: true } },
  exams: { select: { examAt: true } },
};

function classSummary(
  c: {
    id: string;
    name: string;
    code: string;
    professor: string | null;
    room: string | null;
    currentGrade: string | null;
    scheduleEvents: Parameters<typeof meetingFor>[0][];
    assignments: { status: string }[];
    exams: { examAt: Date | null }[];
  },
  now: Date
) {
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    professor: c.professor,
    room: c.room,
    current_grade: c.currentGrade,
    meetings: c.scheduleEvents.map(meetingFor),
    open_assignments: c.assignments.filter((a) => !DONE.includes(a.status)).length,
    upcoming_exams: c.exams.filter((e) => e.examAt && e.examAt >= now).length,
  };
}

async function ownedClass(userId: string, classId: string) {
  return prisma.class.findFirst({ where: { id: classId, userId }, select: { id: true, name: true } });
}

const HANDLERS: { [K in ToolName]: (userId: string, input: import("zod").infer<(typeof TOOL_INPUTS)[K]>) => Promise<ToolResult> } = {
  async get_profile(userId) {
    const user = await loadUser(userId);
    const secret = process.env.AUTH_SECRET;
    if (!secret) return toolError("Profile identity unavailable.");
    const profile: Record<string, string> = { id: profileIdFor(user.id, secret), email: user.email };
    if (user.name?.trim()) profile.name = user.name.trim();
    profile.nickname = `Campus OS · ${user.email}`;
    return ok(profile);
  },

  async list_classes(userId, input) {
    const user = await loadUser(userId);
    const now = new Date();
    const classes = await prisma.class.findMany({
      where: { userId, ...(input.include_archived ? {} : { archived: false }) },
      include: CLASS_SUMMARY_INCLUDE,
      orderBy: { name: "asc" },
    });
    return ok({ timezone: user.timezone, classes: classes.map((c) => classSummary(c, now)) });
  },

  async get_upcoming_work(userId, input) {
    const user = await loadUser(userId);
    const tz = user.timezone;
    const now = new Date();
    const until = new Date(now.getTime() + (input.days_ahead ?? 14) * 86_400_000);
    if (input.class_id && !(await ownedClass(userId, input.class_id))) return notFound("class");
    const classWhere = { userId, archived: false, ...(input.class_id ? { id: input.class_id } : {}) };
    const includeOverdue = input.include_overdue ?? true;

    const assignments = await prisma.assignment.findMany({
      where: {
        class: classWhere,
        ...(input.include_done ? {} : { status: { notIn: DONE } }),
        dueAt: includeOverdue ? { lte: until } : { gte: now, lte: until },
      },
      include: { tasks: { select: { completed: true } }, class: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
      take: 200,
    });
    const exams = await prisma.exam.findMany({
      where: { class: classWhere, examAt: { gte: now, lte: until } },
      include: { class: { select: { name: true } } },
      orderBy: { examAt: "asc" },
      take: 100,
    });
    return ok({
      timezone: tz,
      assignments: assignments.map((a) => assignmentItem(a, a.class.name, now, tz)),
      exams: exams.map((e) => examItem(e, e.class.name, now, tz)),
    });
  },

  async get_class(userId, input) {
    const user = await loadUser(userId);
    const now = new Date();
    const c = await prisma.class.findFirst({
      where: { id: input.class_id, userId },
      include: {
        ...CLASS_SUMMARY_INCLUDE,
        noteSections: {
          orderBy: { order: "asc" },
          include: { notes: { orderBy: { order: "asc" }, select: { id: true, title: true, pinned: true, lectureId: true } } },
        },
        materials: { where: MATERIALS_WITH_TEXT, orderBy: { createdAt: "asc" }, select: { id: true, title: true, type: true } },
        resources: { select: { title: true, url: true } },
      },
    });
    if (!c) return notFound("class");
    const [assignments, exams] = await Promise.all([
      prisma.assignment.findMany({
        where: { classId: c.id },
        include: { tasks: { select: { completed: true } } },
        orderBy: { dueAt: "asc" },
        take: 300,
      }),
      prisma.exam.findMany({ where: { classId: c.id }, orderBy: { examAt: "asc" }, take: 100 }),
    ]);
    return ok({
      class: classSummary(c, now),
      assignments: assignments.map((a) => assignmentItem(a, c.name, now, user.timezone)),
      exams: exams.map((e) => examItem(e, c.name, now, user.timezone)),
      notes: c.noteSections.flatMap((s) =>
        s.notes.map((n) => ({ id: n.id, title: n.title, section: s.name, from_lecture: Boolean(n.lectureId), pinned: n.pinned }))
      ),
      course_files: c.materials.map((m) => ({ id: m.id, title: m.title, type: classMaterialTypeLabel(m.type) })),
      links: c.resources.map((r) => ({ title: r.title, url: r.url })),
    });
  },

  async get_notes(userId, input) {
    const c = await ownedClass(userId, input.class_id);
    if (!c) return notFound("class");
    const notes = await prisma.note.findMany({
      where: { section: { classId: c.id }, ...(input.note_ids ? { id: { in: input.note_ids } } : {}) },
      include: { section: { select: { name: true } } },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    });
    const items = notes.map((n) => ({
      id: n.id,
      title: n.title,
      section: n.section.name,
      from_lecture: Boolean(n.lectureId),
      text: n.bodyMarkdown.length > MAX_NOTE_CHARS ? `${n.bodyMarkdown.slice(0, MAX_NOTE_CHARS)}\n\n[cut for length]` : n.bodyMarkdown,
    }));
    const { kept, left } = takeWithinBudget(items, (n) => n.text.length + n.title.length, NOTES_BUDGET);
    return ok({ class_name: c.name, notes: kept, truncated: left.length > 0, omitted_note_ids: left.map((n) => n.id) });
  },

  async get_assignment(userId, input) {
    const user = await loadUser(userId);
    const a = await prisma.assignment.findFirst({
      where: { id: input.assignment_id, class: { userId } },
      include: { tasks: { orderBy: { order: "asc" } }, class: { select: { name: true } } },
    });
    if (!a) return notFound("assignment");
    const directions = a.description ? htmlToReadableText(a.description).slice(0, 20_000) : null;
    return ok({
      id: a.id,
      class_id: a.classId,
      class_name: a.class.name,
      name: a.name,
      directions: directions || null,
      due_at: a.dueAt?.toISOString() ?? null,
      due_label: formatDueLabel(a.dueAt, new Date(), user.timezone),
      status: assignmentStatusLabel(a.status),
      points_possible: a.pointsPossible,
      steps: a.tasks.map((t) => ({ title: t.title, done: t.completed, minutes: t.estimatedMinutes })),
    });
  },

  async get_course_material(userId, input) {
    const m = await prisma.classMaterial.findFirst({
      where: { id: input.material_id, class: { userId }, ...MATERIALS_WITH_TEXT },
      include: { class: { select: { name: true } } },
    });
    if (!m) return notFound("course file");
    return ok({ id: m.id, class_id: m.classId, class_name: m.class.name, title: m.title, type: classMaterialTypeLabel(m.type), text: m.content });
  },

  async search_class_content(userId, input) {
    const q = input.query;
    if (input.class_id && !(await ownedClass(userId, input.class_id))) return notFound("class");
    const classWhere = { userId, ...(input.class_id ? { id: input.class_id } : {}) };
    const like = { contains: q, mode: "insensitive" as const };
    const [notes, materials, assignments] = await Promise.all([
      prisma.note.findMany({
        where: { section: { class: classWhere }, OR: [{ title: like }, { bodyMarkdown: like }] },
        include: { section: { select: { class: { select: { id: true, name: true } } } } },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      prisma.classMaterial.findMany({
        where: { class: classWhere, AND: [MATERIALS_WITH_TEXT, { OR: [{ title: like }, { content: like }] }] },
        include: { class: { select: { id: true, name: true } } },
        take: 10,
      }),
      prisma.assignment.findMany({
        where: { class: classWhere, OR: [{ name: like }, { description: like }] },
        include: { class: { select: { id: true, name: true } } },
        orderBy: { dueAt: "desc" },
        take: 10,
      }),
    ]);
    const results = [
      ...notes.map((n) => ({
        kind: "note",
        id: n.id,
        class_id: n.section.class.id,
        class_name: n.section.class.name,
        title: n.title,
        snippet: snippetAround(n.bodyMarkdown || n.title, q),
      })),
      ...materials.map((m) => ({ kind: "course_file", id: m.id, class_id: m.class.id, class_name: m.class.name, title: m.title, snippet: snippetAround(m.content, q) })),
      ...assignments.map((a) => ({
        kind: "assignment",
        id: a.id,
        class_id: a.class.id,
        class_name: a.class.name,
        title: a.name,
        snippet: snippetAround(a.description ? htmlToReadableText(a.description) : a.name, q),
      })),
    ].slice(0, 20);
    return ok({ results });
  },
};

const TRIAL_ENDED =
  "The Campus OS free trial on this account has ended, so Campus OS can't share its classes and notes right now. The student can open Campus OS to see their options.";

/** Runs a tool for the account behind a verified access token. */
export async function runTool(userId: string, name: string, args: unknown): Promise<ToolResult> {
  if (!(name in TOOL_INPUTS)) return toolError(`Unknown tool: ${name}`);
  const tool = name as ToolName;
  const parsed = TOOL_INPUTS[tool].safeParse(args ?? {});
  if (!parsed.success) {
    return toolError(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
  }
  if (!(await consumeRateLimit(`mcp:${userId}`, RATE_LIMITS.mcp))) {
    return toolError("This Campus OS account has made too many requests today. Try again tomorrow.");
  }
  if (tool !== "get_profile" && paymentsEnabled() && (await getAccess(userId)).kind === "none") {
    return toolError(TRIAL_ENDED);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (HANDLERS[tool] as (u: string, i: any) => Promise<ToolResult>)(userId, parsed.data);
  } catch (err) {
    console.error(`MCP tool ${tool} failed:`, err);
    return toolError("Campus OS couldn't load that right now. Try again in a moment.");
  }
}

