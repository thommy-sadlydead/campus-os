"use client";

import { useState, useTransition, type FormEvent } from "react";
import { findTaskForMinutesAction, type MinutesModeResult } from "@/app/dashboard/actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { ClockIcon } from "@/components/icons";

export function MinutesMode() {
  const [minutes, setMinutes] = useState("30");
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
    <section className="card card-pad">
      <CardHeader
        icon={<ClockIcon className="h-[18px] w-[18px]" />}
        title="I have some time"
        description="Tell me how many minutes you've got — I'll find the highest-value thing that fits."
      />
      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <label className="relative w-28 flex-none">
          <span className="sr-only">Minutes</span>
          <input
            type="number"
            min={1}
            max={600}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="30"
            className="field pr-11 tabular-nums"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-ink-faint">
            min
          </span>
        </label>
        <button type="submit" disabled={pending} className="btn btn-secondary flex-1">
          {pending ? "Checking…" : "Find something"}
        </button>
      </form>

      {result && (
        <div className="mt-4 border-t border-border-soft pt-4 text-sm">
          {result.fits ? (
            <>
              <p className="font-semibold text-ink">{result.title}</p>
              <p className="text-[13px] text-ink-faint">{result.className}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{result.reason}</p>
            </>
          ) : (
            <p className="text-ink-soft">{result.message}</p>
          )}
        </div>
      )}
    </section>
  );
}
