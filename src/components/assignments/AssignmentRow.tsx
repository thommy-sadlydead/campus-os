"use client";

import { useState, useTransition } from "react";
import { toggleWorkItemAction } from "@/app/dashboard/actions";
import { breakdownAssignmentAction } from "@/app/assignments/actions";
import { formatDueLabel, formatMinutes } from "@/lib/time";
import { stripHtml } from "@/lib/text";

export interface AssignmentRowTask {
  id: string;
  title: string;
  estimatedMinutes: number | null;
  completed: boolean;
}

export type AssignmentRowStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED";

export interface AssignmentRowData {
  id: string;
  name: string;
  dueAt: string | null;
  estimatedMinutes: number | null;
  status: AssignmentRowStatus;
  tasks: AssignmentRowTask[];
  /** Raw HTML from Canvas, or null (added by hand / not synced). Rendered with stripHtml(). */
  description: string | null;
  /** "See in Canvas" link, or null when this assignment has no known Canvas id. */
  canvasUrl: string | null;
}

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentRowStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  GRADED: "Graded",
};

export const ASSIGNMENT_STATUS_TONE: Record<AssignmentRowStatus, string> = {
  NOT_STARTED: "bg-surface-2 text-ink-soft",
  IN_PROGRESS: "bg-warn-soft text-warn",
  SUBMITTED: "bg-ok-soft text-ok",
  GRADED: "bg-ok-soft text-ok",
};

/**
 * One assignment table row, interactive. Shared by the global Assignments
 * page and the per-class Assignments panel — pass `classLabel` to render an
 * extra "Class" column (global page only) and `columnCount` so the
 * expanded subtask row's colSpan matches whichever table it's in.
 *
 * Things that live here beyond a static table row:
 *  - Clicking the assignment name expands a details panel: the real
 *    Canvas description (stripped to plain text — see stripHtml) with a
 *    "No description on Canvas" fallback when there isn't one, a "See in
 *    Canvas ↗" link when we know the Canvas assignment id, and — if any
 *    subtasks exist — the checklist below.
 *  - "Break down with AI" — calls breakdownAssignmentAction (Phase 3),
 *    which either creates real Task rows (revalidated from the server, so
 *    this row picks them up automatically) or reports back that the
 *    assignment was too small to bother splitting.
 *  - The subtask checklist reuses the same toggleWorkItemAction the
 *    dashboard's priority list already uses, so checking a step off here
 *    and checking it off from the dashboard are the same action.
 */
export function AssignmentRow({
  assignment,
  tz,
  classLabel,
  columnCount,
}: {
  assignment: AssignmentRowData;
  tz: string;
  classLabel?: string;
  columnCount: number;
}) {
  const now = new Date();
  const [tasks, setTasks] = useState(assignment.tasks);
  const [expanded, setExpanded] = useState(false);
  const [breakdownMessage, setBreakdownMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remaining = tasks.filter((t) => !t.completed).length;

  function runBreakdown() {
    startTransition(async () => {
      const result = await breakdownAssignmentAction(assignment.id);
      setBreakdownMessage(result.message);
      if (result.stepCount > 0) setExpanded(true);
    });
  }

  function toggleTask(taskId: string) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t)));
    startTransition(() => toggleWorkItemAction("task", taskId));
  }

  const description = assignment.description ? stripHtml(assignment.description) : "";

  return (
    <>
      <tr className="border-b border-border-soft last:border-0">
        <td className="px-4 py-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-left font-medium hover:underline"
          >
            <span aria-hidden className="mr-1 text-ink-faint">{expanded ? "▾" : "▸"}</span>
            {assignment.name}
          </button>
          {tasks.length > 0 ? (
            <div className="mt-0.5 text-xs text-ink-faint">
              {remaining} of {tasks.length} step{tasks.length === 1 ? "" : "s"} left
            </div>
          ) : breakdownMessage ? (
            <div className="mt-0.5 text-xs text-ink-faint">{breakdownMessage}</div>
          ) : (
            <button
              onClick={runBreakdown}
              disabled={pending}
              className="mt-0.5 text-xs font-medium text-accent hover:underline disabled:opacity-60"
            >
              {pending ? "Breaking down…" : "Break down with AI"}
            </button>
          )}
        </td>
        {classLabel != null && <td className="px-4 py-3 text-ink-soft">{classLabel}</td>}
        <td className="px-4 py-3 text-ink-soft">
          {formatDueLabel(assignment.dueAt ? new Date(assignment.dueAt) : null, now, tz)}
        </td>
        <td className="px-4 py-3 font-mono text-ink-soft">
          {assignment.estimatedMinutes != null ? formatMinutes(assignment.estimatedMinutes) : "—"}
        </td>
        <td className="px-4 py-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ASSIGNMENT_STATUS_TONE[assignment.status]}`}>
            {ASSIGNMENT_STATUS_LABEL[assignment.status]}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border-soft bg-surface-2/40 last:border-0">
          <td colSpan={columnCount} className="px-4 py-4">
            <div className="mb-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Directions</div>
              <p className="whitespace-pre-wrap text-sm text-ink-soft">
                {description || "No description on file for this assignment — Canvas didn't provide one, or it hasn't synced yet."}
              </p>
              {assignment.canvasUrl && (
                <a
                  href={assignment.canvasUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
                >
                  See in Canvas ↗
                </a>
              )}
            </div>
            {tasks.length > 0 && (
              <ul className="space-y-1.5">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 text-sm">
                    <button
                      aria-label={t.completed ? "Mark step incomplete" : "Mark step complete"}
                      disabled={pending}
                      onClick={() => toggleTask(t.id)}
                      className={`flex h-4 w-4 flex-none items-center justify-center rounded border-2 text-[10px] leading-none transition-colors ${
                        t.completed ? "border-ok bg-ok text-surface" : "border-border text-transparent hover:border-ok"
                      }`}
                    >
                      ✓
                    </button>
                    <span className={t.completed ? "flex-1 text-ink-faint line-through" : "flex-1"}>{t.title}</span>
                    {t.estimatedMinutes != null && (
                      <span className="font-mono text-xs text-ink-faint">{formatMinutes(t.estimatedMinutes)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
