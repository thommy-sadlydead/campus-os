"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateFlashcardsAction } from "@/app/classes/[id]/study-actions";
import { DEFAULT_FLASHCARD_COUNT, FLASHCARD_COUNTS } from "@/lib/flashcards";
import { SparkIcon } from "@/components/icons";
import type { StudySourceOption } from "./study-types";

const STAGES = [
  { after: 0, text: "Reading your notes…" },
  { after: 5, text: "Writing your flashcards…" },
  { after: 30, text: "Almost done…" },
];

/** "Make flashcards": what from, how many, an optional focus. Takes about a minute. */
export function FlashcardMaker({
  classId,
  sources,
  onMade,
  onCancel,
}: {
  classId: string;
  sources: StudySourceOption[];
  onMade: (deckId: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [source, setSource] = useState("all");
  const [count, setCount] = useState<number>(DEFAULT_FLASHCARD_COUNT);
  const [focus, setFocus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!pending) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  function make() {
    setError(null);
    startTransition(async () => {
      const result = await generateFlashcardsAction(classId, { source, count, focus: focus.trim() || undefined });
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.deckId) {
        router.refresh();
        onMade(result.deckId);
      }
    });
  }

  if (pending) {
    const stage = [...STAGES].reverse().find((s) => elapsed >= s.after) ?? STAGES[0];
    return (
      <div className="rounded-xl2 bg-surface-2 px-5 py-6 text-center" role="status" aria-live="polite">
        <SparkIcon className="mx-auto h-6 w-6 animate-pulse text-accent" />
        <p className="mt-3 text-sm font-medium text-ink">{stage.text}</p>
        <p className="mt-1 text-xs text-ink-faint">This usually takes under a minute. You can keep this tab open.</p>
        <div className="mx-auto mt-4 h-1 w-40 overflow-hidden rounded-full bg-border">
          <div className="h-full w-1/3 animate-[study-progress_1.4s_ease-in-out_infinite] rounded-full bg-accent motion-reduce:animate-none" />
        </div>
      </div>
    );
  }

  const groups = (["Notes", "Lecture notes", "Course files"] as const)
    .map((g) => ({ g, items: sources.filter((s) => s.group === g) }))
    .filter((x) => x.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <label htmlFor="flashcard-source" className="field-label">
            Make them from
          </label>
          <select id="flashcard-source" value={source} onChange={(e) => setSource(e.target.value)} className="field">
            <option value="all">Everything in this class</option>
            {groups.map(({ g, items }) => (
              <optgroup key={g} label={g}>
                {items.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <span className="field-label" id="flashcard-count-label">
            Cards
          </span>
          <div role="radiogroup" aria-labelledby="flashcard-count-label" className="flex rounded-lg border border-border bg-surface p-0.5 shadow-sm">
            {FLASHCARD_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                onClick={() => setCount(n)}
                className={`min-h-[2.25rem] flex-1 rounded-md px-3.5 text-sm font-medium tabular-nums transition-colors sm:flex-none ${
                  count === n ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label htmlFor="flashcard-focus" className="field-label">
          Focus on <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="flashcard-focus"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          maxLength={80}
          placeholder="e.g. Exam 2, or the chain rule"
          className="field"
        />
      </div>

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={make} className="btn btn-primary">
          <SparkIcon className="h-4 w-4" />
          Make flashcards
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
