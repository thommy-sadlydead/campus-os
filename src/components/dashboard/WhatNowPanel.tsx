"use client";

import { useState, useTransition } from "react";
import { whatShouldIDoRightNowAction, type WhatNowResult } from "@/app/dashboard/actions";

export function WhatNowPanel() {
  const [result, setResult] = useState<WhatNowResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
      <button
        onClick={() => startTransition(async () => setResult(await whatShouldIDoRightNowAction()))}
        disabled={pending}
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Thinking…" : "What should I do right now?"}
      </button>

      {result && (
        <div className="mt-4 border-t border-border-soft pt-4">
          {!result.found ? (
            <p className="text-sm text-ink-soft">
              Nothing actionable on your list right now — you're caught up.
            </p>
          ) : (
            <>
              <p className="font-display text-lg font-semibold">{result.title}</p>
              <p className="text-sm text-ink-soft">{result.className}</p>
              <p className="mt-2 text-sm text-ink">{result.aiMessage ?? result.reason}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
