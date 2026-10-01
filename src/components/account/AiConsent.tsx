"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { setAiConsentAction } from "@/app/account/actions";
import { AI_NOT_NOW_COOKIE } from "@/lib/ai-consent";
import { SparkIcon } from "@/components/icons";

/** What's sent where. Shown wherever the student is asked to allow AI features. */
export function AiDisclosure() {
  return (
    <div className="flex flex-col gap-2 text-sm text-ink-soft">
      <p>Some Campus OS features use outside AI services. When you use one, Campus OS sends it what that feature needs:</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>
          <strong className="text-ink">Anthropic (Claude)</strong> gets your class content (notes, assignments,
          course files and lecture transcripts), your school emails, and what you type to the assistant,
          to write notes, sort email, break down assignments and answer questions.
        </li>
        <li>
          <strong className="text-ink">AssemblyAI</strong> gets your lecture recordings, to write the transcripts.
        </li>
      </ul>
      <p>
        Nothing is sent to them until you allow it, and you can turn this off any time in Account. See the{" "}
        <Link href="/privacy" className="font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
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
    <section className="card card-pad relative mb-6 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32"
        style={{
          background:
            "radial-gradient(70% 100% at 0% 0%, var(--glow-1), transparent 70%), radial-gradient(60% 100% at 100% 0%, var(--glow-2), transparent 70%)",
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-white"
            style={{ backgroundImage: "linear-gradient(135deg, var(--grad-from), var(--grad-to))" }}
          >
            <SparkIcon className="h-[18px] w-[18px]" />
          </span>
          <h2 className="text-base font-semibold text-ink">Allow AI features?</h2>
        </div>
        {reason && <p className="mt-3 text-sm font-medium text-ink">{reason}</p>}
        <div className="mt-3">
          <AiDisclosure />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={() => startTransition(() => setAiConsentAction(true))} disabled={pending} className="btn btn-primary">
            {pending ? "Turning on…" : "Allow AI features"}
          </button>
          {dismissible && (
            <button onClick={notNow} disabled={pending} className="btn btn-ghost">
              Not now
            </button>
          )}
        </div>
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
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <span aria-hidden className={`dot ${allowedSince ? "bg-ok" : "bg-ink-faint"}`} />
        {allowedSince ? `On since ${allowedSince}.` : "Off. Nothing is sent to AI services."}
      </p>
      <div>
        <button
          onClick={() => startTransition(() => setAiConsentAction(!allowedSince))}
          disabled={pending}
          className={allowedSince ? "btn btn-secondary" : "btn btn-primary"}
        >
          {pending ? "Saving…" : allowedSince ? "Turn off AI features" : "Allow AI features"}
        </button>
      </div>
    </div>
  );
}
