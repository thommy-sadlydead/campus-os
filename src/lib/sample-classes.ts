// Made-up classes for a demo account, so an App Store reviewer (who can't
// sign in to a school's LMS) can try everything: the dashboard, assignments,
// exams, the schedule, notes and the class assistant. Only accounts whose
// email is in DEMO_ACCOUNT_EMAILS can add them (src/app/dashboard/actions.ts).
//
// Dates are relative to when they're added, in the account's time zone, so
// "Reset sample classes" on the Account page brings them up to date again.
// Sample classes are the ones whose lmsCourseId starts with "sample:"; they
// have no LMS (lmsProvider is null), so nothing links out anywhere.

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { PrismaClient } from "@prisma/client";
import { heuristicEstimateMinutes } from "@/lib/priority-engine";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SAMPLE_COURSE_PREFIX = "sample:";

/** DEMO_ACCOUNT_EMAILS: comma-separated, any case. */
export function isDemoAccount(email: string, configured = process.env.DEMO_ACCOUNT_EMAILS): boolean {
  const emails = (configured ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return emails.includes(email.trim().toLowerCase());
}

interface SampleAssignment {
  name: string;
  /** Days from today; negative is in the past. */
  day: number;
  time?: string; // "HH:mm", default 23:59
  points?: number;
  description?: string;
  done?: boolean;
  steps?: { title: string; minutes: number }[];
}

interface SampleClass {
  key: string;
  code: string;
  name: string;
  professor: string;
  room: string;
  meetings: { days: number[]; start: string; end: string; label?: string }[];
  assignments: SampleAssignment[];
  exams: { name: string; day: number; time: string; location: string }[];
  syllabus: string;
  note?: { title: string; body: string };
}

const CLASSES: SampleClass[] = [
  {
    key: "bio",
    code: "BIO 1010",
    name: "Principles of Biology",
    professor: "Dr. Alvarez",
    room: "Science Center 210",
    meetings: [
      { days: [1, 3, 5], start: "09:00", end: "09:50", label: "Lecture" },
      { days: [4], start: "13:00", end: "14:50", label: "Lab" },
    ],
    assignments: [
      { name: "Lab 2: Microscopy report", day: -6, points: 25, done: true },
      { name: "Chapter 6 reading quiz", day: 1, time: "09:00", points: 10 },
      {
        name: "Lab 3: Enzyme activity report",
        day: 2,
        points: 25,
        description:
          "Write up the catalase lab: a short introduction, your methods, a graph of reaction rate against temperature, and a discussion of what the curve shows about enzyme denaturation. Two to three pages.",
        steps: [
          { title: "Graph reaction rate against temperature", minutes: 30 },
          { title: "Draft the methods and results", minutes: 40 },
          { title: "Write the discussion", minutes: 35 },
        ],
      },
      { name: "Lab 4: Photosynthesis pre-lab questions", day: 9, points: 10 },
    ],
    exams: [{ name: "Midterm Exam", day: 12, time: "09:00", location: "Science Center 210" }],
    syllabus:
      "Principles of Biology covers cell structure, metabolism, genetics and evolution. Grades: exams 50% (midterm 20%, final 30%), labs 30%, reading quizzes 10%, participation 10%. Late labs lose 10% per day. Office hours: Tuesdays 2-4 pm, Science Center 305.",
    note: {
      title: "Enzymes",
      body:
        "## Enzymes\n\n- Proteins that speed up reactions by lowering activation energy\n- Each has an **active site** that fits its substrate\n- Temperature and pH change the shape: too hot and they *denature*\n\nCatalase breaks hydrogen peroxide into water and oxygen.",
    },
  },
  {
    key: "eng",
    code: "ENG 1400",
    name: "College Composition",
    professor: "Prof. Nguyen",
    room: "Humanities 118",
    meetings: [{ days: [2, 4], start: "11:00", end: "12:15" }],
    assignments: [
      { name: "Reading response 4", day: -4, points: 10, done: true },
      {
        name: "Rhetorical analysis: rough draft",
        day: 3,
        points: 50,
        description:
          "Choose an op-ed from the list on the course site and analyze how the author uses ethos, pathos and logos. 1,000-1,200 words, MLA format. Bring two printed copies to class for peer review.",
      },
      { name: "Peer review responses", day: 5, points: 20 },
      { name: "Final Draft: Rhetorical analysis", day: 10, points: 100 },
    ],
    exams: [],
    syllabus:
      "College Composition develops academic writing through three major essays, weekly reading responses and peer review. Essays 60%, reading responses 20%, peer review 10%, participation 10%. Essays are due at 11:59 pm on the course site.",
  },
  {
    key: "math",
    code: "MATH 1710",
    name: "Calculus I",
    professor: "Dr. Okafor",
    room: "Engineering 102",
    meetings: [{ days: [1, 3, 5], start: "10:00", end: "10:50" }],
    assignments: [
      { name: "Homework 3.1: Derivative rules", day: -2, points: 20, done: true },
      { name: "Homework 3.2: Product and quotient rules", day: 0, points: 20 },
      { name: "Homework 3.3: Chain rule", day: 2, points: 20 },
      { name: "Quiz 4", day: 4, time: "10:00", points: 15 },
    ],
    exams: [{ name: "Exam 2", day: 8, time: "10:00", location: "Engineering 102" }],
    syllabus:
      "Calculus I: limits, derivatives and their applications, and an introduction to integrals. Three exams 60%, homework 20%, quizzes 20%. Homework is due at 11:59 pm; the lowest two homework scores are dropped.",
  },
  {
    key: "hist",
    code: "HIST 1110",
    name: "U.S. History to 1877",
    professor: "Dr. Brooks",
    room: "Humanities 204",
    meetings: [{ days: [2, 4], start: "13:30", end: "14:45" }],
    assignments: [
      { name: "Chapter 7 discussion post", day: 1, points: 10 },
      {
        name: "Primary source analysis",
        day: 6,
        points: 50,
        description:
          "Analyze one of the three primary sources from Unit 3. Who wrote it, for whom, and why? What does it show about the period, and what does it leave out? 3-4 pages.",
      },
    ],
    exams: [{ name: "Midterm Exam", day: 15, time: "13:30", location: "Humanities 204" }],
    syllabus:
      "A survey of American history from contact through Reconstruction. Midterm 25%, final 25%, primary source papers 30%, discussion posts 20%.",
  },
  {
    key: "psyc",
    code: "PSYC 1600",
    name: "General Psychology",
    professor: "Dr. Patel",
    room: "Social Sciences 140",
    meetings: [{ days: [1, 3], start: "14:00", end: "15:15" }],
    assignments: [
      { name: "Chapter 5 quiz", day: 3, points: 10 },
      { name: "Research participation (2 credits)", day: 20, points: 20 },
    ],
    exams: [],
    syllabus:
      "An introduction to psychology: research methods, the brain, learning, memory, development and social behavior. Exams 60%, chapter quizzes 25%, research participation 15%.",
  },
];

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A local time on a day relative to today, in the account's time zone. */
function at(now: Date, tz: string, day: number, hhmm = "23:59"): Date {
  const date = formatInTimeZone(new Date(now.getTime() + day * DAY_MS), tz, "yyyy-MM-dd");
  return fromZonedTime(`${date}T${hhmm}:00`, tz);
}

/** Removes the account's sample classes and everything in them. */
export async function removeSampleClasses(prisma: PrismaClient, userId: string): Promise<number> {
  const { count } = await prisma.class.deleteMany({ where: { userId, lmsCourseId: { startsWith: SAMPLE_COURSE_PREFIX } } });
  return count;
}

/** Replaces the account's sample classes with fresh ones dated from `now`. */
export async function addSampleClasses(prisma: PrismaClient, userId: string, tz: string, now: Date = new Date()): Promise<void> {
  await removeSampleClasses(prisma, userId);
  for (const [i, sample] of CLASSES.entries()) {
    const cls = await prisma.class.create({
      data: {
        userId,
        lmsCourseId: `${SAMPLE_COURSE_PREFIX}${sample.key}`,
        code: sample.code,
        name: sample.name,
        professor: sample.professor,
        room: sample.room,
        color: (i % 8) + 1,
        scheduleEvents: {
          create: sample.meetings.flatMap((m) =>
            m.days.map((dayOfWeek) => ({
              dayOfWeek,
              startMinute: minutes(m.start),
              endMinute: minutes(m.end),
              location: sample.room,
              label: m.label ?? null,
            }))
          ),
        },
        exams: {
          create: sample.exams.map((e) => ({ name: e.name, examAt: at(now, tz, e.day, e.time), location: e.location })),
        },
        materials: { create: [{ type: "SYLLABUS", title: "Syllabus", content: sample.syllabus }] },
        noteSections: {
          create: [
            {
              name: "General",
              order: 0,
              notes: sample.note ? { create: [{ title: sample.note.title, bodyMarkdown: sample.note.body }] } : undefined,
            },
          ],
        },
      },
    });

    for (const a of sample.assignments) {
      const steps = a.steps ?? [];
      await prisma.assignment.create({
        data: {
          classId: cls.id,
          name: a.name,
          description: a.description ?? null,
          dueAt: at(now, tz, a.day, a.time),
          pointsPossible: a.points ?? null,
          status: a.done ? "SUBMITTED" : "NOT_STARTED",
          estimatedMinutes:
            steps.length > 0
              ? steps.reduce((sum, s) => sum + s.minutes, 0)
              : heuristicEstimateMinutes({ name: a.name, pointsPossible: a.points ?? null, description: a.description }),
          tasks: { create: steps.map((s, order) => ({ title: s.title, estimatedMinutes: s.minutes, order })) },
        },
      });
    }
  }
}
