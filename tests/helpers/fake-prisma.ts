import type { PrismaClient } from "@prisma/client";

// A small in-memory stand-in for the Prisma calls the LMS sync makes
// (src/lib/lms/apply.ts), so its rules can be tested without a database.
// It enforces the same unique keys as prisma/schema.prisma: a class per
// (userId, lmsProvider, lmsCourseId), an assignment or exam per
// (classId, lmsItemId). `select` and `include` are ignored: whole rows
// come back.

type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as { not?: unknown; in?: unknown[]; notIn?: unknown[] };
      if ("not" in c) return c.not === null ? value !== null && value !== undefined : value !== c.not;
      if ("in" in c) return (c.in ?? []).includes(value);
      if ("notIn" in c) return !(c.notIn ?? []).includes(value);
    }
    return value === condition;
  });
}

function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

export interface FakeDb {
  class: Row[];
  assignment: Row[];
  exam: Row[];
  pendingChange: Row[];
}

export function createFakePrisma(seed: Partial<FakeDb> = {}): { prisma: PrismaClient; db: FakeDb } {
  const db: FakeDb = {
    class: seed.class ?? [],
    assignment: seed.assignment ?? [],
    exam: seed.exam ?? [],
    pendingChange: seed.pendingChange ?? [],
  };
  let counter = 0;
  const newId = (prefix: string) => `${prefix}${++counter}`;

  const classKey = (where: Where) => where.userId_lmsProvider_lmsCourseId as Row;
  const findClass = (where: Where) => {
    const key = classKey(where);
    if (key) {
      return db.class.find((c) => c.userId === key.userId && c.lmsProvider === key.lmsProvider && c.lmsCourseId === key.lmsCourseId) ?? null;
    }
    return db.class.find((c) => matches(c, where)) ?? null;
  };

  function itemTable(table: "assignment" | "exam", prefix: string) {
    return {
      findMany: async ({ where }: { where?: Where } = {}) => db[table].filter((r) => matches(r, where)),
      create: async ({ data }: { data: Row }) => {
        if (data.lmsItemId != null && db[table].some((r) => r.classId === data.classId && r.lmsItemId === data.lmsItemId)) {
          throw uniqueViolation();
        }
        const row = { ...data, id: newId(prefix) } as Row;
        db[table].push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Where }) => {
        const row = db[table].find((r) => r.id === where.id);
        if (!row) throw new Error(`No ${table} ${where.id}`);
        Object.assign(row, data);
        return row;
      },
      deleteMany: async ({ where }: { where: Where }) => {
        const before = db[table].length;
        db[table] = db[table].filter((r) => !matches(r, where));
        return { count: before - db[table].length };
      },
    };
  }

  const prisma = {
    class: {
      findUnique: async ({ where }: { where: Where }) => findClass(where),
      findUniqueOrThrow: async ({ where }: { where: Where }) => {
        const row = findClass(where);
        if (!row) throw new Error("Class not found");
        return row;
      },
      findMany: async ({ where }: { where?: Where } = {}) => db.class.filter((c) => matches(c, where)),
      create: async ({ data }: { data: Row }) => {
        if (
          data.lmsCourseId != null &&
          db.class.some((c) => c.userId === data.userId && c.lmsProvider === data.lmsProvider && c.lmsCourseId === data.lmsCourseId)
        ) {
          throw uniqueViolation();
        }
        const row = { archived: false, ...data, id: newId("class") } as Row;
        db.class.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Where }) => {
        const row = db.class.find((c) => c.id === where.id);
        if (!row) throw new Error(`No class ${where.id}`);
        Object.assign(row, data);
        return row;
      },
    },
    assignment: itemTable("assignment", "assignment"),
    exam: itemTable("exam", "exam"),
    pendingChange: {
      updateMany: async ({ where, data }: { where: Where; data: Where }) => {
        const rows = db.pendingChange.filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
  };

  return { prisma: prisma as unknown as PrismaClient, db };
}
