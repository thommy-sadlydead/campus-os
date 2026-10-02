"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { isPlan, subscriptionUnlocks, type Plan } from "@/lib/billing";
import {
  appleAccountTokenFor,
  getAccess,
  isAppRequest,
  paymentsEnabled,
  requestOrigin,
} from "@/lib/billing-server";
import { stripeConfigured, stripePriceId, stripeRequest } from "@/lib/stripe";
import { recordAppleTransaction } from "@/lib/subscriptions";
import { AppleJwsError } from "@/lib/apple-iap";

export type BillingActionResult = { error: string } | undefined;

/** Website only: starts Stripe Checkout for a plan and sends the browser there. */
export async function startCheckoutAction(plan: Plan): Promise<BillingActionResult> {
  const user = await requireUser({ allowWithoutAccess: true });
  if (!isPlan(plan)) return { error: "Pick a plan." };
  if (!paymentsEnabled() || !stripeConfigured()) return { error: "Subscriptions aren't available yet." };
  // Apple only allows its own in-app purchase inside the iPhone app.
  if (await isAppRequest()) return { error: "Subscribe with the App Store button in the app." };

  const subscriptions = await prisma.subscription.findMany({ where: { userId: user.id } });
  const current = subscriptions.find((sub) => subscriptionUnlocks(sub, new Date()));
  if (current?.source === "apple") {
    return { error: "You already subscribe through the App Store. Manage it in your iPhone's Settings." };
  }
  if (current?.source === "stripe") return openBillingPortalAction();

  let url: string;
  try {
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeRequest<{ id: string }>("POST", "/customers", {
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }
    const origin = await requestOrigin();
    const session = await stripeRequest<{ url: string }>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: stripePriceId(plan), quantity: 1 }],
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${origin}/account?subscribed=1`,
      cancel_url: `${origin}/subscribe`,
    });
    url = session.url;
  } catch (err) {
    console.error("Stripe checkout failed:", err);
    return { error: "Couldn't open checkout. Try again in a moment." };
  }
  redirect(url);
}

/** Website only: Stripe's page for changing plan, payment method or canceling. */
export async function openBillingPortalAction(): Promise<BillingActionResult> {
  const user = await requireUser({ allowWithoutAccess: true });
  if (!user.stripeCustomerId || !stripeConfigured()) return { error: "There's no website subscription to manage." };
  let url: string;
  try {
    const origin = await requestOrigin();
    const session = await stripeRequest<{ url: string }>("POST", "/billing_portal/sessions", {
      customer: user.stripeCustomerId,
      return_url: `${origin}/account`,
    });
    url = session.url;
  } catch (err) {
    console.error("Stripe billing portal failed:", err);
    return { error: "Couldn't open billing. Try again in a moment." };
  }
  redirect(url);
}

/** iPhone app: the UUID StoreKit attaches to this account's purchases. */
export async function appleAccountTokenAction(): Promise<string> {
  const user = await requireUser({ allowWithoutAccess: true });
  return appleAccountTokenFor(user.id);
}

export type AppleRecordActionResult = { unlocked: boolean; otherAccount: boolean; error?: string };

/**
 * iPhone app: records the signed transactions from a purchase or a
 * restore, then says whether the account is unlocked now.
 */
export async function recordAppleTransactionsAction(transactions: string[]): Promise<AppleRecordActionResult> {
  const user = await requireUser({ allowWithoutAccess: true });
  let otherAccount = false;
  for (const jws of transactions.slice(0, 20)) {
    try {
      const result = await recordAppleTransaction(jws, { userId: user.id });
      if (result === "other-account") otherAccount = true;
    } catch (err) {
      if (!(err instanceof AppleJwsError)) throw err;
      console.error("Apple transaction rejected:", err.message);
      return { unlocked: false, otherAccount, error: "The App Store purchase couldn't be verified." };
    }
  }
  revalidatePath("/", "layout");
  const access = await getAccess(user.id);
  return { unlocked: access.kind === "subscribed" || access.kind === "free", otherAccount };
}
