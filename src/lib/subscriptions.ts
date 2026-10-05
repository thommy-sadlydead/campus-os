import "server-only";
import { prisma } from "@/lib/prisma";
import { APPLE_BUNDLE_ID } from "@/lib/billing";
import { saveSubscription } from "@/lib/billing-server";
import {
  appleSubscriptionState,
  verifyAppleJws,
  type AppleRenewalInfo,
  type AppleTransaction,
} from "@/lib/apple-iap";
import {
  planForStripePrice,
  stripeCancellation,
  stripePeriodEnd,
  stripeStatus,
  type StripeSubscription,
} from "@/lib/stripe";

// Turns what Stripe and Apple report into Subscription rows, attached to
// the right account. Called from the webhooks and from the iPhone app's
// purchase and restore.

export type AppleRecordResult = "saved" | "ignored" | "other-account";

/**
 * Records one Apple subscription transaction (a JWS from the app or a
 * notification). Purchases from the app carry this account's
 * appAccountToken, so a subscription can only ever unlock the account it
 * was bought from; `userId` is the signed-in account, for purchases made
 * without one (an offer code redeemed in the App Store, say).
 */
export async function recordAppleTransaction(
  jws: string,
  options: { userId?: string; renewalJws?: string } = {}
): Promise<AppleRecordResult> {
  const tx = verifyAppleJws<AppleTransaction>(jws);
  if (tx.bundleId !== APPLE_BUNDLE_ID) return "ignored";
  const renewal = options.renewalJws ? verifyAppleJws<AppleRenewalInfo>(options.renewalJws) : null;
  const state = appleSubscriptionState(tx, renewal, new Date());
  if (!state) return "ignored";

  const [owner, existing] = await Promise.all([
    tx.appAccountToken
      ? prisma.user.findFirst({ where: { appleAccountToken: tx.appAccountToken.toLowerCase() }, select: { id: true } })
      : null,
    prisma.subscription.findUnique({
      where: { source_externalId: { source: "apple", externalId: tx.originalTransactionId } },
      select: { userId: true },
    }),
  ]);
  const userId = owner?.id ?? existing?.userId ?? options.userId;
  if (!userId) return "ignored";
  if (options.userId && userId !== options.userId) return "other-account";

  await saveSubscription({ userId, source: "apple", externalId: tx.originalTransactionId, ...state });
  return "saved";
}

/** Records a Stripe subscription from the webhook. `userId` comes from the checkout session when known. */
export async function recordStripeSubscription(sub: StripeSubscription, userId?: string | null): Promise<void> {
  const status = stripeStatus(sub.status);
  const plan = planForStripePrice(sub.items.data[0]?.price.id);
  const periodEnd = stripePeriodEnd(sub);
  if (!status || !plan || !periodEnd) return;
  const { cancelAtPeriodEnd, accessEnds } = stripeCancellation(sub, periodEnd);

  const owner =
    userId ?? sub.metadata?.userId ??
    (await prisma.user.findFirst({ where: { stripeCustomerId: sub.customer }, select: { id: true } }))?.id;
  if (!owner) {
    console.error(`Stripe subscription ${sub.id}: no matching account.`);
    return;
  }
  // A webhook can name an account that's since been deleted.
  if (!(await prisma.user.findUnique({ where: { id: owner }, select: { id: true } }))) return;

  await saveSubscription({
    userId: owner,
    source: "stripe",
    externalId: sub.id,
    plan,
    status,
    currentPeriodEnd: accessEnds,
    cancelAtPeriodEnd,
  });
}
