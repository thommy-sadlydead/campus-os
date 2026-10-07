// Made-up classes for a demo account, so an App Store reviewer (who can't
// sign in to a school's LMS) can try everything: the dashboard, assignments,
// exams, the schedule, notes, lectures and the class assistant. Only
// accounts whose email is in DEMO_ACCOUNT_EMAILS can add them
// (src/app/dashboard/actions.ts).
//
// Dates are relative to when they're added, in the account's time zone, so
// "Reset sample classes" on the Account page brings them up to date again.
// Sample classes are the ones whose lmsCourseId starts with "sample:"; they
// have no LMS (lmsProvider is null), so nothing links out anywhere.
//
// The lectures are pasted-transcript lectures (no audio), with notes written
// the way the real pipeline writes them (src/lib/lecture-notes.ts): headings
// in the order topics came up, bullets, bold key terms, nothing that isn't in
// the transcript. Keep them that way, and keep the facts in them correct.

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { PrismaClient } from "@prisma/client";
import { heuristicEstimateMinutes } from "@/lib/priority-engine";
import { LECTURE_NOTES_SECTION_NAME } from "@/lib/lecture-notes-sync";
import { startOfTzDay } from "@/lib/time";

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
  status?: "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  steps?: { title: string; minutes: number; done?: boolean }[];
}

interface SampleClass {
  key: string;
  code: string;
  name: string;
  professor: string;
  room: string;
  grade: string;
  meetings: { days: number[]; start: string; end: string; label?: string }[];
  assignments: SampleAssignment[];
  exams: { name: string; day: number; time: string; location: string }[];
  syllabus: string;
  materials?: { type: "SLIDES" | "NOTES"; title: string; content: string }[];
  notes?: { title: string; body: string; pinned?: boolean }[];
  /** Given after the class's most recent lecture meeting. */
  lecture?: { title: string; transcript: string; notes: string };
}

