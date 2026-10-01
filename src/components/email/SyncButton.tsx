"use client";

import { useState, useTransition } from "react";
import { syncEmailAction } from "@/app/email/actions";
import { RefreshIcon } from "@/components/icons";

// One sync reads a limited number of new messages (see syncEmailAction), so
// a first sync or a busy week takes several. Keep going on its own, up to a
// point, rather than making the student press the button again and again.
const MAX_ROUNDS = 10;

const plural = (n: number) => (n === 1 ? "message" : "messages");

export function SyncButton({ lastSyncedLabel }: { lastSyncedLabel: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      let synced = 0;
      for (let round = 1; ; round++) {
        const result = await syncEmailAction();
        if (!result.ok) return setMessage(result.message);
        synced += result.fetched ?? 0;
        const left = result.remaining ?? 0;
        // Stop when done, when a round couldn't read anything (no point
        // retrying right away), or after MAX_ROUNDS.
        if (left === 0 || !result.fetched || round === MAX_ROUNDS) {
          if (round === 1) return setMessage(result.message);
          return setMessage(
            left === 0
              ? `Synced ${synced} new ${plural(synced)}.`
              : `Synced ${synced} new ${plural(synced)}, ${left} more to go. Sync again to continue.`
          );
        }
        setMessage(`Synced ${synced} so far, ${left} to go…`);
      }
    });
  }

  return (
    <div className="flex flex-row-reverse items-center gap-3 sm:flex-row">
      <span className="text-xs text-ink-faint" aria-live="polite">
        {message ?? lastSyncedLabel}
      </span>
      <button onClick={sync} disabled={pending} className="btn btn-primary">
        <RefreshIcon className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
