"use client";

import { useState, useTransition, type FormEvent } from "react";
import { askCrossAppAction, type AskResult } from "@/app/dashboard/actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { SparkIcon } from "@/components/icons";

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
    <section className="card card-pad">
      <CardHeader
        icon={<SparkIcon className="h-[18px] w-[18px]" />}
        title="Ask about everything"
        description="Considers all your classes at once — real data only, nothing invented."
      />

      <div className="mt-4 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setQuestion(s);
              ask(s);
            }}
            disabled={pending}
            className="chip"
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
          aria-label="Your question"
          className="field"
        />
        <button type="submit" disabled={pending} className="btn btn-primary flex-none">
          {pending ? "…" : "Ask"}
        </button>
      </form>

      {result && (
        <div className="mt-4 whitespace-pre-wrap rounded-lg bg-surface-2 p-3.5 text-sm leading-relaxed text-ink">{result.answer}</div>
      )}
    </section>
  );
}
