"use client";

import { useState, useTransition } from "react";
import { whatShouldIDoRightNowAction, type WhatNowResult } from "@/app/dashboard/actions";
import { SparkIcon } from "@/components/icons";

export function WhatNowPanel() {
  const [result, setResult] = useState<WhatNowResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="card card-pad relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 70% at 0% 0%, var(--glow-1), transparent 70%), radial-gradient(80% 70% at 100% 0%, var(--glow-2), transparent 70%)",
        }}
      />
      <div className="relative">
        <div className="flex items-start gap-3">
          <span
            className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-white"
            style={{ backgroundImage: "linear-gradient(135deg, var(--grad-from), var(--grad-to))" }}
          >
            <SparkIcon className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold leading-snug text-ink">Your next step</h2>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-faint">One pick from everything on your list.</p>
          </div>
        </div>
        <button
          onClick={() => startTransition(async () => setResult(await whatShouldIDoRightNowAction()))}
          disabled={pending}
          className="btn btn-primary mt-4 w-full"
        >
          {pending ? "Thinking…" : "What should I do right now?"}
        </button>

        {result && (
          <div className="mt-4 border-t border-border-soft pt-4">
            {!result.found ? (
              <p className="text-sm text-ink-soft">Nothing actionable on your list right now — you're caught up.</p>
            ) : (
              <>
                <p className="text-base font-semibold leading-snug text-ink">{result.title}</p>
                <p className="mt-0.5 text-[13px] text-ink-faint">{result.className}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{result.aiMessage ?? result.reason}</p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
