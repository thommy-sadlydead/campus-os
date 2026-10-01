"use client";

import { useState, useTransition } from "react";
import { syncCanvasAction } from "@/app/canvas/actions";
import { RefreshIcon } from "@/components/icons";

export function SyncButton({ lastSyncedLabel }: { lastSyncedLabel: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-row-reverse items-center gap-3 sm:flex-row">
      <span className="text-xs text-ink-faint" aria-live="polite">
        {message ?? lastSyncedLabel}
      </span>
      <button
        onClick={() => startTransition(async () => setMessage((await syncCanvasAction()).message))}
        disabled={pending}
        className="btn btn-primary"
      >
        <RefreshIcon className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
