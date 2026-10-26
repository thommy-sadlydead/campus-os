import { z } from "zod";
import { OAUTH_SCOPE } from "@/lib/oauth/oauth";

// The tools ChatGPT can call on the MCP endpoint (src/app/mcp): what each
// one is for, its input, and the exact shape of what it returns. All of them
// only read the signed-in student's own data. The handlers are in
// tools-server.ts; scripts/check-mcp.mjs runs every one against a local
// server and checks its output against these output schemas. Keep the consent page's list
// (src/app/oauth/authorize/page.tsx) and the privacy policy in step.

type Json = Record<string, unknown>;
const str = (description?: string): Json => ({ type: "string", ...(description ? { description } : {}) });
const nullableStr = (description?: string): Json => ({ type: ["string", "null"], ...(description ? { description } : {}) });
const int = (description?: string): Json => ({ type: "integer", ...(description ? { description } : {}) });
const nullableNum = (description?: string): Json => ({ type: ["number", "null"], ...(description ? { description } : {}) });
const bool = (description?: string): Json => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items: Json, description?: string): Json => ({ type: "array", items, ...(description ? { description } : {}) });
const obj = (properties: Record<string, Json>, required: string[] = Object.keys(properties)): Json => ({
  type: "object",
  properties,
  required,
});

const SECURITY = [{ type: "oauth2", scopes: [OAUTH_SCOPE] }];
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };

const meeting = obj({
  day: str("Day of the week, like Monday"),
  start: str("Start time, like 9:00 AM"),
  end: str("End time, like 9:50 AM"),
  location: nullableStr(),
  label: nullableStr("Lecture, Lab, Discussion..."),
});

const classSummary = obj({
  id: str("Use this class_id with the other tools"),
  name: str(),
  code: str("Course code, like ECON-2330-03"),
  professor: nullableStr(),
  room: nullableStr(),
  current_grade: nullableStr("As the school's LMS last reported it"),
  meetings: arr(meeting),
  open_assignments: int("Assignments not yet turned in"),
  upcoming_exams: int(),
});

const assignmentItem = obj({
  id: str("Use with get_assignment for the directions"),
  class_id: str(),
  class_name: str(),
  name: str(),
  due_at: nullableStr("ISO 8601"),
  due_label: str("When it's due, in the student's time zone"),
  status: str("Not started, In progress, Submitted or Graded"),
  points_possible: nullableNum(),
  steps_left: { type: ["integer", "null"], description: "Steps not yet done, when the assignment was broken into steps" },
});

const examItem = obj({
  id: str(),
  class_id: str(),
  class_name: str(),
  name: str(),
  exam_at: nullableStr("ISO 8601"),
  when_label: str("When it is, in the student's time zone"),
  location: nullableStr(),
});

export const PROFILE_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    id: {
      type: "string",
      minLength: 1,
      pattern: "\\S",
      description:
        "Opaque profile identifier, unique within this app and unchanged across token refresh, reconnection, and display-metadata changes. Never reassigned to another profile.",
    },
    name: { type: "string", description: "Display name for the authenticated profile." },
    email: { type: "string", description: "Email address for display; not used as the profile identity." },
    nickname: { type: "string", description: "A useful label that helps users distinguish connected profiles." },
  },
  required: ["id"],
  additionalProperties: false,
};

const classIdInput = { type: "string", description: "A class id from list_classes", minLength: 1, maxLength: 64 };

