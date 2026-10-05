"use client";

import { useState, useTransition } from "react";
import { RefreshIcon } from "@/components/icons";

/** "Sync now" for any connected LMS; `action` is that LMS's sync Server Action. */
export function SyncButton({
  action,
  lastSyncedLabel,
}: {
  action: () => Promise<{ ok: boolean; message: string }>;
  lastSyncedLabel: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-row-reverse items-center gap-3 sm:flex-row">
      <span className="text-xs text-ink-faint" aria-live="polite">
        {message ?? lastSyncedLabel}
      </span>
      <button
        onClick={() => startTransition(async () => setMessage((await action()).message))}
        disabled={pending}
        className="btn btn-primary"
      >
        <RefreshIcon className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
