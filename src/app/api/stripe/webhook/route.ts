import { NextResponse } from "next/server";
import { recordStripeSubscription } from "@/lib/subscriptions";
import { stripeRequest, verifyStripeSignature, type StripeSubscription } from "@/lib/stripe";

// Stripe calls this for subscription changes on the website: a finished
// checkout, renewals, failed payments, cancellations. Point a webhook
// endpoint at /api/stripe/webhook in the Stripe dashboard with the events
// below, and put its signing secret in STRIPE_WEBHOOK_SECRET.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Stripe webhook isn't set up." }, { status: 503 });

  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as { mode?: string; subscription?: string; client_reference_id?: string };
        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripeRequest<StripeSubscription>("GET", `/subscriptions/${session.subscription}`);
          await recordStripeSubscription(sub, session.client_reference_id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await recordStripeSubscription(event.data.object as unknown as StripeSubscription);
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry later, which is what we want for a hiccup.
    console.error(`Stripe webhook ${event.type} failed:`, err);
    return NextResponse.json({ error: "Couldn't process the event." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
