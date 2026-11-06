"use client";

import { useState, useTransition, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askCrossAppAction, type AskResult } from "@/app/dashboard/actions";
import { ArrowRightIcon, SparkIcon } from "@/components/icons";
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
    // The black card (white in dark mode): everything inside reads the inverted palette.
    <section className="card theme-inverse card-pad flex flex-col">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ink text-surface">
          <SparkIcon className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 className="font-display text-[19px] font-semibold leading-tight text-ink">Ask about everything</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            Looks through your classes, notes and course files first. Real data only, nothing invented.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setQuestion(s);
              ask(s);
            }}
            disabled={pending}
            className="chip border-ink-faint/60 text-ink hover:border-ink"
          >
            {s}
          </button>
        ))}
      </div>

      {pending ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-surface-2 p-3.5 text-sm text-ink-soft" role="status">
          <SparkIcon className="h-4 w-4 flex-none animate-pulse motion-reduce:animate-none" />
          Looking through your classes, notes and files… a study guide can take a minute or two.
        </div>
      ) : (
        result && (
          <div className="mt-4 rounded-xl bg-surface-2 p-3.5">
            <div className={MARKDOWN_CLASSNAME}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
            </div>
            <AnswerSources sources={result.sources} />
          </div>
        )
      )}

      {/* The question box sits at the bottom, with a round send button. */}
      <form onSubmit={onSubmit} className="mt-5 flex items-center gap-2 rounded-full border border-border bg-surface-2 p-1.5 pl-4">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything, like “help me study for my quiz tomorrow”"
          aria-label="Your question"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:shadow-none"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          aria-label="Ask"
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-ink text-surface transition-opacity disabled:opacity-40"
        >
          <ArrowRightIcon className="h-[18px] w-[18px]" />
        </button>
      </form>
    </section>
  );
}
