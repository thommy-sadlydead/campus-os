"use client";

import { useTransition } from "react";
import { toggleWorkItemAction } from "@/app/dashboard/actions";
import { formatMinutes } from "@/lib/time";
import type { PriorityColor } from "@/lib/priority-engine";

const DOT_CLASS: Record<PriorityColor, string> = {
  red: "bg-danger",
  orange: "bg-warn",
  yellow: "bg-warn",
  green: "bg-ok",
  gray: "bg-ink-faint",
};

const BADGE_EMOJI: Record<PriorityColor, string> = {
  red: "\u{1F534}",
  orange: "\u{1F7E0}",
  yellow: "\u{1F7E1}",
  green: "\u{1F7E2}",
  gray: "⚪",
};

export function TaskRow(props: {
  id: string;
  kind: "assignment" | "task";
  title: string;
  className: string;
  color: PriorityColor;
  dueLabel: string;
  estimatedMinutes: number | null;
  reason: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex items-start gap-3 rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
      <button
        aria-label="Mark complete"
        disabled={pending}
        onClick={() => startTransition(() => toggleWorkItemAction(props.kind, props.id))}
        className={`mt-0.5 h-5 w-5 flex-none rounded-md border-2 border-border transition-colors hover:border-ok ${pending ? "opacity-50" : ""}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_CLASS[props.color]}`} />
          <span className="font-medium text-ink">
            {BADGE_EMOJI[props.color]} {props.title}
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-soft">
            {props.className}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
          <span>{props.dueLabel}</span>
          {props.estimatedMinutes != null && (
            <span className="font-mono">{formatMinutes(props.estimatedMinutes)}</span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-ink-faint">{props.reason}</p>
      </div>
    </li>
  );
}
