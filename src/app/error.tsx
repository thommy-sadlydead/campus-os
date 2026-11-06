"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Shown instead of Next.js's bare "Application error" when a page fails on
// the server, say the database didn't answer for a moment (Nov 6, 2026).
// Try again re-requests the page.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-5 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-ink">
      <div className="w-full max-w-sm">
        <p className="display-num text-[72px] text-ink-faint">!</p>
        <h1 className="mt-4 font-display text-[28px] font-bold leading-tight">This page didn&apos;t load</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          Campus OS couldn&apos;t finish loading it just now. Your classes and notes are safe. Try again in a moment.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
          className="btn btn-primary btn-lg mt-6 w-full"
        >
          {pending ? "Loading…" : "Try again"}
        </button>
        {error.digest && <p className="mt-4 text-center text-[11px] text-ink-faint">Error {error.digest}</p>}
      </div>
    </div>
  );
}
