"use client";

import { useState, useTransition, type FormEvent } from "react";
import { askCrossAppAction, type AskResult } from "@/app/dashboard/actions";

const SUGGESTIONS = ["What should I do tonight?", "Am I going to be screwed next week?", "What's due this week?"];

export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(q: string) {
    if (!q.trim()) return;
    startTransition(async () => setResult(await askCrossAppAction(q)));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    ask(question);
  }

  return (
    <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
      <h3 className="font-display text-base font-semibold">Ask about everything</h3>
      <p className="mt-0.5 text-xs text-ink-faint">Considers all your classes at once — real data only, nothing invented.</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setQuestion(s);
              ask(s);
            }}
            disabled={pending}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-60"
          >
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about your workload…"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex-none rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "…" : "Ask"}
        </button>
      </form>

      {result && <div className="mt-4 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm leading-relaxed">{result.answer}</div>}
    </div>
  );
}