export const TOOL_INPUTS = {
  get_profile: z.object({}).strict(),
  list_classes: z.object({ include_archived: z.boolean().optional() }).strict(),
  get_upcoming_work: z
    .object({
      days_ahead: z.number().int().min(1).max(120).optional(),
      class_id: z.string().min(1).max(64).optional(),
      include_overdue: z.boolean().optional(),
      include_done: z.boolean().optional(),
    })
    .strict(),
  get_class: z.object({ class_id: z.string().min(1).max(64) }).strict(),
  get_notes: z
    .object({
      class_id: z.string().min(1).max(64),
      note_ids: z.array(z.string().min(1).max(64)).max(20).optional(),
    })
    .strict(),
  get_assignment: z.object({ assignment_id: z.string().min(1).max(64) }).strict(),
  get_course_material: z.object({ material_id: z.string().min(1).max(64) }).strict(),
  search_class_content: z
    .object({
      query: z.string().trim().min(2).max(100),
      class_id: z.string().min(1).max(64).optional(),
    })
    .strict(),
} satisfies Record<string, z.ZodTypeAny>;

export type ToolName = keyof typeof TOOL_INPUTS;

export interface ToolDescriptor {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: Json;
  outputSchema: Json;
  annotations: typeof READ_ONLY;
  securitySchemes: typeof SECURITY;
  _meta: Json;
}

function tool(
  name: ToolName,
  title: string,
  description: string,
  inputSchema: Json,
  outputSchema: Json,
  extraMeta: Json = {}
): ToolDescriptor {
  return {
    name,
    title,
    description,
    inputSchema: { ...inputSchema, additionalProperties: false },
    outputSchema,
    annotations: READ_ONLY,
    securitySchemes: SECURITY,
    _meta: {
      securitySchemes: SECURITY,
      "openai/toolInvocation/invoking": "Checking Campus OS…",
      "openai/toolInvocation/invoked": "Checked Campus OS",
      ...extraMeta,
    },
  };
}

/** In a fixed order (MCP asks for a deterministic tools/list). */
export const TOOLS: ToolDescriptor[] = [
  tool(
    "get_profile",
    "Get the connected Campus OS account",
    "Returns the Campus OS account this connection is signed in to. Use it only to tell connected accounts apart.",
    obj({}, []),
    PROFILE_OUTPUT_SCHEMA,
    { "openai/profile": true }
  ),
  tool(
    "list_classes",
    "List classes",
    "Use this first to see the student's classes (with their class_id, meeting times, professor and current grade). Other tools take a class_id from here.",
    obj({ include_archived: bool("Also list archived classes (default false)") }, []),
    obj({ timezone: str("The student's time zone"), classes: arr(classSummary) })
  ),
  tool(
    "get_upcoming_work",
    "Get upcoming assignments and exams",
    "Use when the student asks what's due, what to work on, or when an exam is. Returns assignments and exams in the next days_ahead days (default 14), plus overdue work, across all classes or one class.",
    obj(
      {
        days_ahead: { type: "integer", minimum: 1, maximum: 120, description: "How many days ahead to look (default 14)" },
        class_id: { ...classIdInput, description: "Only this class (optional)" },
        include_overdue: bool("Include work that's past due and not turned in (default true)"),
        include_done: bool("Include work already turned in or graded (default false)"),
      },
      []
    ),
    obj({ timezone: str(), assignments: arr(assignmentItem), exams: arr(examItem) })
  ),
  tool(
    "get_class",
    "Get a class overview",
    "Use to see everything in one class: its schedule, all assignments and exams, and the titles of its notes, lectures and course files (with ids to fetch them). Doesn't include note or file text; use get_notes and get_course_material for that.",
    obj({ class_id: classIdInput }),
    obj({
      class: classSummary,
      assignments: arr(assignmentItem),
      exams: arr(examItem),
      notes: arr(obj({ id: str(), title: str(), section: str(), from_lecture: bool(), pinned: bool() })),
      course_files: arr(obj({ id: str("Use with get_course_material"), title: str(), type: str() })),
      links: arr(obj({ title: str(), url: nullableStr() })),
    })
  ),
  tool(
    "get_notes",
    "Read class notes",
    "Use to read the student's notes for a class, including notes made from lecture recordings: for summaries, study guides, flashcards or quizzes based on what they actually covered. Pinned and recent notes come first. Long classes are cut to a size limit; ask for specific note_ids (from get_class) to read the rest.",
    obj(
      {
        class_id: classIdInput,
        note_ids: { type: "array", items: { type: "string" }, maxItems: 20, description: "Only these notes (from get_class)" },
      },
      ["class_id"]
    ),
    obj({
      class_name: str(),
      notes: arr(obj({ id: str(), title: str(), section: str(), from_lecture: bool(), text: str("Markdown") })),
      truncated: bool("True when more notes exist than fit; their ids are in omitted_note_ids"),
      omitted_note_ids: arr(str()),
    })
  ),
  tool(
    "get_assignment",
    "Get an assignment's details",
    "Use when the student wants help with a specific assignment: returns its directions (as the school's LMS gave them), due date, status and any steps it was broken into.",
    obj({ assignment_id: { type: "string", minLength: 1, maxLength: 64, description: "An assignment id from get_upcoming_work or get_class" } }),
    obj({
      id: str(),
      class_id: str(),
      class_name: str(),
      name: str(),
      directions: nullableStr("The assignment's description from the LMS, as text"),
      due_at: nullableStr("ISO 8601"),
      due_label: str(),
      status: str(),
      points_possible: nullableNum(),
      steps: arr(obj({ title: str(), done: bool(), minutes: { type: ["integer", "null"] } })),
    })
  ),
  tool(
    "get_course_material",
    "Read a course file",
    "Use to read the text of one course file (slides, readings, a syllabus, a textbook excerpt) by its id from get_class. Long files are stored cut to their first part.",
    obj({ material_id: { type: "string", minLength: 1, maxLength: 64, description: "A course file id from get_class" } }),
    obj({ id: str(), class_id: str(), class_name: str(), title: str(), type: str(), text: str() })
  ),
  tool(
    "search_class_content",
    "Search notes, course files and assignments",
    "Use to find where a topic or term appears in the student's notes, course files and assignment directions, across all classes or one class. Returns short snippets with ids to read the full item.",
    obj(
      {
        query: { type: "string", minLength: 2, maxLength: 100, description: "Words to look for" },
        class_id: { ...classIdInput, description: "Only this class (optional)" },
      },
      ["query"]
    ),
    obj({
      results: arr(
        obj({
          kind: { type: "string", enum: ["note", "course_file", "assignment"] },
          id: str("Read it with get_notes (note_ids), get_course_material or get_assignment"),
          class_id: str(),
          class_name: str(),
          title: str(),
          snippet: str(),
        })
      ),
    })
  ),
];

