"use client";

import { useState, useTransition } from "react";
import { explainRiskAction } from "@/app/dashboard/actions";
import type { RiskAssessment, RiskLevel } from "@/lib/risk-engine";
import { AlertIcon, ArrowRightIcon, CheckCircleIcon, ChevronDownIcon, ClockIcon, SparkIcon } from "@/components/icons";

const LEVEL_ICON: Record<RiskLevel, (props: { className?: string }) => React.ReactElement> = {
  "on-track": CheckCircleIcon,
  "getting-behind": ClockIcon,
  "at-risk": AlertIcon,
};

/**
 * The Behind/At-Risk status under Today's headline: one quiet line that
 * opens to the reasons and the top recommendation. The level, headline,
 * reasons, and recommendation are all computed deterministically
 * server-side (src/lib/risk-engine.ts) and passed in already resolved — this
 * never blocks on AI. "Explain in plain language" is a pure polish layer on
 * top: it re-narrates the same facts in flowing sentences via
 * explainRiskAction, and falls back to the deterministic wording if no API
 * key is configured.
 */
export function RiskStatusCard({ risk }: { risk: RiskAssessment }) {
  const [open, setOpen] = useState(false);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const Icon = LEVEL_ICON[risk.level];
  const hasDetails = risk.level !== "on-track" && (risk.reasons.length > 0 || risk.recommendations.length > 0);

  const line = (
    <>
      <Icon className="mt-0.5 h-4 w-4 flex-none text-ink" />
      <span className="flex-1">{risk.headline}</span>
    </>
  );

  return (
    <section className="text-[14px] font-medium leading-snug text-ink">
      {hasDetails ? (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
          {line}
          <ChevronDownIcon className={`mt-0.5 h-4 w-4 flex-none text-ink-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      ) : (
        <p className="flex items-start gap-2">{line}</p>
      )}

      {open && (
        <div className="mt-3 pl-6 font-normal text-ink-soft">
          {narrative ? (
            <p className="leading-relaxed">{narrative}</p>
          ) : (
            <>
              {risk.reasons.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {risk.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span aria-hidden className="mt-[0.5rem] h-1 w-1 flex-none rounded-full bg-ink-faint" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              {risk.recommendations.length > 0 && (
                <p className="mt-3 flex gap-2.5 font-medium text-ink">
                  <ArrowRightIcon className="mt-0.5 h-4 w-4 flex-none" />
                  {risk.recommendations[0]}
                </p>
              )}
            </>
          )}
          <button
            onClick={() => startTransition(async () => setNarrative((await explainRiskAction()).narrative))}
            disabled={pending}
            className="btn btn-ghost btn-sm -ml-3 mt-1 font-semibold text-ink"
          >
            <SparkIcon className="h-4 w-4" />
            {pending ? "Thinking…" : narrative ? "Refresh explanation" : "Explain in plain language"}
          </button>
        </div>
      )}
    </section>
  );
}
