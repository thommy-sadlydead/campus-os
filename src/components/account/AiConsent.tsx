"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { setAiConsentAction } from "@/app/account/actions";
import { AI_NOT_NOW_COOKIE } from "@/lib/ai-consent";

/** What's sent where. Shown wherever the student is asked to allow AI features. */
export function AiDisclosure() {
  return (
    <div className="flex flex-col gap-2 text-sm text-ink-soft">
      <p>Some Campus OS features use outside AI services. When you use one, Campus OS sends it what that feature needs:</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>
          <strong className="text-ink">Anthropic (Claude)</strong> gets your class content (notes, assignments,
          course files and lecture transcripts), your school emails, and what you type to the assistant or Voicewrite,
          to write notes, sort email, break down assignments and answer questions.
        </li>
        <li>
          <strong className="text-ink">AssemblyAI</strong> gets your lecture recordings, to write the transcripts.
        </li>
      </ul>
      <p>
        Nothing is sent to them until you allow it, and you can turn this off any time in Account. See the{" "}
        <Link href="/privacy" className="underline hover:text-ink">
          privacy policy
        </Link>
        .
      </p>
    </div>
  );
}

/** The one-time ask, on the dashboard and before recording. */
export function AiConsentCard({ reason, dismissible = true }: { reason?: string; dismissible?: boolean }) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  if (hidden) return null;

  function notNow() {
    setHidden(true);
    document.cookie = `${AI_NOT_NOW_COOKIE}=1; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
  }

  return (
    <section className="mb-6 rounded-xl2 border border-accent bg-surface p-5 shadow-card">
      <h2 className="font-display text-base font-semibold">Allow AI features?</h2>
      {reason && <p className="mt-1 text-sm text-ink">{reason}</p>}
      <div className="mt-3">
        <AiDisclosure />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => startTransition(() => setAiConsentAction(true))}
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Turning on…" : "Allow AI features"}
        </button>
        {dismissible && (
          <button onClick={notNow} disabled={pending} className="rounded-lg px-3 py-2.5 text-sm text-ink-soft hover:bg-surface-2">
            Not now
          </button>
        )}
      </div>
    </section>
  );
}

/** On the Account page: the current choice, and the switch. */
export function AiFeaturesSettings({ allowedSince }: { allowedSince: string | null }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 flex flex-col gap-4">
      <AiDisclosure />
      <p className="text-sm font-medium">{allowedSince ? `On since ${allowedSince}.` : "Off. Nothing is sent to AI services."}</p>
      <div>
        <button
          onClick={() => startTransition(() => setAiConsentAction(!allowedSince))}
          disabled={pending}
          className={
            allowedSince
              ? "rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
              : "rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-60"
          }
        >
          {pending ? "Saving…" : allowedSince ? "Turn off AI features" : "Allow AI features"}
        </button>
      </div>
    </div>
  );
}
