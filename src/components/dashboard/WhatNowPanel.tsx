"use client";

import { useState, useTransition } from "react";
import { whatShouldIDoRightNowAction, type WhatNowResult } from "@/app/dashboard/actions";
import { SparkIcon } from "@/components/icons";

/** One button under Today's headline; the pick opens below it. */
export function WhatNowPanel() {
  const [result, setResult] = useState<WhatNowResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section>
      <button
        onClick={() => startTransition(async () => setResult(await whatShouldIDoRightNowAction()))}
        disabled={pending}
        className="btn btn-primary w-full sm:w-auto"
      >
        <SparkIcon className="h-4 w-4" />
        {pending ? "Thinking…" : "What should I do now?"}
      </button>

      {result && (
        <div className="card mt-3 px-4 py-3.5">
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
    </section>
  );
}
