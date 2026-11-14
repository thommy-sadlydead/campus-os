import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "../src/lib/health";

afterEach(() => vi.useRealTimers());

describe("checkHealth", () => {
  it("is ok when the database answers", async () => {
    expect(await checkHealth(async () => [{ "?column?": 1 }])).toEqual({ ok: true });
  });

  it("is not ok when the database errors, and says nothing about why", async () => {
    const result = await checkHealth(async () => {
      throw new Error("password authentication failed for user postgres");
    });
    expect(result).toEqual({ ok: false });
  });

  it("is not ok when the ping throws before it returns a promise", async () => {
    const result = await checkHealth(() => {
      throw new Error("boom");
    });
    expect(result).toEqual({ ok: false });
  });

  it("is not ok when the database never answers, once the timeout passes", async () => {
    vi.useFakeTimers();
    const pending = checkHealth(() => new Promise(() => {}), 1000);
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false });
  });

  it("doesn't let a late failure after the timeout crash anything", async () => {
    vi.useFakeTimers();
    let fail: (reason: Error) => void = () => {};
    const pending = checkHealth(() => new Promise((_, reject) => (fail = reject)), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ ok: false });
    fail(new Error("too late"));
    await vi.advanceTimersByTimeAsync(10);
  });
});
