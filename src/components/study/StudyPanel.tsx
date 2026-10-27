"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { deleteDeckAction } from "@/app/classes/[id]/study-actions";
import { AiConsentCard } from "@/components/account/AiConsent";
import { CardHeader } from "@/components/ui/CardHeader";
import { CardsIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { FlashcardMaker } from "./FlashcardMaker";
import { FlashcardStudy } from "./FlashcardStudy";
import { QuizletSheet } from "./QuizletSheet";
import { ChatGptStudyCard } from "./ChatGptStudyCard";
import type { ChatGptStudyInfo, StudyDeck, StudySourceOption } from "./study-types";

/**
 * The class page's Study tab: flashcards made from the class's own notes
 * (studied here or copied to Quizlet), and Study with ChatGPT.
 */
export function StudyPanel({
  classId,
  decks,
  sources,
  hasMaterial,
  aiAllowed,
  chatgpt,
  tz,
}: {
  classId: string;
  decks: StudyDeck[];
  sources: StudySourceOption[];
  /** Anything to make cards from: notes with text, lecture notes, or readable course files. */
  hasMaterial: boolean;
  aiAllowed: boolean;
  chatgpt: ChatGptStudyInfo;
  tz: string;
}) {
  const router = useRouter();
  const [studyingId, setStudyingId] = useState<string | null>(null);
  const [quizletId, setQuizletId] = useState<string | null>(null);
  const [making, setMaking] = useState(decks.length === 0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pendingNewDeck, setPendingNewDeck] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  // A new deck opens straight into studying once the refreshed page has it.
  useEffect(() => {
    if (pendingNewDeck && decks.some((d) => d.id === pendingNewDeck)) {
      setStudyingId(pendingNewDeck);
      setPendingNewDeck(null);
      setMaking(false);
    }
  }, [decks, pendingNewDeck]);

  const studying = decks.find((d) => d.id === studyingId) ?? null;
  const flashcardsRef = useRef<HTMLDivElement>(null);

  // The assistant sits above, so bring the card into view when studying starts or ends.
  useEffect(() => {
    if (studyingId) flashcardsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [studyingId]);
  const quizletDeck = decks.find((d) => d.id === quizletId) ?? null;

  function remove(deckId: string) {
    startDelete(async () => {
      await deleteDeckAction(deckId);
      setConfirmDelete(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div ref={flashcardsRef} className="scroll-mt-20 lg:scroll-mt-8">
        {studying ? (
          <FlashcardStudy
            key={studying.id}
            deck={studying}
            onExit={() => {
              setStudyingId(null);
              // Pick up the "Got it" marks saved while studying.
              router.refresh();
            }}
            onQuizlet={() => setQuizletId(studying.id)}
          />
        ) : (
          <section className="card card-pad">
            <CardHeader
              icon={<CardsIcon className="h-[18px] w-[18px]" />}
              title="Flashcards"
              description="Made from your notes, lecture notes and course files. Study them here, or copy them to Quizlet."
              action={
                decks.length > 0 && !making && aiAllowed && hasMaterial ? (
                  <button type="button" onClick={() => setMaking(true)} className="btn btn-secondary btn-sm">
                    <PlusIcon className="h-4 w-4" />
                    New deck
                  </button>
                ) : undefined
              }
            />

            {!aiAllowed ? (
              <div className="mt-5">
                <AiConsentCard reason="Flashcards are made with AI from your notes and course files." dismissible={false} />
              </div>
            ) : !hasMaterial ? (
              <div className="empty mt-5">
                Flashcards are made from what&apos;s in this class. Add a note, record a lecture, or add course files under
                Resources, and come back.
              </div>
            ) : (
              making && (
                <div className="mt-5">
                  <FlashcardMaker
                    classId={classId}
                    sources={sources}
                    onMade={(deckId) => setPendingNewDeck(deckId)}
                    onCancel={decks.length > 0 ? () => setMaking(false) : undefined}
                  />
                </div>
              )
            )}

            {decks.length > 0 && (
              <ul className={`divide-y divide-border-soft ${making || !aiAllowed || !hasMaterial ? "mt-6 border-t border-border-soft" : "mt-2"}`}>
                {decks.map((deck) => {
                  const learned = deck.cards.filter((c) => c.known).length;
                  return (
                    <li key={deck.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{deck.title}</p>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {deck.cards.length} cards · {learned} learned · {deck.source} · {formatInTimeZone(new Date(deck.createdAt), tz, "MMM d")}
                        </p>
                        {learned > 0 && (
                          <div className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                            <div className="h-full rounded-full bg-ok" style={{ width: `${(learned / deck.cards.length) * 100}%` }} />
                          </div>
                        )}
                      </div>
                      {confirmDelete === deck.id ? (
                        <div className="flex flex-none items-center gap-2">
                          <span className="text-xs text-ink-soft">Delete this deck?</span>
                          <button type="button" onClick={() => remove(deck.id)} disabled={deleting} className="btn btn-destructive btn-sm">
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="btn btn-ghost btn-sm">
                            Keep
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-none items-center gap-2">
                          <button type="button" onClick={() => setStudyingId(deck.id)} className="btn btn-primary btn-sm flex-1 sm:flex-none">
                            {learned > 0 && learned < deck.cards.length ? "Keep studying" : "Study"}
                          </button>
                          <button type="button" onClick={() => setQuizletId(deck.id)} className="btn btn-secondary btn-sm flex-1 sm:flex-none">
                            Copy to Quizlet
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(deck.id)}
                            aria-label={`Delete ${deck.title}`}
                            className="btn btn-ghost btn-sm w-8 px-0 hover:bg-danger-soft hover:text-danger"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {!studying && <ChatGptStudyCard info={chatgpt} />}

      {quizletDeck && <QuizletSheet deck={quizletDeck} onClose={() => setQuizletId(null)} />}
    </div>
  );
}
