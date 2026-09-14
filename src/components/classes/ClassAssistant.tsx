"use client";

import { useState, useTransition, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askClassAssistantAction, type ClassAssistantResult } from "@/app/classes/[id]/ai-actions";
import { MARKDOWN_CLASSNAME } from "@/lib/markdown";

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
    <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
      <h3 className="font-display text-base font-semibold">Ask about {className}</h3>
      <p className="mt-0.5 text-xs text-ink-faint">
        Scoped to this class only — your notes, assignments, exams, resources, lecture notes, books/slides, and any
        relevant emails.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => runQuick(a.key)}
            disabled={pending}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-60"
          >
            {a.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Or ask anything else about this class…"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex-none rounded-lg bg-ink px-4 py-2 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "…" : "Ask"}
        </button>
      </form>

      {result && (
        <div className={`mt-4 rounded-lg bg-surface-2 p-3 ${MARKDOWN_CLASSNAME}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
