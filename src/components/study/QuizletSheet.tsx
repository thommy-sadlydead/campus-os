"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyToClipboard } from "@/lib/clipboard";
import { QUIZLET_CREATE_URL, quizletImportText } from "@/lib/flashcards";
import { CheckIcon, CopyIcon, ExternalIcon, XIcon } from "@/components/icons";
import type { StudyDeck } from "./study-types";

/**
 * Sends a deck to Quizlet. Quizlet has no way for other apps to create sets,
 * so this is its own import: copy the cards (in the format Quizlet's
 * "Import" box reads by default), open a new set, paste.
 */
export function QuizletSheet({ deck, onClose }: { deck: StudyDeck; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [showText, setShowText] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const text = quizletImportText(deck.cards);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  async function copy() {
    const ok = await copyToClipboard({ text });
    setCopied(ok);
    if (!ok) setShowText(true);
  }

  const step = (n: number, done: boolean) => (
    <span
      className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-semibold ${
        done ? "bg-ok-soft text-ok" : "bg-surface-2 text-ink-soft"
      }`}
    >
      {done ? <CheckIcon className="h-4 w-4" /> : n}
    </span>
  );

  // Rendered into <body>: inside the page's content layer, the phone tab bar
  // (MobileNav) would sit on top of the sheet.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="quizlet-title">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 h-full w-full bg-black/40 backdrop-blur-[2px]" tabIndex={-1} />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[28px] border-t border-border-soft bg-surface px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 shadow-pop sm:rounded-2xl sm:border sm:pb-6 sm:pt-6">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="quizlet-title" className="text-lg font-semibold text-ink">
              Copy to Quizlet
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Make &ldquo;{deck.title}&rdquo; a Quizlet set in three steps. You&apos;ll need a free Quizlet account.
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost -mr-2 -mt-1 w-9 px-0">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <ol className="mt-5 flex flex-col gap-4">
          <li className="flex gap-3">
            {step(1, copied === true)}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-ink">Copy your {deck.cards.length} cards</p>
              <button type="button" onClick={copy} className="btn btn-primary btn-sm mt-2">
                {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                {copied ? "Copied" : "Copy cards"}
              </button>
              {copied === false && <p className="mt-2 text-xs text-danger">Your device didn&apos;t allow copying. Select the text below and copy it.</p>}
            </div>
          </li>
          <li className="flex gap-3">
            {step(2, false)}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-ink">Open a new Quizlet set</p>
              <a href={QUIZLET_CREATE_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm mt-2">
                Open Quizlet
                <ExternalIcon className="h-3.5 w-3.5" />
              </a>
            </div>
          </li>
          <li className="flex gap-3">
            {step(3, false)}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-ink">Tap Import, paste, then Import</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                Leave Quizlet&apos;s settings on <strong className="font-medium text-ink">Tab</strong> and{" "}
                <strong className="font-medium text-ink">New line</strong>. Add a title and tap Create.
              </p>
            </div>
          </li>
        </ol>

        <button type="button" onClick={() => setShowText((s) => !s)} className="mt-5 text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
          {showText ? "Hide the text" : "Show the text instead"}
        </button>
        {showText && (
          <textarea
            readOnly
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Cards in Quizlet's import format"
            className="field mt-2 h-32 font-mono text-xs"
          />
        )}
      </div>
    </div>,
    document.body
  );
}
