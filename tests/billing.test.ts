import { describe, expect, it } from "vitest";
import {
  accessFor,
  parseFreeAccessCodes,
  planForAppleProduct,
  subscriptionUnlocks,
  trialEndFrom,
  TRIAL_DAYS,
} from "@/lib/billing";

const NOW = new Date("2026-10-02T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const sub = (over: Partial<Parameters<typeof subscriptionUnlocks>[0]> = {}) => ({
  source: "stripe",
  plan: "monthly",
  status: "active",
  currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY),
  cancelAtPeriodEnd: false,
  ...over,
});

describe("trialEndFrom", () => {
  it("is TRIAL_DAYS after the start", () => {
    expect(trialEndFrom(NOW).getTime() - NOW.getTime()).toBe(TRIAL_DAYS * DAY);
  });
});

describe("accessFor", () => {
  const base = { trialEndsAt: null, freeAccessAt: null, subscriptions: [] };

  it("gives free access to accounts that redeemed a code, whatever else is true", () => {
    expect(accessFor({ ...base, freeAccessAt: new Date("2026-01-01"), trialEndsAt: new Date("2020-01-01") }, NOW)).toEqual({
      kind: "free",
    });
  });

  it("counts days left in the trial, rounding up", () => {
    const access = accessFor({ ...base, trialEndsAt: new Date(NOW.getTime() + 2.5 * DAY) }, NOW);
    expect(access).toMatchObject({ kind: "trial", daysLeft: 3 });
  });

  it("ends the trial at its end time", () => {
    expect(accessFor({ ...base, trialEndsAt: NOW }, NOW)).toEqual({ kind: "none", trialEndedAt: NOW });
  });

  it("prefers a live subscription over the trial", () => {
    const access = accessFor({ ...base, trialEndsAt: new Date(NOW.getTime() + DAY), subscriptions: [sub()] }, NOW);
    expect(access.kind).toBe("subscribed");
  });

  it("keeps access while a failed renewal is retried, until the period end", () => {
    expect(accessFor({ ...base, subscriptions: [sub({ status: "past_due" })] }, NOW).kind).toBe("subscribed");
    expect(
      accessFor({ ...base, subscriptions: [sub({ status: "past_due", currentPeriodEnd: new Date(NOW.getTime() - 1) })] }, NOW).kind
    ).toBe("none");
  });

  it("keeps a canceled-at-period-end plan until it runs out", () => {
    expect(accessFor({ ...base, subscriptions: [sub({ cancelAtPeriodEnd: true })] }, NOW).kind).toBe("subscribed");
  });

  it("doesn't unlock with canceled or expired subscriptions", () => {
    const access = accessFor(
      { ...base, trialEndsAt: new Date("2026-09-01"), subscriptions: [sub({ status: "canceled" }), sub({ status: "expired" })] },
      NOW
    );
    expect(access.kind).toBe("none");
  });

  it("reports the subscription that lasts longest when there are two", () => {
    const later = sub({ source: "apple", plan: "yearly", currentPeriodEnd: new Date(NOW.getTime() + 300 * DAY) });
    const access = accessFor({ ...base, subscriptions: [sub(), later] }, NOW);
    expect(access.kind === "subscribed" && access.subscription.source).toBe("apple");
  });
});

describe("parseFreeAccessCodes", () => {
  it("splits on commas, trims and lowercases", () => {
    expect(parseFreeAccessCodes(" Friends2026 , VIP ,, ")).toEqual(["friends2026", "vip"]);
  });

  it("is empty when unset", () => {
    expect(parseFreeAccessCodes(undefined)).toEqual([]);
    expect(parseFreeAccessCodes("  ")).toEqual([]);
  });
});

describe("planForAppleProduct", () => {
  it("maps this app's product IDs and nothing else", () => {
    expect(planForAppleProduct("com.reecebroderick.campusos.monthly")).toBe("monthly");
    expect(planForAppleProduct("com.reecebroderick.campusos.yearly")).toBe("yearly");
    expect(planForAppleProduct("com.someone.else.monthly")).toBeNull();
  });
});
