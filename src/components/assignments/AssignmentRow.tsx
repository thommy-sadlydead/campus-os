"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleWorkItemAction } from "@/app/dashboard/actions";
import { breakdownAssignmentAction, deleteTaskAction } from "@/app/assignments/actions";
import { formatDueLabel, formatMinutes } from "@/lib/time";
import { stripHtml } from "@/lib/text";
import { ASSIGNMENT_STATUS_LABEL, type AssignmentStatus } from "@/lib/assignment-status";
import { assignmentGridColumns } from "./assignment-grid";
import { CheckIcon, ChevronRightIcon, ExternalIcon, SparkIcon, XIcon } from "@/components/icons";

export interface AssignmentRowTask {
  id: string;
  title: string;
  estimatedMinutes: number | null;
  completed: boolean;
}

export type AssignmentRowStatus = AssignmentStatus;

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
      <div className={`grid gap-y-1.5 px-4 py-3.5 sm:px-5 lg:items-center lg:gap-x-4 ${assignmentGridColumns(classLabel != null)}`}>
        <div className="min-w-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className={`group flex items-start gap-1.5 text-left text-[15px] font-medium leading-snug ${done ? "text-ink-soft" : "text-ink"}`}
            aria-expanded={expanded}
          >
            <ChevronRightIcon
              className={`mt-[3px] h-4 w-4 flex-none text-ink-faint transition-transform group-hover:text-ink ${expanded ? "rotate-90" : ""}`}
            />
            <span className="group-hover:underline group-hover:decoration-border group-hover:underline-offset-4">{assignment.name}</span>
          </button>
          <div className="pl-[22px]">
            {tasks.length > 0 ? (
              <div className="mt-1 text-xs text-ink-faint">
                {remaining} of {tasks.length} step{tasks.length === 1 ? "" : "s"} left
              </div>
            ) : breakdownMessage ? (
              <div className="mt-1 text-xs text-ink-faint">{breakdownMessage}</div>
            ) : (
              !done && (
                <button
                  onClick={runBreakdown}
                  disabled={pending}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline disabled:opacity-60"
                >
                  <SparkIcon className="h-3.5 w-3.5" />
                  {pending ? "Breaking down…" : "Break down with AI"}
                </button>
              )
            )}
          </div>
        </div>
        {/* A wrapped line of details on phones; separate columns on wide screens. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[22px] text-xs text-ink-soft lg:contents lg:text-sm">
          {classLabel != null && <span className="truncate">{classLabel}</span>}
          <span>{dueLabel}</span>
          {/* Without an estimate there's nothing to say on a phone, but the
              wide-screen grid still needs the cell to keep its columns. */}
          <span className={`tabular-nums ${assignment.estimatedMinutes == null ? "hidden text-ink-faint lg:block" : ""}`}>
            {assignment.estimatedMinutes != null ? formatMinutes(assignment.estimatedMinutes) : "—"}
          </span>
          <span>
            <span className={`badge ${ASSIGNMENT_STATUS_TONE[assignment.status]}`}>
              {ASSIGNMENT_STATUS_LABEL[assignment.status]}
            </span>
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-soft bg-surface-2 px-4 py-4 sm:px-5 sm:pl-[42px]">
          <div className="mb-3">
            <div className="eyebrow mb-1">Directions</div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
              {description || "No directions for this assignment in Canvas."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {assignment.canvasUrl && (
                <a
                  href={assignment.canvasUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-ink hover:underline"
                >
                  See in Canvas
                  <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              )}
              <button
                onClick={toggleDone}
                disabled={pending}
                className="btn btn-secondary btn-sm"
              >
                {done ? "Mark as not done" : "Mark as done"}
              </button>
            </div>
          </div>
          {tasks.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-border-soft pt-3">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2.5 py-0.5 text-sm">
                  <button
                    aria-label={t.completed ? "Mark step incomplete" : "Mark step complete"}
                    disabled={pending}
                    onClick={() => toggleTask(t.id, t.completed)}
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border-[1.5px] transition-colors ${
                      t.completed ? "border-ok bg-ok text-surface" : "border-border bg-surface text-transparent hover:border-ok hover:text-ok"
                    }`}
                  >
                    <CheckIcon className="h-3 w-3" />
                  </button>
                  <span className={t.completed ? "flex-1 text-ink-faint line-through" : "flex-1 text-ink"}>{t.title}</span>
                  {t.estimatedMinutes != null && (
                    <span className="text-xs tabular-nums text-ink-faint">{formatMinutes(t.estimatedMinutes)}</span>
                  )}
                  <button
                    onClick={() => removeTask(t.id, t.title)}
                    disabled={pending}
                    aria-label={`Delete step: ${t.title}`}
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60"
                  >
                    <XIcon className="h-4 w-4" />
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
