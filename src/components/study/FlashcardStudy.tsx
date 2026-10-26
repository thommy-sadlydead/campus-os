"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetDeckProgressAction, setFlashcardKnownAction } from "@/app/classes/[id]/study-actions";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, RefreshIcon, ShuffleIcon } from "@/components/icons";
import type { StudyDeck } from "./study-types";

function shuffled<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Studying one deck: tap (or Space) to flip, then "Still learning" or "Got
 * it". Arrow keys move between cards. Progress is saved as you go, so
 * "Study what's left" picks up where you stopped.
 */
export function FlashcardStudy({ deck, onExit, onQuizlet }: { deck: StudyDeck; onExit: () => void; onQuizlet: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [known, setKnown] = useState<Record<string, boolean>>(() => Object.fromEntries(deck.cards.map((c) => [c.id, c.known])));
  const [isShuffled, setIsShuffled] = useState(false);
  // The cards in this round. A round is everything, or only what's left to learn.
  const [round, setRound] = useState<string[]>(() => {
    const left = deck.cards.filter((c) => !c.known);
    return (left.length > 0 && left.length < deck.cards.length ? left : deck.cards).map((c) => c.id);
  });
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck.cards]);
  const learned = deck.cards.filter((c) => known[c.id]).length;
  const done = position >= round.length;
  const card = done ? null : byId.get(round[position]) ?? null;

  const go = useCallback(
    (next: number) => {
      setFlipped(false);
      setPosition(Math.max(0, Math.min(round.length, next)));
    },
    [round.length]
  );

  const mark = useCallback(
    (value: boolean) => {
      if (!card) return;
      setKnown((k) => ({ ...k, [card.id]: value }));
      startTransition(() => setFlashcardKnownAction(card.id, value));
      go(position + 1);
    },
    [card, go, position]
  );

  function startRound(ids: string[], shuffle = isShuffled) {
    setRound(shuffle ? shuffled(ids) : ids);
    setPosition(0);
    setFlipped(false);
  }

  function toggleShuffle() {
    const next = !isShuffled;
    setIsShuffled(next);
    // Reorder what's still ahead in this round; the cards already seen stay put.
    const ahead = round.slice(position);
    const ordered = next ? shuffled(ahead) : deck.cards.map((c) => c.id).filter((id) => ahead.includes(id));
    setRound([...round.slice(0, position), ...ordered]);
    setFlipped(false);
  }

  function startOver() {
    setKnown(Object.fromEntries(deck.cards.map((c) => [c.id, false])));
    startTransition(async () => {
      await resetDeckProgressAction(deck.id);
      router.refresh();
    });
    startRound(deck.cards.map((c) => c.id));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (done) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") go(position + 1);
      else if (e.key === "ArrowLeft") go(position - 1);
      else if (flipped && e.key === "1") mark(false);
      else if (flipped && e.key === "2") mark(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, flipped, go, mark, position]);

  const stillLearning = deck.cards.filter((c) => !known[c.id]).map((c) => c.id);
  const progress = round.length ? Math.min(position, round.length) / round.length : 0;

  return (
    <section className="card card-pad">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onExit} className="-ml-2 inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[13px] font-medium text-ink-faint hover:text-ink">
          <ChevronLeftIcon className="h-4 w-4" />
          All decks
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-pressed={isShuffled}
            className={`btn btn-sm ${isShuffled ? "btn-secondary text-accent-ink" : "btn-ghost"}`}
          >
            <ShuffleIcon className="h-4 w-4" />
            Shuffle
          </button>
          <button type="button" onClick={onQuizlet} className="btn btn-ghost btn-sm">
            Copy to Quizlet
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{deck.title}</h2>
          <p className="text-[13px] text-ink-faint">
            {learned} of {deck.cards.length} learned
          </p>
        </div>
        {!done && (
          <p className="flex-none text-sm tabular-nums text-ink-soft">
            {position + 1} / {round.length}
          </p>
        )}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
      </div>

      {card ? (
        <>
          <div className="mt-5 [perspective:1400px]">
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? `Answer: ${card.back}. Tap to see the question.` : `Question: ${card.front}. Tap to see the answer.`}
              className="relative block min-h-[15rem] w-full rounded-xl2 text-left outline-none transition-transform duration-500 [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none sm:min-h-[17rem]"
              style={{ transform: flipped ? "rotateY(180deg)" : "none" }}
            >
              <span className="absolute inset-0 flex flex-col rounded-xl2 border border-border bg-surface p-6 shadow-card [backface-visibility:hidden]">
                <span className="eyebrow">Question</span>
                <span className="flex flex-1 items-center justify-center py-4 text-center text-xl font-semibold leading-snug text-ink sm:text-2xl">
                  {card.front}
                </span>
                <span className="text-center text-xs text-ink-faint">Tap to flip</span>
              </span>
              <span className="absolute inset-0 flex flex-col rounded-xl2 border border-border bg-surface-2 p-6 shadow-card [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <span className="eyebrow">Answer</span>
                <span className="flex flex-1 items-center justify-center overflow-y-auto py-4 text-center text-base leading-relaxed text-ink sm:text-lg">
                  {card.back}
                </span>
                {known[card.id] && (
                  <span className="mx-auto inline-flex items-center gap-1 text-xs font-medium text-ok">
                    <CheckIcon className="h-3.5 w-3.5" />
                    Learned
                  </span>
                )}
              </span>
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => go(position - 1)} disabled={position === 0} aria-label="Previous card" className="btn btn-ghost w-10 px-0">
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            {flipped ? (
              <div className="grid flex-1 grid-cols-2 gap-2">
                <button type="button" onClick={() => mark(false)} className="btn btn-secondary">
                  Still learning
                </button>
                <button type="button" onClick={() => mark(true)} className="btn btn-primary">
                  <CheckIcon className="h-4 w-4" />
                  Got it
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setFlipped(true)} className="btn btn-secondary flex-1">
                Show answer
              </button>
            )}
            <button type="button" onClick={() => go(position + 1)} aria-label="Next card" className="btn btn-ghost w-10 px-0">
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-3 hidden text-center text-xs text-ink-faint lg:block">
            Space to flip · ← → to move · 1 still learning · 2 got it
          </p>
        </>
      ) : (
        <div className="mt-6 rounded-xl2 bg-surface-2 px-5 py-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok">
            <CheckIcon className="h-6 w-6" />
          </span>
          <p className="mt-3 text-base font-semibold text-ink">
            {stillLearning.length === 0 ? "You've learned every card" : "Round done"}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {learned} of {deck.cards.length} learned
            {stillLearning.length > 0 ? `, ${stillLearning.length} still to learn.` : "."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {stillLearning.length > 0 && (
              <button type="button" onClick={() => startRound(stillLearning)} className="btn btn-primary">
                Study the {stillLearning.length} left
              </button>
            )}
            <button type="button" onClick={startOver} className="btn btn-secondary">
              <RefreshIcon className="h-4 w-4" />
              Start over
            </button>
            <button type="button" onClick={onExit} className="btn btn-ghost">
              All decks
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
