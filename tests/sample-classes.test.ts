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
  function recordingPrisma() {
    const calls = { deleted: [] as unknown[], classes: [] as Record<string, unknown>[], assignments: [] as Record<string, unknown>[] };
    let id = 0;
    const prisma = {
      class: {
        deleteMany: async (args: unknown) => {
          calls.deleted.push(args);
          return { count: 0 };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.classes.push(data);
          return { id: `c${++id}`, ...data };
        },
      },
      assignment: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.assignments.push(data);
          return { id: `a${++id}`, ...data };
        },
      },
    };
    return { prisma: prisma as unknown as PrismaClient, calls };
  }

  it("replaces only this account's sample classes, dated from today in the account's time zone", async () => {
    const { prisma, calls } = recordingPrisma();
    const now = new Date("2026-10-06T15:00:00Z");

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
    // Some work is already done, and some is still open.
    expect(calls.assignments.some((a) => a.status === "SUBMITTED")).toBe(true);
    expect(calls.assignments.some((a) => a.status === "NOT_STARTED")).toBe(true);
  });
});
