"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { APPLE_PRODUCT_IDS, PLANS, type Plan } from "@/lib/billing";
import { hasNativePlugin, isNativeApp, NativeStore, nativeErrorCode } from "@/lib/native-app";
import {
  appleAccountTokenAction,
  recordAppleTransactionsAction,
  startCheckoutAction,
} from "@/app/subscribe/actions";
import { CheckIcon } from "@/components/icons";

const PLAN_INFO: Record<Plan, { title: string; per: string; note: string }> = {
  monthly: { title: "Monthly", per: "/ month", note: "Billed every month" },
  yearly: { title: "Yearly", per: "/ year", note: "Billed once a year" },
};

const INCLUDED = [
  "Canvas classes, assignments and due dates",
  "Lecture recordings turned into notes",
  "School email sorted by class",
  "The dashboard and the AI assistant",
];

/**
 * The plans and the buy button. On the website that's Stripe Checkout; in
 * the iPhone app it's Apple's in-app purchase (Apple requires it there),
 * with App Store prices and Restore purchases.
 */
export function SubscribePanel({ webPrices }: { webPrices: Record<Plan, string | null> }) {
  const router = useRouter();
  const [inApp, setInApp] = useState(false);
  const [storeReady, setStoreReady] = useState<boolean | null>(null);
  // An app build from before in-app purchase, which can't sell at all.
  const [outdatedApp, setOutdatedApp] = useState(false);
  const [applePrices, setApplePrices] = useState<Partial<Record<Plan, string>>>({});
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!isNativeApp()) return;
    setInApp(true);
    if (!hasNativePlugin("NativeStore")) {
      setOutdatedApp(true);
      setStoreReady(false);
      return;
    }
    NativeStore.products({ productIds: PLANS.map((plan) => APPLE_PRODUCT_IDS[plan]) })
      .then(({ products }) => {
        const prices: Partial<Record<Plan, string>> = {};
        for (const plan of PLANS) {
          const product = products.find((p) => p.id === APPLE_PRODUCT_IDS[plan]);
          if (product) prices[plan] = product.displayPrice;
        }
        setApplePrices(prices);
        setStoreReady(Object.keys(prices).length > 0);
      })
      .catch(() => setStoreReady(false));
  }, []);

  async function afterApple(transactions: string[]) {
    const result = await recordAppleTransactionsAction(transactions);
    if (result.unlocked) {
      router.push("/dashboard");
      router.refresh();
    } else if (result.otherAccount) {
      setMessage({
        tone: "error",
        text: "This Apple ID's subscription belongs to a different Campus OS account. Log in to that account to use it.",
      });
    } else {
      setMessage({ tone: "error", text: result.error ?? "No active App Store subscription was found." });
    }
  }

  function buy(plan: Plan) {
    setMessage(null);
    startTransition(async () => {
      if (!inApp) {
        const result = await startCheckoutAction(plan);
        if (result?.error) setMessage({ tone: "error", text: result.error });
        return;
      }
      try {
        const accountToken = await appleAccountTokenAction();
        const result = await NativeStore.purchase({ productId: APPLE_PRODUCT_IDS[plan], accountToken });
        if (result.status === "purchased") await afterApple([result.jws]);
        else if (result.status === "pending") {
          setMessage({ tone: "info", text: "Waiting for approval. Campus OS unlocks as soon as it's approved." });
        }
      } catch (err) {
        if (nativeErrorCode(err) !== "cancelled") {
          setMessage({ tone: "error", text: "The App Store purchase didn't go through. Try again." });
        }
      }
    });
  }

  function restore() {
    setMessage(null);
    startTransition(async () => {
      try {
        const { transactions } = await NativeStore.restore();
        if (transactions.length === 0) {
          setMessage({ tone: "error", text: "No App Store subscription was found for this Apple ID." });
          return;
        }
        await afterApple(transactions);
      } catch {
        setMessage({ tone: "error", text: "Couldn't reach the App Store. Try again." });
      }
    });
  }

  const priceFor = (plan: Plan) => (inApp ? applePrices[plan] : webPrices[plan]);
  const unavailable = inApp ? storeReady === false : PLANS.every((plan) => !webPrices[plan]);

  return (
    <div className="flex flex-col gap-5">
      <ul className="grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
        {INCLUDED.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 h-4 w-4 flex-none text-ok" />
            {item}
          </li>
        ))}
      </ul>

      {unavailable ? (
        <p className="rounded-xl2 bg-surface-2 px-4 py-3 text-sm text-ink-soft">
          {/* In the app, never point to another way to pay (App Store guideline 3.1.1). */}
          {!inApp
            ? "Subscriptions aren't available yet. Check back soon."
            : outdatedApp
              ? "Update Campus OS from the App Store to subscribe."
              : "The App Store isn't offering subscriptions right now. Try again in a little while."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div
              key={plan}
              className={`card flex flex-col p-5 ${plan === "yearly" ? "border-accent shadow-[0_0_0_3px_var(--accent-ring)]" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold text-ink">{PLAN_INFO[plan].title}</h2>
                {plan === "yearly" && <span className="badge bg-accent-soft text-accent-ink">Best value</span>}
              </div>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tabular-nums tracking-tight text-ink">{priceFor(plan) ?? "—"}</span>
                <span className="text-sm text-ink-faint">{PLAN_INFO[plan].per}</span>
              </p>
              <p className="mt-1 text-xs text-ink-faint">{PLAN_INFO[plan].note}</p>
              <button
                onClick={() => buy(plan)}
                disabled={pending || !priceFor(plan)}
                className={`btn mt-5 w-full ${plan === "yearly" ? "btn-primary" : "btn-secondary"}`}
              >
                {pending ? "Working…" : `Subscribe ${PLAN_INFO[plan].title.toLowerCase()}`}
              </button>
            </div>
          ))}
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`rounded-xl2 px-4 py-3 text-sm ${message.tone === "error" ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink-soft"}`}
        >
          {message.text}
        </p>
      )}

      {inApp && storeReady && (
        <button onClick={restore} disabled={pending} className="btn btn-ghost self-center">
          Restore purchases
        </button>
      )}

      <p className="text-xs leading-relaxed text-ink-faint">
        {inApp
          ? "Payment is charged to your Apple ID when you confirm. The subscription renews automatically at the same price unless you cancel at least 24 hours before the current period ends. Manage or cancel it in your iPhone's Settings → your name → Subscriptions."
          : "Billed through Stripe at the start of each period until you cancel. Cancel anytime under Account → Manage billing; you keep access until the period you paid for ends."}{" "}
        <a href="/terms" className="underline underline-offset-2 hover:text-ink">
          Terms of Use
        </a>{" "}
        ·{" "}
        <a href="/privacy" className="underline underline-offset-2 hover:text-ink">
          Privacy Policy
        </a>
      </p>
    </div>
  );
}
