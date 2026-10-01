"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleWorkItemAction } from "@/app/dashboard/actions";
import { breakdownAssignmentAction, deleteTaskAction } from "@/app/assignments/actions";
import { formatDueLabel, formatMinutes } from "@/lib/time";
import { stripHtml } from "@/lib/text";
import { assignmentGridColumns } from "./assignment-grid";

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
 * One assignment: a card on phones, a table-style row on wide screens.
 * Shared by the Assignments page and each class's Assignments tab (pass
 * `classLabel` on the former to show which class it's for).
 *
 * Opening it shows the real Canvas directions, a "See in Canvas" link,
 * Mark as done, and its steps. "Break down with AI" creates steps
 * (breakdownAssignmentAction); checking one off is the same
 * toggleWorkItemAction the dashboard uses, and steps can be deleted.
 */
export function AssignmentRow({
  assignment,
  tz,
  classLabel,
}: {
  assignment: AssignmentRowData;
  tz: string;
  classLabel?: string;
}) {
  const router = useRouter();
  const now = new Date();
  const [expanded, setExpanded] = useState(false);
  const [breakdownMessage, setBreakdownMessage] = useState<string | null>(null);
  // Optimistic overrides on top of the server's copy, which stays the
  // source of truth: new steps from a breakdown arrive through props.
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const tasks = assignment.tasks
    .filter((t) => !removed.has(t.id))
    .map((t) => ({ ...t, completed: checked[t.id] ?? t.completed }));
  const remaining = tasks.filter((t) => !t.completed).length;
  const done = assignment.status === "SUBMITTED" || assignment.status === "GRADED";

  function runBreakdown() {
    startTransition(async () => {
      const result = await breakdownAssignmentAction(assignment.id);
      setBreakdownMessage(result.message);
      if (result.stepCount > 0) setExpanded(true);
      router.refresh();
    });
  }

  function toggleTask(taskId: string, completed: boolean) {
    setChecked((prev) => ({ ...prev, [taskId]: !completed }));
    startTransition(() => toggleWorkItemAction("task", taskId));
  }

  function removeTask(taskId: string, title: string) {
    if (!confirm(`Delete the step "${title}"?`)) return;
    setRemoved((prev) => new Set(prev).add(taskId));
    startTransition(async () => {
      await deleteTaskAction(taskId);
      router.refresh();
    });
  }

  function toggleDone() {
    startTransition(async () => {
      await toggleWorkItemAction("assignment", assignment.id);
      router.refresh();
    });
  }

  const description = assignment.description ? stripHtml(assignment.description) : "";
  const dueLabel = formatDueLabel(assignment.dueAt ? new Date(assignment.dueAt) : null, now, tz);

  return (
    <li className="border-b border-border-soft last:border-0">
      <div className={`grid gap-y-1.5 px-4 py-3 lg:items-center lg:gap-x-4 ${assignmentGridColumns(classLabel != null)}`}>
        <div className="min-w-0">
          <button onClick={() => setExpanded((v) => !v)} className="text-left font-medium hover:underline" aria-expanded={expanded}>
            <span aria-hidden className="mr-1 text-ink-faint">
              {expanded ? "▾" : "▸"}
            </span>
            {assignment.name}
          </button>
          {tasks.length > 0 ? (
            <div className="mt-0.5 text-xs text-ink-faint">
              {remaining} of {tasks.length} step{tasks.length === 1 ? "" : "s"} left
            </div>
          ) : breakdownMessage ? (
            <div className="mt-0.5 text-xs text-ink-faint">{breakdownMessage}</div>
          ) : (
            !done && (
              <button
                onClick={runBreakdown}
                disabled={pending}
                className="mt-0.5 block text-xs font-medium text-accent hover:underline disabled:opacity-60"
              >
                {pending ? "Breaking down…" : "Break down with AI"}
              </button>
            )
          )}
        </div>
        {/* A wrapped line of details on phones; separate columns on wide screens. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft lg:contents lg:text-sm">
          {classLabel != null && <span className="truncate">{classLabel}</span>}
          <span>{dueLabel}</span>
          {/* Without an estimate there's nothing to say on a phone, but the
              wide-screen grid still needs the cell to keep its columns. */}
          <span className={`font-mono ${assignment.estimatedMinutes == null ? "hidden lg:block" : ""}`}>
            {assignment.estimatedMinutes != null ? formatMinutes(assignment.estimatedMinutes) : "—"}
          </span>
          <span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ASSIGNMENT_STATUS_TONE[assignment.status]}`}>
              {ASSIGNMENT_STATUS_LABEL[assignment.status]}
            </span>
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-soft bg-surface-2 px-4 py-4">
          <div className="mb-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Directions</div>
            <p className="whitespace-pre-wrap text-sm text-ink-soft">
              {description || "No directions for this assignment in Canvas."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {assignment.canvasUrl && (
                <a
                  href={assignment.canvasUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-accent hover:underline"
                >
                  See in Canvas ↗
                </a>
              )}
              <button
                onClick={toggleDone}
                disabled={pending}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-bg disabled:opacity-60"
              >
                {done ? "Mark as not done" : "Mark as done"}
              </button>
            </div>
          </div>
          {tasks.length > 0 && (
            <ul className="space-y-1.5">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2.5 text-sm">
                  <button
                    aria-label={t.completed ? "Mark step incomplete" : "Mark step complete"}
                    disabled={pending}
                    onClick={() => toggleTask(t.id, t.completed)}
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded border-2 text-[11px] leading-none transition-colors ${
                      t.completed ? "border-ok bg-ok text-surface" : "border-border text-transparent hover:border-ok"
                    }`}
                  >
                    ✓
                  </button>
                  <span className={t.completed ? "flex-1 text-ink-faint line-through" : "flex-1"}>{t.title}</span>
                  {t.estimatedMinutes != null && (
                    <span className="font-mono text-xs text-ink-faint">{formatMinutes(t.estimatedMinutes)}</span>
                  )}
                  <button
                    onClick={() => removeTask(t.id, t.title)}
                    disabled={pending}
                    aria-label={`Delete step: ${t.title}`}
                    className="flex-none rounded px-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger disabled:opacity-60"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