const CLASSES: SampleClass[] = [
  {
    key: "bio",
    code: "BIO 1010",
    name: "Principles of Biology",
    professor: "Dr. Alvarez",
    room: "Science Center 210",
    grade: "A-",
    meetings: [
      { days: [1, 3, 5], start: "09:00", end: "09:50", label: "Lecture" },
      { days: [4], start: "13:00", end: "14:50", label: "Lab" },
    ],
    assignments: [
      { name: "Lab 2: Microscopy report", day: -6, points: 25, status: "GRADED" },
      { name: "Chapter 6 reading quiz", day: 1, time: "09:00", points: 10 },
      {
        name: "Lab 3: Enzyme activity report",
        day: 2,
        points: 25,
        status: "IN_PROGRESS",
        description:
          "Write up the catalase lab: a short introduction, your methods, a graph of reaction rate against temperature, and a discussion of what the curve shows about enzyme denaturation. Two to three pages.",
        steps: [
          { title: "Graph reaction rate against temperature", minutes: 30, done: true },
          { title: "Draft the methods and results", minutes: 40 },
          { title: "Write the discussion", minutes: 35 },
        ],
      },
      { name: "Lab 4: Photosynthesis pre-lab questions", day: 9, points: 10 },
    ],
    exams: [{ name: "Midterm Exam", day: 12, time: "09:00", location: "Science Center 210" }],
    syllabus:
      "Principles of Biology covers cell structure, metabolism, genetics and evolution. Grades: exams 50% (midterm 20%, final 30%), labs 30%, reading quizzes 10%, participation 10%. Late labs lose 10% per day. Office hours: Tuesdays 2-4 pm, Science Center 305.",
    materials: [
      {
        type: "SLIDES",
        title: "Chapter 6 slides: Energy and enzymes",
        content:
          "Chapter 6: Energy and enzymes\n\n1. Metabolism: catabolic pathways break molecules down; anabolic pathways build them up\n2. Enzymes are catalysts: they lower the activation energy of a reaction\n3. The active site, the substrate, and induced fit\n4. Temperature and pH optima; denaturation\n5. Competitive and noncompetitive inhibition\n6. Catalase: 2 H2O2 → 2 H2O + O2",
      },
    ],
    notes: [
      {
        title: "Midterm: what to review",
        pinned: true,
        body:
          "## Midterm topics\n\n- Cell structure and membranes\n- Energy and metabolism\n- **Enzymes**: active site, induced fit, inhibitors\n- Cellular respiration\n\nRedo the end-of-chapter questions for chapters 4 to 7.",
      },
    ],
    lecture: {
      title: "Enzymes and activation energy",
      transcript:
        "Okay, let's get started. Last time we talked about metabolism as a whole: catabolic pathways that break molecules down and anabolic pathways that build them up. Today is about what makes all of that happen fast enough to keep you alive, which is enzymes. An enzyme is a protein that acts as a catalyst. It speeds up a reaction without being used up by it. The way it does that is by lowering the activation energy, the energy a reaction needs to get started. It doesn't change how much energy the reaction releases overall. It just lowers the hill you have to get over.\n\nEach enzyme has an active site, a pocket that the substrate fits into. The fit isn't perfectly rigid, though. When the substrate binds, the enzyme shifts its shape a little to grip it more tightly. That's called induced fit.\n\nBecause the active site depends on the enzyme's shape, anything that changes the shape changes how well it works. Temperature is the big one. Up to a point, warmer means faster, because molecules collide more often. Past the optimum, the protein starts to unfold, and we say it's denatured. pH works the same way. Most of your enzymes work best around a pH of seven, but pepsin in your stomach works best around two.\n\nLast thing for today: inhibitors. A competitive inhibitor looks enough like the substrate to sit in the active site and block it. A noncompetitive inhibitor binds somewhere else on the enzyme and changes its shape.\n\nYour Lab 3 report is about exactly this. Catalase breaks hydrogen peroxide down into water and oxygen, and when you graph your reaction rates against temperature, the shape of that curve should make sense now.",
      notes:
        "## Metabolism recap\n\n- **Catabolic pathways** break molecules down; **anabolic pathways** build them up.\n- Enzymes make these reactions fast enough to keep us alive.\n\n## What enzymes do\n\n- An **enzyme** is a protein that acts as a **catalyst**: it speeds up a reaction without being used up.\n- It works by lowering the **activation energy**, the energy a reaction needs to get started.\n- It doesn't change how much energy the reaction releases overall.\n\n## Active site and induced fit\n\n- The **active site** is a pocket the **substrate** fits into.\n- **Induced fit**: when the substrate binds, the enzyme shifts shape slightly to grip it more tightly.\n\n## What affects enzyme activity\n\n- Anything that changes the enzyme's shape changes how well it works.\n- **Temperature**: warmer is faster up to the optimum, since molecules collide more often. Past it, the protein unfolds and is **denatured**.\n- **pH**: most of the body's enzymes work best around pH 7; **pepsin** in the stomach works best around pH 2.\n\n## Inhibitors\n\n- **Competitive inhibitor**: resembles the substrate and blocks the active site.\n- **Noncompetitive inhibitor**: binds elsewhere on the enzyme and changes its shape.\n\n## Connection to Lab 3\n\n- **Catalase** breaks hydrogen peroxide into water and oxygen.\n- Use the temperature section above to explain the shape of the rate-vs-temperature graph.",
    },
  },
  {
    key: "eng",
    code: "ENG 1400",
    name: "College Composition",
    professor: "Prof. Nguyen",
    room: "Humanities 118",
    grade: "B+",
    meetings: [{ days: [2, 4], start: "11:00", end: "12:15" }],
    assignments: [
      { name: "Reading response 4", day: -4, points: 10, status: "SUBMITTED" },
      {
        name: "Rhetorical analysis: rough draft",
        day: 3,
        points: 50,
        status: "IN_PROGRESS",
        description:
          "Choose an op-ed from the list on the course site and analyze how the author uses ethos, pathos and logos. 1,000-1,200 words, MLA format. Bring two printed copies to class for peer review.",
        steps: [
          { title: "Pick the op-ed", minutes: 15, done: true },
          { title: "Annotate ethos, pathos and logos", minutes: 30, done: true },
          { title: "Write the thesis and outline", minutes: 25 },
          { title: "Draft the body paragraphs", minutes: 60 },
          { title: "Add MLA citations", minutes: 15 },
        ],
      },
      { name: "Peer review responses", day: 5, points: 20 },
      { name: "Final Draft: Rhetorical analysis", day: 10, points: 100 },
    ],
    exams: [],
    syllabus:
      "College Composition develops academic writing through three major essays, weekly reading responses and peer review. Essays 60%, reading responses 20%, peer review 10%, participation 10%. Essays are due at 11:59 pm on the course site.",
    notes: [
      {
        title: "Rhetorical analysis: thesis ideas",
        pinned: true,
        body:
          "Op-ed: the one arguing for later school start times.\n\n- **Ethos**: the author is a pediatrician and says so in the first line.\n- **Pathos**: opens with a story about a student who fell asleep driving to school.\n- **Logos**: cites studies on how much sleep teenagers get.\n\nWorking thesis: the author leans on her credibility as a doctor more than on the research itself.",
      },
    ],
  },
  {
    key: "math",
    code: "MATH 1710",
    name: "Calculus I",
    professor: "Dr. Okafor",
    room: "Engineering 102",
    grade: "B",
    meetings: [{ days: [1, 3, 5], start: "10:00", end: "10:50" }],
    assignments: [
      { name: "Homework 3.1: Derivative rules", day: -2, points: 20, status: "SUBMITTED" },
      { name: "Homework 3.2: Product and quotient rules", day: 0, points: 20, status: "IN_PROGRESS" },
      { name: "Homework 3.3: Chain rule", day: 2, points: 20 },
      { name: "Quiz 4", day: 4, time: "10:00", points: 15 },
    ],
    exams: [{ name: "Exam 2", day: 8, time: "10:00", location: "Engineering 102" }],
    syllabus:
      "Calculus I: limits, derivatives and their applications, and an introduction to integrals. Three exams 60%, homework 20%, quizzes 20%. Homework is due at 11:59 pm; the lowest two homework scores are dropped.",
    materials: [
      {
        type: "NOTES",
        title: "Exam 2 review sheet",
        content:
          "Exam 2 covers sections 3.1 to 3.4.\n\n- Derivative rules: power, product, quotient\n- The chain rule, including compositions with three layers\n- Derivatives of sin x, cos x, e^x and ln x\n- Tangent lines: y − f(a) = f′(a)(x − a)\n\nNo calculators.",
      },
    ],
    notes: [
      {
        title: "Derivative rules",
        pinned: true,
        body:
          "## Rules\n\n- **Power rule**: d/dx [xⁿ] = n·xⁿ⁻¹\n- **Product rule**: (fg)′ = f′g + fg′\n- **Quotient rule**: (f/g)′ = (f′g − fg′) / g²\n- **Chain rule**: [f(g(x))]′ = f′(g(x)) · g′(x)\n\n## Derivatives to know\n\n- (sin x)′ = cos x\n- (cos x)′ = −sin x\n- (eˣ)′ = eˣ\n- (ln x)′ = 1/x",
      },
    ],
    lecture: {
      title: "The chain rule",
      transcript:
        "Alright, so far every derivative we've done has been one function at a time, or a sum, product or quotient of them. Today we handle compositions, a function inside another function, like the square root of x squared plus one. The rule for that is the chain rule. If y equals f of g of x, then the derivative is f prime of g of x, times g prime of x. The way I like to say it: derivative of the outside, leave the inside alone, times the derivative of the inside.\n\nLet's do the square root example. The outside is the square root, the inside is x squared plus one. The derivative of the outside is one over two times the square root, and we leave the inside alone, so one over two root x squared plus one. Times the derivative of the inside, which is two x. The twos cancel, and you get x over the square root of x squared plus one.\n\nSecond example: sine of three x. The outside is sine, the inside is three x. So cosine of three x, times three, which is three cosine three x.\n\nThe most common mistake I see on exams is forgetting that last factor, the derivative of the inside, so check for it every time. And you can chain more than two layers. Something like sine squared of five x has three layers, a square, a sine and a five x, and you just keep multiplying derivatives as you work your way in.\n\nHomework 3.3 is all chain rule, and it'll be on Exam 2.",
      notes:
        "## Compositions\n\n- The **chain rule** handles a **composition**: a function inside another function, like √(x² + 1).\n\n## The chain rule\n\n- If y = f(g(x)), then **dy/dx = f′(g(x)) · g′(x)**.\n- In words: derivative of the outside, leave the inside alone, times the derivative of the inside.\n\n## Example: √(x² + 1)\n\n- Outside: the square root. Inside: x² + 1.\n- Derivative of the outside: 1 / (2√(x² + 1)).\n- Times the derivative of the inside: 2x.\n- The 2s cancel: **x / √(x² + 1)**.\n\n## Example: sin(3x)\n\n- Outside: sine. Inside: 3x.\n- Result: **3 cos(3x)**.\n\n## Common mistake\n\n- Forgetting the last factor, the **derivative of the inside**. Check for it every time.\n\n## More than two layers\n\n- Keep multiplying derivatives as you work inward. sin²(5x) has three layers: a square, a sine and 5x.\n- Homework 3.3 is all chain rule, and it will be on **Exam 2**.",
    },
  },
  {
    key: "hist",
    code: "HIST 1110",
    name: "U.S. History to 1877",
    professor: "Dr. Brooks",
    room: "Humanities 204",
    grade: "A",
    meetings: [{ days: [2, 4], start: "13:30", end: "14:45" }],
    assignments: [
      { name: "Chapter 7 discussion post", day: 3, points: 10 },
      {
        name: "Primary source analysis",
        day: 6,
        points: 50,
        description:
          "Analyze one of the three primary sources from Unit 3. Who wrote it, for whom, and why? What does it show about the period, and what does it leave out? 3-4 pages.",
        steps: [
          { title: "Choose a source from Unit 3", minutes: 10, done: true },
          { title: "Read and annotate it", minutes: 40 },
          { title: "Outline the argument", minutes: 30 },
          { title: "Write the analysis", minutes: 90 },
          { title: "Proofread", minutes: 15 },
        ],
      },
    ],
    exams: [{ name: "Midterm Exam", day: 15, time: "13:30", location: "Humanities 204" }],
    syllabus:
      "A survey of American history from contact through Reconstruction. Midterm 25%, final 25%, primary source papers 30%, discussion posts 20%.",
    notes: [
      {
        title: "Primary source analysis: plan",
        body:
          "Source: **Federalist No. 10** (Madison).\n\n- Who wrote it, for whom, and why?\n- The argument: a large republic controls the danger of factions.\n- What it leaves out: who got to vote and be represented.",
      },
    ],
    lecture: {
      title: "From the Articles of Confederation to the Constitution",
      transcript:
        "Okay, today we're getting from the Articles of Confederation to the Constitution. The Articles were ratified in 1781, and they set up a deliberately weak central government. There was a Congress where each state had one vote, but there was no executive and no national courts, and Congress couldn't tax. It had to ask the states for money, and the states often just didn't pay. Changing the Articles required every state to agree, so fixing any of this was nearly impossible.\n\nThe event that convinced a lot of people the system was broken was Shays' Rebellion, in western Massachusetts in 1786 and 1787. Farmers buried in debt closed courts to stop foreclosures, and the national government had no army to respond.\n\nSo in May 1787, delegates met in Philadelphia, officially to revise the Articles, and instead they wrote a new constitution. The biggest fight was over representation. The Virginia Plan gave bigger states more representatives, the New Jersey Plan gave every state an equal vote, and the Great Compromise did both: the House by population and the Senate with two senators per state. The second compromise was over slavery. The Three-Fifths Compromise counted three-fifths of enslaved people toward a state's population for representation and taxes.\n\nThen came ratification. Federalists supported the Constitution, and Hamilton, Madison and Jay wrote the Federalist Papers to argue for it. Anti-Federalists worried it gave the national government too much power and had no bill of rights. That worry is a big reason the first ten amendments, the Bill of Rights, were added in 1791.\n\nFor your primary source analysis, ask whose voices made it into these debates, and whose didn't.",
      notes:
        "## The Articles of Confederation (1781)\n\n- Set up a deliberately weak central government.\n- **Congress** gave each state one vote; there was no executive and no national courts.\n- Congress **couldn't tax**. It asked the states for money, and they often didn't pay.\n- Changing the Articles required **every state to agree**.\n\n## Shays' Rebellion (1786–1787)\n\n- Debt-burdened farmers in western Massachusetts closed courts to stop foreclosures.\n- The national government had no army to respond, which convinced many the system was broken.\n\n## The Constitutional Convention (May 1787)\n\n- Delegates met in Philadelphia, officially to revise the Articles, and wrote a new constitution instead.\n- **Virginia Plan**: bigger states get more representatives. **New Jersey Plan**: an equal vote for every state.\n- **Great Compromise**: the House by population, the Senate with two senators per state.\n- **Three-Fifths Compromise**: three-fifths of enslaved people counted toward a state's population for representation and taxes.\n\n## Ratification\n\n- **Federalists** supported the Constitution; Hamilton, Madison and Jay wrote the **Federalist Papers**.\n- **Anti-Federalists** feared too much national power and objected to the missing bill of rights.\n- That worry is a big reason the **Bill of Rights**, the first ten amendments, was added in 1791.\n\n## For the primary source analysis\n\n- Ask whose voices made it into these debates, and whose didn't.",
    },
  },
  {
    key: "psyc",
    code: "PSYC 1600",
    name: "General Psychology",
    professor: "Dr. Patel",
    room: "Social Sciences 140",
    grade: "A-",
    meetings: [{ days: [1, 3], start: "14:00", end: "15:15" }],
    assignments: [
      { name: "Chapter 7 quiz: Memory", day: 3, points: 10 },
      { name: "Research participation (2 credits)", day: 20, points: 20 },
    ],
    exams: [{ name: "Exam 2", day: 13, time: "14:00", location: "Social Sciences 140" }],
    syllabus:
      "An introduction to psychology: research methods, the brain, learning, memory, development and social behavior. Exams 60%, chapter quizzes 25%, research participation 15%.",
    lecture: {
      title: "How memory works",
      transcript:
        "So today we're on memory, and the model we'll use is the one in your textbook, the Atkinson-Shiffrin model, which breaks memory into three stores. First, sensory memory, which holds everything you see and hear for a brief moment. Most of it disappears unless you pay attention to it. What you pay attention to moves into short-term memory, which is small and brief. George Miller famously put its capacity at about seven items, plus or minus two, and without rehearsal it fades in roughly twenty to thirty seconds. Then there's long-term memory, which, as far as we can tell, is basically unlimited.\n\nThe processes connecting all of this are encoding, getting information in, storage, keeping it, and retrieval, getting it back out.\n\nOne effect you'll see on the exam is the serial position effect. If I read you a list of words, you'll remember the first few, that's the primacy effect, and the last few, that's the recency effect, better than the ones in the middle.\n\nAnd here's the one that matters most for you as students: the spacing effect. Studying in shorter sessions spread over several days beats cramming the same amount of time into one night. So start reviewing for the exam now, a little at a time.",
      notes:
        "## The Atkinson-Shiffrin model\n\n- Memory is split into three stores: sensory, short-term and long-term.\n\n## Sensory memory\n\n- Holds everything you see and hear for a brief moment.\n- Most of it fades unless you **pay attention** to it.\n\n## Short-term memory\n\n- What you attend to moves into **short-term memory**, which is small and brief.\n- **George Miller**: a capacity of about **7 ± 2 items**.\n- Without **rehearsal**, it fades in roughly 20 to 30 seconds.\n\n## Long-term memory\n\n- As far as we can tell, its capacity is basically unlimited.\n\n## Three processes\n\n- **Encoding**: getting information in.\n- **Storage**: keeping it.\n- **Retrieval**: getting it back out.\n\n## Serial position effect\n\n- In a list, the first items (**primacy effect**) and the last items (**recency effect**) are remembered better than the middle ones.\n\n## The spacing effect\n\n- Shorter study sessions spread over several days beat cramming the same total time into one night.\n- Start reviewing for the exam now, a little at a time.",
    },
  },
];

