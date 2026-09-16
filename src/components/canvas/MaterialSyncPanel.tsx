"use client";

import { useEffect, useState } from "react";
import {
  continueCanvasMaterialSyncAction,
  startCanvasMaterialSyncAction,
  type CourseSyncProgress,
} from "@/app/canvas/actions";

const POLL_INTERVAL_MS = 3000;

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Queued",
  DISCOVERING: "Scanning materials…",
  DOWNLOADING: "Importing materials…",
  READY: "Synced",
  PARTIAL: "Partially synced",
  FAILED: "Sync failed",
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-surface-2 text-ink-soft",
  DISCOVERING: "bg-warn-soft text-warn",
  DOWNLOADING: "bg-warn-soft text-warn",
  READY: "bg-ok-soft text-ok",
  PARTIAL: "bg-warn-soft text-warn",
  FAILED: "bg-danger-soft text-danger",
};

function isTerminal(status: string): boolean {
  return status === "READY" || status === "PARTIAL" || status === "FAILED";
}

/**
 * Self-contained, like SyncButton — fetches its own status via server
 * actions rather than taking server-rendered props, so this can just be
 * dropped onto the Canvas page. Polls automatically whenever any course
 * isn't in a terminal state yet: right after a fresh Canvas connect (see
 * connectCanvasAction, which queues every course before this ever mounts),
 * and also on every later page visit, so a sync interrupted by a closed
 * tab picks back up instead of staying stuck.
 */
export function MaterialSyncPanel() {
  const [courses, setCourses] = useState<CourseSyncProgress[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    // Self-scheduling, not setInterval — one tick can take a while (a file
    // download + text extraction), and firing the next tick before the
    // previous one resolves would let ticks overlap and each grab their
    // own course chunk concurrently, uncoordinated. Waiting for one poll
    // to fully resolve before scheduling the next guarantees only one
    // chunk of work is ever in flight. Same pattern as LecturesPanel's
    // lecture-status polling.
    async function pollOnce() {
      let result: CourseSyncProgress[];
      try {
        result = await continueCanvasMaterialSyncAction();
      } catch (err) {
        // A single tick can fail transiently (e.g. a momentary database
        // connection hiccup — confirmed live under sustained load) without
        // the underlying sync actually being broken; the next tick's fresh
        // discovery-and-plan picks up exactly where the last one left off
        // either way. Retrying after the normal interval, instead of
        // letting the poll loop die here, is what makes that self-healing
        // actually reach the UI instead of leaving it stuck on "Syncing…"
        // forever with no further progress.
        console.error("Canvas materials sync poll failed, will retry:", err);
        if (cancelled) return;
        timeoutId = setTimeout(pollOnce, POLL_INTERVAL_MS);
        return;
      }
      if (cancelled) return;
      setCourses(result);
      if (result.some((c) => !isTerminal(c.status))) {
        timeoutId = setTimeout(pollOnce, POLL_INTERVAL_MS);
      }
    }

    pollOnce();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [generation]);

  async function handleStart() {
    setStarting(true);
    try {
      await startCanvasMaterialSyncAction();
      setGeneration((g) => g + 1); // re-enters the effect above, restarting polling
    } finally {
      setStarting(false);
    }
  }

  const polling = courses !== null && courses.some((c) => !isTerminal(c.status));

  return (
    <div className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Course materials</h4>
          <p className="mt-0.5 text-xs text-ink-faint">
            Automatically finds and imports books, slides, syllabi, and other documents from each course in Canvas.
          </p>
        </div>
        <button
          onClick={handleStart}
          disabled={starting || polling}
          className="flex-none rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
        >
          {polling ? "Syncing…" : starting ? "Starting…" : "Go fetch materials"}
        </button>
      </div>

      {courses === null ? (
        <p className="mt-3 text-xs text-ink-faint">Checking sync status…</p>
      ) : courses.length === 0 ? (
        <p className="mt-3 text-xs text-ink-faint">No Canvas courses to sync yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {courses.map((c) => (
            <li key={c.classId} className="flex items-center gap-3 rounded-lg border border-border-soft bg-bg p-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.className}</div>

                {(c.status === "PENDING" || c.status === "DISCOVERING" || c.status === "DOWNLOADING") && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{
                        width: c.resourcesFound > 0 ? `${Math.round((c.resourcesDone / c.resourcesFound) * 100)}%` : "8%",
                      }}
                    />
                  </div>
                )}

                {c.resourcesFound > 0 && c.status !== "PENDING" && c.status !== "DISCOVERING" && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {c.resourcesDone} / {c.resourcesFound} materials
                    {c.resourcesFailed > 0 ? ` (${c.resourcesFailed} failed)` : ""}
                  </p>
                )}

                {c.status === "FAILED" && c.errorMessage && <p className="mt-0.5 text-xs text-danger">{c.errorMessage}</p>}
              </div>
              <span
                className={`flex-none rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[c.status] ?? "bg-surface-2 text-ink-soft"}`}
              >
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
