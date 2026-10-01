"use client";

import { useState, useTransition, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askClassAssistantAction, type ClassAssistantResult } from "@/app/classes/[id]/ai-actions";
import { MARKDOWN_CLASSNAME } from "@/lib/markdown";
import { SparkIcon } from "@/components/icons";

const QUICK_ACTIONS: Array<{ key: string; label: string }> = [
  { key: "whats-due-next", label: "What is due next?" },
  { key: "summarize-notes", label: "Summarize my notes" },
  { key: "study-guide", label: "Make a study guide" },
  { key: "quiz-me", label: "Quiz me" },
  { key: "whats-missing", label: "What am I missing?" },
  { key: "prepare-exam", label: "Prepare me for my next exam" },
];

export function ClassAssistant({ classId, className }: { classId: string; className: string }) {
  const [result, setResult] = useState<ClassAssistantResult | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();

  function runQuick(key: string) {
    startTransition(async () => setResult(await askClassAssistantAction(classId, { quickAction: key })));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    startTransition(async () => setResult(await askClassAssistantAction(classId, { question })));
  }

  return (
    <section className="card card-pad relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28"
        style={{
          background:
            "radial-gradient(60% 100% at 0% 0%, var(--glow-1), transparent 70%), radial-gradient(50% 100% at 100% 0%, var(--glow-2), transparent 70%)",
        }}
      />
      <div className="relative flex items-start gap-3">
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-white"
          style={{ backgroundImage: "linear-gradient(135deg, var(--grad-from), var(--grad-to))" }}
        >
          <SparkIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-snug text-ink">Ask about {className}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-faint">
            Scoped to this class only — your notes, assignments, exams, resources, lecture notes, books/slides, and any
            relevant emails.
          </p>
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => runQuick(a.key)}
            disabled={pending}
            className="chip"
          >
            {a.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="relative mt-3 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Or ask anything else about this class…"
          aria-label="Your question"
          className="field w-full"
        />
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary flex-none"
        >
          {pending ? "…" : "Ask"}
        </button>
      </form>

      {result && (
        <div className={`relative mt-4 rounded-lg bg-surface-2 p-4 ${MARKDOWN_CLASSNAME}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}
