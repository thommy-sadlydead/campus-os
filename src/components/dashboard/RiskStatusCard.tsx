"use client";

import { useState, useTransition } from "react";
import { explainRiskAction } from "@/app/dashboard/actions";
import { RISK_EMOJI, RISK_LABEL, type RiskAssessment, type RiskLevel } from "@/lib/risk-engine";

const CARD_TONE: Record<RiskLevel, string> = {
  "on-track": "border-ok",
  "getting-behind": "border-warn bg-warn-soft/30",
  "at-risk": "border-danger bg-danger-soft/30",
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

  return (
    <div className={`mb-6 rounded-xl2 border bg-surface p-5 shadow-card ${CARD_TONE[risk.level]}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>
          {RISK_EMOJI[risk.level]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{RISK_LABEL[risk.level]}</div>
          <p className="mt-0.5 font-display text-lg font-semibold">{risk.headline}</p>

          {narrative ? (
            <p className="mt-2 text-sm leading-relaxed text-ink">{narrative}</p>
          ) : (
            <>
              {risk.reasons.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5 text-sm text-ink-soft">
                  {risk.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              {risk.recommendations.length > 0 && (
                <p className="mt-2 text-sm font-medium text-ink">{risk.recommendations[0]}</p>
              )}
            </>
          )}

          {risk.level !== "on-track" && (
            <button
              onClick={() => startTransition(async () => setNarrative((await explainRiskAction()).narrative))}
              disabled={pending}
              className="mt-3 text-xs font-medium text-accent hover:underline disabled:opacity-60"
            >
              {pending ? "Thinking…" : narrative ? "Refresh explanation" : "Explain in plain language"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