export const SERVER_INSTRUCTIONS =
  "Campus OS is the student's own school planner: their classes, assignments, exams, notes, lecture notes and course files. Everything here is read-only. Start with list_classes for class ids, or get_upcoming_work for what's due. Times come with labels already in the student's time zone. For study guides, summaries or quizzes, read the class's notes (get_notes) and course files (get_course_material) and stick to what they cover. Don't show ids to the student.";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 540 → "9:00 AM" (minutes after midnight, as ScheduleEvent stores them). */
export function minuteLabel(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

export function meetingFor(e: { dayOfWeek: number; startMinute: number; endMinute: number; location: string | null; label: string | null }) {
  return {
    day: DAY_NAMES[e.dayOfWeek] ?? "Unknown",
    start: minuteLabel(e.startMinute),
    end: minuteLabel(e.endMinute),
    location: e.location,
    label: e.label,
  };
}

/** A short excerpt of `text` around the first match of `query` (case-insensitive). */
export function snippetAround(text: string, query: string, radius = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? "…" : "");
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + query.length + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** Takes items in order while they fit in `budget` characters; the rest are left out. */
export function takeWithinBudget<T>(items: T[], size: (item: T) => number, budget: number): { kept: T[]; left: T[] } {
  const kept: T[] = [];
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    const s = size(items[i]);
    if (kept.length > 0 && used + s > budget) return { kept, left: items.slice(i) };
    kept.push(items[i]);
    used += s;
  }
  return { kept, left: [] };
}
