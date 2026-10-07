import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addSampleClasses, isDemoAccount, SAMPLE_COURSE_PREFIX } from "../src/lib/sample-classes";

describe("isDemoAccount", () => {
  it("matches the configured emails, any case, and nothing else", () => {
    const configured = " Review@Example.com, other@example.com ";
    expect(isDemoAccount("review@example.com", configured)).toBe(true);
    expect(isDemoAccount("OTHER@example.com", configured)).toBe(true);
    expect(isDemoAccount("student@school.edu", configured)).toBe(false);
    expect(isDemoAccount("review@example.com", undefined)).toBe(false);
    expect(isDemoAccount("review@example.com", "")).toBe(false);
  });
});

describe("addSampleClasses", () => {
  type Row = Record<string, unknown>;

  function recordingPrisma() {
    const calls = {
      deleted: [] as unknown[],
      freeTimeDeleted: [] as unknown[],
      classes: [] as Row[],
      assignments: [] as Row[],
      lectures: [] as Row[],
      sections: [] as Row[],
      freeTime: [] as Row[],
    };
    let id = 0;
    const create =
      (into: Row[], prefix: string) =>
      async ({ data }: { data: Row }) => {
        into.push(data);
        return { id: `${prefix}${++id}`, ...data };
      };
    const prisma = {
      class: {
        deleteMany: async (args: unknown) => {
          calls.deleted.push(args);
          return { count: 0 };
        },
        create: create(calls.classes, "c"),
      },
      assignment: { create: create(calls.assignments, "a") },
      lecture: { create: create(calls.lectures, "l") },
      noteSection: { create: create(calls.sections, "s") },
      availabilityBlock: {
        deleteMany: async (args: unknown) => {
          calls.freeTimeDeleted.push(args);
          return { count: 0 };
        },
        createMany: async ({ data }: { data: Row[] }) => {
          calls.freeTime.push(...data);
          return { count: data.length };
        },
      },
    };
    return { prisma: prisma as unknown as PrismaClient, calls };
  }

  // Tuesday, October 6, 2026, 10:00 am in Chicago.
  const now = new Date("2026-10-06T15:00:00Z");

  it("replaces only this account's sample classes, dated from today in the account's time zone", async () => {
    const { prisma, calls } = recordingPrisma();

    await addSampleClasses(prisma, "u1", "America/Chicago", now);

    expect(calls.deleted).toEqual([{ where: { userId: "u1", lmsCourseId: { startsWith: SAMPLE_COURSE_PREFIX } } }]);
    expect(calls.classes.length).toBeGreaterThanOrEqual(4);
    for (const cls of calls.classes) {
      expect(cls.userId).toBe("u1");
      expect(String(cls.lmsCourseId)).toMatch(/^sample:/);
      expect(cls.lmsProvider).toBeUndefined();
    }
    // "Due in 2 days" is 11:59 pm two days on, in Chicago.
    const lab = calls.assignments.find((a) => a.name === "Lab 3: Enzyme activity report");
    expect((lab?.dueAt as Date).toISOString()).toBe("2026-10-09T04:59:00.000Z");
    // Some work is already done, some is under way, and some hasn't started.
    for (const status of ["GRADED", "SUBMITTED", "IN_PROGRESS", "NOT_STARTED"]) {
      expect(calls.assignments.some((a) => a.status === status)).toBe(true);
    }
  });

  it("gives each lecture after the class's last meeting, with its notes in the Notes tab", async () => {
    const { prisma, calls } = recordingPrisma();

    await addSampleClasses(prisma, "u1", "America/Chicago", now);

    expect(calls.lectures.length).toBeGreaterThanOrEqual(3);
    const givenAt = Object.fromEntries(calls.lectures.map((l) => [l.title, (l.createdAt as Date).toISOString()]));
    // Biology meets Monday, Wednesday and Friday at 9:00-9:50: Monday's lecture.
    expect(givenAt["Enzymes and activation energy"]).toBe("2026-10-05T14:50:00.000Z");
    // History meets Tuesday and Thursday at 1:30-2:45; today's hasn't happened yet, so last Thursday's.
    expect(givenAt["From the Articles of Confederation to the Constitution"]).toBe("2026-10-01T19:45:00.000Z");

    for (const lecture of calls.lectures) {
      expect(lecture.status).toBe("READY");
      expect(String(lecture.transcriptText).length).toBeGreaterThan(200);
      const section = calls.sections.find((s) => s.classId === lecture.classId && s.name === "Lecture notes");
      const note = (section?.notes as { create: Row[] }).create[0];
      expect(note.title).toBe(lecture.title);
      expect(note.bodyMarkdown).toBe(lecture.notesMarkdown);
      expect(note.lectureId).toMatch(/^l/);
    }
  });

  it("keeps finished steps checked off, and the estimate as the sum of the steps", async () => {
    const { prisma, calls } = recordingPrisma();

    await addSampleClasses(prisma, "u1", "America/Chicago", now);

    const draft = calls.assignments.find((a) => a.name === "Rhetorical analysis: rough draft");
    const tasks = (draft?.tasks as { create: Row[] }).create;
    expect(tasks.filter((t) => t.completed)).toHaveLength(2);
    expect(draft?.estimatedMinutes).toBe(tasks.reduce((sum, t) => sum + (t.estimatedMinutes as number), 0));
  });

  it("replaces the sample free time, starting today at local midnight", async () => {
    const { prisma, calls } = recordingPrisma();

    await addSampleClasses(prisma, "u1", "America/Chicago", now);

    expect(calls.freeTimeDeleted).toEqual([{ where: { userId: "u1", label: { in: ["Library", "Evening study"] } } }]);
    expect(calls.freeTime).toHaveLength(14);
    expect((calls.freeTime[0].date as Date).toISOString()).toBe("2026-10-06T05:00:00.000Z");
    for (const block of calls.freeTime) {
      expect(block.userId).toBe("u1");
      expect(block.endMinute as number).toBeGreaterThan(block.startMinute as number);
    }
  });
});
