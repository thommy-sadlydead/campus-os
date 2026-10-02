import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import type { Access } from "@/lib/billing";
import { CardHeader } from "@/components/ui/CardHeader";
import { CardIcon } from "@/components/icons";
import { FreeAccessCodeForm, ManageBillingButton } from "./BillingButtons";

/**
 * Account page: the trial or plan, how to manage it, and (on the website
 * only) the free-access code. Apple subscriptions are managed in iPhone
 * Settings and Stripe ones on Stripe's billing page, so each gets its own
 * way out, and neither is offered where the other belongs.
 */
export function PlanSection({
  access,
  inApp,
  timezone,
  justSubscribed,
}: {
  access: Access;
  inApp: boolean;
  timezone: string;
  justSubscribed: boolean;
}) {
  const day = (d: Date) => formatInTimeZone(d, timezone, "MMM d, yyyy");
  let status: React.ReactNode;
  let action: React.ReactNode = null;

  if (access.kind === "free") {
    status = (
      <>
        <span className="badge mr-2 bg-ok-soft text-ok">Free access</span>
        Campus OS is free on this account.
      </>
    );
  } else if (access.kind === "subscribed") {
    const sub = access.subscription;
    const plan = sub.plan === "yearly" ? "Yearly" : "Monthly";
    const where = sub.source === "apple" ? "the App Store" : "the website";
    status =
      sub.status === "past_due" ? (
        <>
          <span className="badge mr-2 bg-danger-soft text-danger">Payment problem</span>
          The last payment for your {plan.toLowerCase()} plan didn&apos;t go through. Update your payment method to keep
          access after {day(sub.currentPeriodEnd)}.
        </>
      ) : sub.cancelAtPeriodEnd ? (
        <>
          <span className="badge mr-2 bg-warn-soft text-warn">Canceled</span>
          {plan} plan through {where}. You have access until {day(sub.currentPeriodEnd)}.
        </>
      ) : (
        <>
          <span className="badge mr-2 bg-ok-soft text-ok">{plan}</span>
          Subscribed through {where}. Renews {day(sub.currentPeriodEnd)}.
        </>
      );
    if (sub.source === "stripe") {
      action = inApp ? (
        <p className="text-sm text-ink-soft">Manage this subscription on the Campus OS website.</p>
      ) : (
        <ManageBillingButton />
      );
    } else {
      action = inApp ? (
        <a href="https://apps.apple.com/account/subscriptions" className="btn btn-secondary">
          Manage in the App Store
        </a>
      ) : (
        <p className="text-sm text-ink-soft">Manage it on your iPhone: Settings → your name → Subscriptions.</p>
      );
    }
  } else {
    status =
      access.kind === "trial" ? (
        <>
          <span className="badge mr-2 bg-accent-soft text-accent-ink">Free trial</span>
          {access.daysLeft} day{access.daysLeft === 1 ? "" : "s"} left, until {day(access.trialEndsAt)}.
        </>
      ) : (
        <>
          <span className="badge mr-2 bg-surface-2 text-ink-soft">Trial ended</span>
          Subscribe to keep using Campus OS.
        </>
      );
    action = (
      <Link href="/subscribe" className="btn btn-primary">
        See plans
      </Link>
    );
  }

  return (
    <section id="plan" className="card card-pad scroll-mt-24">
      <CardHeader icon={<CardIcon className="h-[18px] w-[18px]" />} title="Plan" />
      {justSubscribed && (
        <p className="mt-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
          {access.kind === "subscribed"
            ? "Thanks for subscribing!"
            : "Thanks for subscribing! It can take a few seconds to show up here, so refresh in a moment."}
        </p>
      )}
      <p className="mt-4 text-sm leading-relaxed text-ink">{status}</p>
      {action && <div className="mt-4">{action}</div>}
      {!inApp && access.kind !== "free" && (
        <div className="mt-5 border-t border-border-soft pt-4">
          <FreeAccessCodeForm />
        </div>
      )}
    </section>
  );
}
