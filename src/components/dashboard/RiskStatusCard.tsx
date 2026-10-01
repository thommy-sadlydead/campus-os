"use client";

import { useState, useTransition } from "react";
import { explainRiskAction } from "@/app/dashboard/actions";
import type { RiskAssessment, RiskLevel } from "@/lib/risk-engine";
import { RISK_TONE, RiskBadge } from "@/components/ui/RiskBadge";
import { AlertIcon, ArrowRightIcon, CheckCircleIcon, ClockIcon, SparkIcon } from "@/components/icons";

const LEVEL_ICON: Record<RiskLevel, (props: { className?: string }) => React.ReactElement> = {
  "on-track": CheckCircleIcon,
  "getting-behind": ClockIcon,
  "at-risk": AlertIcon,
};

/**
 * The prominent Behind/At-Risk status at the top of the dashboard. The
 * level, headline, reasons, and top recommendation are all computed
 * deterministically server-side (src/lib/risk-engine.ts) and passed in
 * already resolved — this card never blocks on AI. "Explain in plain
 * language" is a pure polish layer on top: it re-narrates the same facts
 * in flowing sentences via explainRiskAction, and falls back to the
 * deterministic wording if no API key is configured.
 */
export function RiskStatusCard({ risk }: { risk: RiskAssessment }) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const Icon = LEVEL_ICON[risk.level];

  return (
    <section className="card card-pad mb-6">
      <div className="flex items-start gap-4">
        <span className={`hidden h-11 w-11 flex-none items-center justify-center rounded-xl sm:flex ${RISK_TONE[risk.level]}`}>
          <Icon className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0 flex-1">
          <RiskBadge level={risk.level} />
          <h2 className="mt-2.5 font-display text-lg font-semibold leading-snug text-ink sm:text-xl">{risk.headline}</h2>

          {narrative ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{narrative}</p>
          ) : (
            <>
              {risk.reasons.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink-soft">
                  {risk.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span aria-hidden className="mt-[0.55rem] h-1 w-1 flex-none rounded-full bg-ink-faint" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              {risk.recommendations.length > 0 && (
                <div className="mt-4 flex gap-2.5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm font-medium text-ink">
                  <ArrowRightIcon className="mt-0.5 h-4 w-4 flex-none text-accent" />
                  <p>{risk.recommendations[0]}</p>
                </div>
              )}
            </>
          )}

          {risk.level !== "on-track" && (
            <button
              onClick={() => startTransition(async () => setNarrative((await explainRiskAction()).narrative))}
              disabled={pending}
              className="btn btn-ghost btn-sm -ml-3 mt-2 text-accent-ink hover:text-accent-ink"
            >
              <SparkIcon className="h-4 w-4" />
              {pending ? "Thinking…" : narrative ? "Refresh explanation" : "Explain in plain language"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
