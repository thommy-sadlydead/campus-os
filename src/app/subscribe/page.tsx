import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/login/actions";
import { getAccess, isAppRequest, paymentsEnabled } from "@/lib/billing-server";
import { stripeConfigured, stripePriceLabel } from "@/lib/stripe";
import { SubscribePanel } from "@/components/billing/SubscribePanel";
import { Logo } from "@/components/Logo";
import { BrandBackdrop } from "@/components/ui/BrandBackdrop";

// Plans and checkout. Where an account lands once its trial is over
// (requireUser sends it here), and where the trial banner links.
export default async function SubscribePage() {
  const user = await requireUser({ allowWithoutAccess: true });
  if (!paymentsEnabled()) redirect("/dashboard");
  const access = await getAccess(user.id);
  if (access.kind === "subscribed" || access.kind === "free") redirect("/account");

  // The app shows App Store prices instead, so it doesn't need Stripe's.
  const inApp = await isAppRequest();
  const [monthly, yearly] =
    !inApp && stripeConfigured()
      ? await Promise.all([stripePriceLabel("monthly"), stripePriceLabel("yearly")])
      : [null, null];

  const trialOver = access.kind === "none";
  return (
    <div className="relative min-h-screen bg-bg px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] text-ink">
      <BrandBackdrop />
      <div className="relative mx-auto max-w-2xl">
        <nav className="flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-1">
            {trialOver ? (
              <Link href="/account" className="btn btn-ghost btn-sm">
                Account
              </Link>
            ) : (
              <Link href="/dashboard" className="btn btn-ghost btn-sm">
                Back to Campus OS
              </Link>
            )}
            <form action={logoutAction}>
              <button className="btn btn-ghost btn-sm">Log out</button>
            </form>
          </div>
        </nav>

        <header className="mb-8 mt-12 text-center sm:mt-16">
          <p className="eyebrow">{trialOver ? "Free trial ended" : `Free trial · ${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"} left`}</p>
          <h1 className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">
            {trialOver ? "Keep going with Campus OS" : "Pick a plan for after your trial"}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">
            {trialOver
              ? "Subscribe to pick up where you left off. Your classes, notes and lectures are all still here."
              : "Subscribing now starts your plan today. Nothing is charged unless you subscribe."}
          </p>
        </header>

        <SubscribePanel webPrices={{ monthly, yearly }} />

        {/* Codes are redeemed on the website only (see redeemFreeAccessCodeAction). */}
        {!inApp && (
          <p className="mt-8 text-center text-sm text-ink-soft">
            Have a free-access code?{" "}
            <Link href="/account#plan" className="font-medium text-accent-ink underline underline-offset-2">
              Enter it in Account
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
