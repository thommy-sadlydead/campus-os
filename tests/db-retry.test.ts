import { describe, expect, it } from "vitest";
import { isTransientDbError, withDbRetry } from "../src/lib/db-retry";

const unreachable = Object.assign(new Error("Can't reach database server at `pooled.db.prisma.io:5432`"), {
  name: "PrismaClientInitializationError",
  errorCode: undefined,
});
const noSleep = { sleep: async () => {} };

describe("isTransientDbError", () => {
  it("is true only when the database never answered", () => {
    expect(isTransientDbError(unreachable)).toBe(true);
    expect(isTransientDbError(Object.assign(new Error("pool"), { code: "P2024" }))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error("unique"), { code: "P2002" }))).toBe(false);
    expect(isTransientDbError(new Error("Not found."))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});

describe("withDbRetry", () => {
  it("tries again after the database was unreachable, then succeeds", async () => {
    let calls = 0;
    const result = await withDbRetry(async () => {
      calls++;
      if (calls < 3) throw unreachable;
      return "ok";
    }, noSleep);
    expect([result, calls]).toEqual(["ok", 3]);
  });

  it("gives up after the last retry, and never retries other errors", async () => {
    let calls = 0;
    await expect(
      withDbRetry(async () => {
        calls++;
        throw unreachable;
      }, noSleep)
    ).rejects.toBe(unreachable);
    expect(calls).toBe(3);

    calls = 0;
    const unique = Object.assign(new Error("unique"), { code: "P2002" });
    await expect(
      withDbRetry(async () => {
        calls++;
        throw unique;
      }, noSleep)
    ).rejects.toBe(unique);
    expect(calls).toBe(1);
  });
});
