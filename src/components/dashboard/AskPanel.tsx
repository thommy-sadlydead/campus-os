"use client";

import { useState, useTransition, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askCrossAppAction, type AskResult } from "@/app/dashboard/actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { SparkIcon } from "@/components/icons";
import { MARKDOWN_CLASSNAME } from "@/lib/markdown";
import { AnswerSources } from "@/components/AnswerSources";

const SUGGESTIONS = ["What should I do tonight?", "Help me study for my next quiz", "What's due this week?"];

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
        description="Looks through all your classes, notes and course files first — real data only, nothing invented."
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
          placeholder="Ask anything, like “help me study for my quiz tomorrow”…"
          aria-label="Your question"
          className="field"
        />
        <button type="submit" disabled={pending} className="btn btn-primary flex-none">
          {pending ? "…" : "Ask"}
        </button>
      </form>

      {pending ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-surface-2 p-3.5 text-sm text-ink-soft" role="status">
          <SparkIcon className="h-4 w-4 flex-none animate-pulse text-accent motion-reduce:animate-none" />
          Looking through your classes, notes and files… a study guide can take a minute or two.
        </div>
      ) : (
        result && (
          <div className="mt-4 rounded-lg bg-surface-2 p-3.5">
            <div className={MARKDOWN_CLASSNAME}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
            </div>
            <AnswerSources sources={result.sources} />
          </div>
        )
      )}
    </section>
  );
}