/** Free time logged for today and the next six days, so the dashboard can weigh work against it. */
const FREE_TIME = [
  { start: "15:30", end: "17:00", label: "Library" },
  { start: "19:30", end: "21:00", label: "Evening study" },
];
const FREE_TIME_LABELS = FREE_TIME.map((f) => f.label);
const FREE_TIME_DAYS = 7;

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A local time on a day relative to today, in the account's time zone. */
function at(now: Date, tz: string, day: number, hhmm = "23:59"): Date {
  const date = formatInTimeZone(new Date(now.getTime() + day * DAY_MS), tz, "yyyy-MM-dd");
  return fromZonedTime(`${date}T${hhmm}:00`, tz);
}

/** When the class's most recent meeting before `now` ended (the first meeting listed). */
function lastMeetingEnd(now: Date, tz: string, meeting: SampleClass["meetings"][number]): Date {
  for (let day = 0; day >= -7; day--) {
    const weekday = Number(formatInTimeZone(new Date(now.getTime() + day * DAY_MS), tz, "i")) % 7; // 0 = Sunday
    const end = at(now, tz, day, meeting.end);
    if (meeting.days.includes(weekday) && end <= now) return end;
  }
  return at(now, tz, -7, meeting.end);
}

/** Removes the account's sample classes, everything in them, and the sample free time. */
export async function removeSampleClasses(prisma: PrismaClient, userId: string): Promise<number> {
  await prisma.availabilityBlock.deleteMany({ where: { userId, label: { in: FREE_TIME_LABELS } } });
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
        currentGrade: sample.grade,
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
        materials: {
          create: [{ type: "SYLLABUS", title: "Syllabus", content: sample.syllabus }, ...(sample.materials ?? [])],
        },
        noteSections: {
          create: [
            {
              name: "General",
              order: 0,
              notes: {
                create: (sample.notes ?? []).map((n, order) => ({
                  title: n.title,
                  bodyMarkdown: n.body,
                  pinned: n.pinned ?? false,
                  order,
                })),
              },
            },
          ],
        },
      },
    });

    if (sample.lecture) {
      // The lecture's notes also live in the Notes tab, as the real pipeline
      // puts them (src/lib/lecture-notes-sync.ts).
      const givenAt = lastMeetingEnd(now, tz, sample.meetings[0]);
      const lecture = await prisma.lecture.create({
        data: {
          classId: cls.id,
          title: sample.lecture.title,
          status: "READY",
          transcriptText: sample.lecture.transcript,
          notesMarkdown: sample.lecture.notes,
          noteSyncedAt: givenAt,
          createdAt: givenAt,
        },
      });
      await prisma.noteSection.create({
        data: {
          classId: cls.id,
          name: LECTURE_NOTES_SECTION_NAME,
          order: -1,
          notes: {
            create: [
              {
                title: sample.lecture.title,
                bodyMarkdown: sample.lecture.notes,
                lectureId: lecture.id,
                createdAt: givenAt,
              },
            ],
          },
        },
      });
    }

    for (const a of sample.assignments) {
      const steps = a.steps ?? [];
      await prisma.assignment.create({
        data: {
          classId: cls.id,
          name: a.name,
          description: a.description ?? null,
          dueAt: at(now, tz, a.day, a.time),
          pointsPossible: a.points ?? null,
          status: a.status ?? "NOT_STARTED",
          estimatedMinutes:
            steps.length > 0
              ? steps.reduce((sum, s) => sum + s.minutes, 0)
              : heuristicEstimateMinutes({ name: a.name, pointsPossible: a.points ?? null, description: a.description }),
          tasks: {
            create: steps.map((s, order) => ({
              title: s.title,
              estimatedMinutes: s.minutes,
              order,
              completed: s.done ?? false,
              completedAt: s.done ? now : null,
            })),
          },
        },
      });
    }
  }

  await prisma.availabilityBlock.createMany({
    data: Array.from({ length: FREE_TIME_DAYS }, (_, day) =>
      FREE_TIME.map((f) => ({
        userId,
        date: startOfTzDay(new Date(now.getTime() + day * DAY_MS), tz),
        startMinute: minutes(f.start),
        endMinute: minutes(f.end),
        label: f.label,
      }))
    ).flat(),
  });
}
