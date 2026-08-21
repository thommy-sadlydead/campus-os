"use client";

import { useState, useTransition } from "react";
import { syncEmailAction } from "@/app/email/actions";

export function SyncButton({ lastSyncedLabel }: { lastSyncedLabel: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => startTransition(async () => setMessage((await syncEmailAction()).message))}
        disabled={pending}
        className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <span className="text-xs text-ink-faint">{message ?? lastSyncedLabel}</span>
    </div>
  );
}
