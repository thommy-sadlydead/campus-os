import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeStripeParams,
  stripeCancellation,
  stripePeriodEnd,
  stripeStatus,
  verifyStripeSignature,
  type StripeSubscription,
} from "@/lib/stripe";

describe("encodeStripeParams", () => {
  it("encodes nested objects and arrays the way Stripe expects", () => {
    const encoded = encodeStripeParams({
      mode: "subscription",
      line_items: [{ price: "price_123", quantity: 1 }],
      metadata: { userId: "u1" },
      skipped: undefined,
    });
    expect(decodeURIComponent(encoded)).toBe(
      "mode=subscription&line_items[0][price]=price_123&line_items[0][quantity]=1&metadata[userId]=u1"
    );
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const payload = '{"id":"evt_1"}';
  const sign = (t: number, body = payload) =>
    crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

  it("accepts a fresh, correct signature", () => {
    expect(verifyStripeSignature(payload, `t=1000,v1=${sign(1000)}`, secret, 1010)).toBe(true);
  });

  it("accepts it among several signatures (secret rotation)", () => {
    expect(verifyStripeSignature(payload, `t=1000,v1=${"0".repeat(64)},v1=${sign(1000)}`, secret, 1000)).toBe(true);
  });

  it("rejects a changed body, a wrong secret, an old timestamp or no header", () => {
    expect(verifyStripeSignature('{"id":"evt_2"}', `t=1000,v1=${sign(1000)}`, secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, `t=1000,v1=${sign(1000)}`, "whsec_other", 1000)).toBe(false);
    expect(verifyStripeSignature(payload, `t=1000,v1=${sign(1000)}`, secret, 1000 + 301)).toBe(false);
    expect(verifyStripeSignature(payload, null, secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, "t=1000", secret, 1000)).toBe(false);
  });
});

describe("stripeStatus", () => {
  it("maps Stripe's statuses to ours", () => {
    expect(stripeStatus("active")).toBe("active");
    expect(stripeStatus("trialing")).toBe("active");
    expect(stripeStatus("past_due")).toBe("past_due");
    expect(stripeStatus("unpaid")).toBe("past_due");
    expect(stripeStatus("canceled")).toBe("canceled");
    expect(stripeStatus("incomplete_expired")).toBe("expired");
    expect(stripeStatus("incomplete")).toBeNull();
  });
});

describe("stripePeriodEnd", () => {
  const base: StripeSubscription = { id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, items: { data: [] } };

  it("reads the period end from the subscription (older API versions)", () => {
    expect(stripePeriodEnd({ ...base, current_period_end: 1_800_000_000 })?.getTime()).toBe(1_800_000_000_000);
  });

  it("reads it from the first item (API versions from 2025-03-31)", () => {
    const sub = { ...base, items: { data: [{ price: { id: "price_1" }, current_period_end: 1_800_000_000 }] } };
    expect(stripePeriodEnd(sub)?.getTime()).toBe(1_800_000_000_000);
  });
});

describe("stripeCancellation", () => {
  const base: StripeSubscription = { id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, items: { data: [] } };
  const periodEnd = new Date(1_800_000_000_000);

  it("renews when nothing is scheduled", () => {
    expect(stripeCancellation(base, periodEnd)).toEqual({ cancelAtPeriodEnd: false, accessEnds: periodEnd });
  });

  it("ends at the period end with cancel_at_period_end (older API versions)", () => {
    expect(stripeCancellation({ ...base, cancel_at_period_end: true }, periodEnd).cancelAtPeriodEnd).toBe(true);
  });

  it("ends at cancel_at, which the customer portal sets in newer API versions", () => {
    expect(stripeCancellation({ ...base, cancel_at: 1_800_000_000 }, periodEnd)).toEqual({ cancelAtPeriodEnd: true, accessEnds: periodEnd });
    expect(stripeCancellation({ ...base, cancel_at: 1_700_000_000 }, periodEnd).accessEnds).toEqual(new Date(1_700_000_000_000));
  });
});

