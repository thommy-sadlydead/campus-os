// Payments: a free trial from sign-up, then a monthly or yearly
// subscription bought on the website (Stripe) or in the iPhone app (Apple).
// Accounts that redeemed the free-access code are free for good. Nothing is
// enforced until PAYMENTS_ENABLED=1 (src/lib/billing-server.ts), so this
// can ship before the Stripe and App Store setup is finished.
//
// Pure, no Prisma or Next.js, so it's unit-testable (tests/billing.test.ts)
// and safe to import from client components.

export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PLANS = ["monthly", "yearly"] as const;
export type Plan = (typeof PLANS)[number];
export type SubscriptionSource = "stripe" | "apple";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "expired";

/** The iPhone app's subscriptions, as set up in App Store Connect. */
export const APPLE_PRODUCT_IDS: Record<Plan, string> = {
  monthly: "com.reecebroderick.campusos.monthly",
  yearly: "com.reecebroderick.campusos.yearly",
};

/** The only app whose App Store purchases count (its bundle ID). */
export const APPLE_BUNDLE_ID = "com.reecebroderick.campusos";

export function planForAppleProduct(productId: string): Plan | null {
  return PLANS.find((plan) => APPLE_PRODUCT_IDS[plan] === productId) ?? null;
}

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

export function trialEndFrom(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * DAY_MS);
}

export interface SubscriptionLike {
  source: string;
  plan: string;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

export type Access =
  | { kind: "free" }
  | { kind: "subscribed"; subscription: SubscriptionLike }
  | { kind: "trial"; trialEndsAt: Date; daysLeft: number }
  | { kind: "none"; trialEndedAt: Date | null };

/**
 * A subscription unlocks the app until the end of what's been paid for. A
 * failed renewal (past_due) keeps access while Stripe or Apple retries the
 * payment, up to the period end they report.
 */
export function subscriptionUnlocks(sub: SubscriptionLike, now: Date): boolean {
  return (sub.status === "active" || sub.status === "past_due") && sub.currentPeriodEnd > now;
}

/** What an account can do right now: free, subscribed, in its trial, or nothing until it subscribes. */
export function accessFor(
  account: { trialEndsAt: Date | null; freeAccessAt: Date | null; subscriptions: SubscriptionLike[] },
  now: Date
): Access {
  if (account.freeAccessAt) return { kind: "free" };

  const paid = account.subscriptions
    .filter((sub) => subscriptionUnlocks(sub, now))
    .sort((a, b) => b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime())[0];
  if (paid) return { kind: "subscribed", subscription: paid };

  if (account.trialEndsAt && account.trialEndsAt > now) {
    const daysLeft = Math.max(1, Math.ceil((account.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
    return { kind: "trial", trialEndsAt: account.trialEndsAt, daysLeft };
  }
  return { kind: "none", trialEndedAt: account.trialEndsAt };
}

/** Free-access codes from FREE_ACCESS_CODE: one or more, comma-separated, case-insensitive. */
export function parseFreeAccessCodes(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}
