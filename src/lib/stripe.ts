import "server-only";
import crypto from "node:crypto";
import type { Plan, SubscriptionStatus } from "@/lib/billing";

// A small Stripe REST client (the same hand-rolled approach as canvas.ts
// and gmail.ts) for the website's subscriptions: Checkout to subscribe, the
// customer portal to manage or cancel, and the webhook that keeps the
// Subscription table current. Needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// STRIPE_PRICE_MONTHLY and STRIPE_PRICE_YEARLY (see .env.example).

const API = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_MONTHLY && process.env.STRIPE_PRICE_YEARLY);
}

export class StripeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Stripe's form encoding: nested objects and arrays become key[a][0][b]=value. */
export function encodeStripeParams(params: Record<string, unknown>): string {
  const pairs: [string, string][] = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((item, i) => add(`${key}[${i}]`, item));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    else pairs.push([key, String(value)]);
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return new URLSearchParams(pairs).toString();
}

export async function stripeRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError("Stripe isn't set up (STRIPE_SECRET_KEY).", 0);
  const query = encodeStripeParams(params);
  const res = await fetch(method === "POST" || !query ? `${API}${path}` : `${API}${path}?${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? query : undefined,
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new StripeError(body?.error?.message ?? `Stripe returned ${res.status}.`, res.status);
  return body as T;
}

/**
 * Checks a webhook's Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=…]"):
 * an HMAC-SHA256 of "<t>.<raw body>" with the endpoint's signing secret,
 * from within the last five minutes so an old request can't be replayed.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
): boolean {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.split("=") as [string, string]);
  const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  // A scheduled cancellation. Newer API versions (and the customer portal)
  // set this, at the period end, instead of cancel_at_period_end.
  cancel_at?: number | null;
  // Top-level before Stripe's 2025-03-31 API version, per item after it.
  current_period_end?: number;
  items: { data: Array<{ price: { id: string }; current_period_end?: number }> };
  metadata?: Record<string, string>;
}

/** Stripe's status as one of ours; null while the first payment hasn't gone through. */
export function stripeStatus(status: string): SubscriptionStatus | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete_expired":
    case "paused":
      return "expired";
    default:
      return null; // "incomplete": checkout not finished
  }
}

export function stripePeriodEnd(sub: StripeSubscription): Date | null {
  const seconds = sub.current_period_end ?? sub.items.data[0]?.current_period_end;
  return seconds ? new Date(seconds * 1000) : null;
}

/**
 * Whether a subscription is set to end instead of renewing, and when
 * access ends: the period end, or an earlier cancel_at.
 */
export function stripeCancellation(sub: StripeSubscription, periodEnd: Date): { cancelAtPeriodEnd: boolean; accessEnds: Date } {
  const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000) : null;
  return {
    cancelAtPeriodEnd: sub.cancel_at_period_end || cancelAt !== null,
    accessEnds: cancelAt && cancelAt < periodEnd ? cancelAt : periodEnd,
  };
}

export function stripePriceId(plan: Plan): string | undefined {
  return plan === "monthly" ? process.env.STRIPE_PRICE_MONTHLY : process.env.STRIPE_PRICE_YEARLY;
}

export function planForStripePrice(priceId: string | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  return null;
}

/** "$9.99" from a Stripe price, for the subscribe page. */
export async function stripePriceLabel(plan: Plan): Promise<string | null> {
  const id = stripePriceId(plan);
  if (!id) return null;
  try {
    const price = await stripeRequest<{ unit_amount: number | null; currency: string }>("GET", `/prices/${id}`);
    if (price.unit_amount == null) return null;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase() }).format(
      price.unit_amount / 100
    );
  } catch (err) {
    console.error(`Stripe price ${plan} lookup failed:`, err);
    return null;
  }
}
