"use client";

import { useState, useTransition, type FormEvent } from "react";
import { findTaskForMinutesAction, type MinutesModeResult } from "@/app/dashboard/actions";

export function MinutesMode() {
  const [minutes, setMinutes] = useState("");
  const [result, setResult] = useState<MinutesModeResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) {
      setResult({ fits: false, message: "Enter a positive number of minutes." });
      return;
    }
    startTransition(async () => setResult(await findTaskForMinutesAction(n)));
  }

  return (
    <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
      <h3 className="font-display text-base font-semibold">I have some time</h3>
      <p className="mt-0.5 text-xs text-ink-faint">
        Tell me how many minutes you've got — I'll find the highest-value thing that fits.
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          type="number"
          min={1}
          max={600}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="30"
          className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <span className="flex items-center text-sm text-ink-soft">minutes</span>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Find something"}
        </button>
      </form>

      {result && (
        <div className="mt-4 border-t border-border-soft pt-4 text-sm">
          {result.fits ? (
            <>
              <p className="font-medium">{result.title}</p>
              <p className="text-ink-soft">{result.className}</p>
              <p className="mt-1 text-xs text-ink-faint">{result.reason}</p>
            </>
          ) : (
            <p className="text-ink-soft">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
