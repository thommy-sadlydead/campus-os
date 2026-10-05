"use client";

import { useState, useTransition } from "react";
import { toggleWorkItemAction } from "@/app/dashboard/actions";
import { formatMinutes } from "@/lib/time";
import { stripHtml } from "@/lib/text";
import type { PriorityColor } from "@/lib/priority-engine";
import type { LmsLink } from "@/lib/lms/providers";
import { CheckIcon, ChevronDownIcon, ClockIcon, ExternalIcon } from "@/components/icons";

const DOT_CLASS: Record<PriorityColor, string> = {
  red: "bg-danger",
  orange: "bg-accent",
  yellow: "bg-warn",
  green: "bg-ok",
  gray: "bg-ink-faint",
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
  /** Raw HTML from the LMS (rendered with stripHtml()), or null. For a "task" this is the parent assignment's description. */
  description: string | null;
  /** "Open in Canvas" link, or null when the item didn't come from an LMS. */
  lmsLink: LmsLink | null;
}) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  const hasDetails = !!props.description || !!props.lmsLink;
  const description = props.description ? stripHtml(props.description) : "";

  return (
    <li className={`flex items-start gap-3 px-4 py-3.5 transition-opacity sm:px-5 ${pending ? "opacity-50" : ""}`}>
      <button
        aria-label="Mark complete"
        title="Mark complete"
        disabled={pending}
        onClick={() => startTransition(() => toggleWorkItemAction(props.kind, props.id))}
        className="mt-px flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-[1.5px] border-border text-transparent transition-colors hover:border-ok hover:bg-ok-soft hover:text-ok"
      >
        <CheckIcon className="h-3 w-3" />
      </button>
      <div className="min-w-0 flex-1">
        {hasDetails ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="group inline-flex max-w-full items-start gap-1 text-left text-[15px] font-medium leading-snug text-ink"
          >
            <span className="group-hover:underline group-hover:decoration-border group-hover:underline-offset-4">{props.title}</span>
            <ChevronDownIcon
              className={`mt-[3px] h-4 w-4 flex-none text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <p className="text-[15px] font-medium leading-snug text-ink">{props.title}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
          <span className={`inline-flex items-center gap-1.5 ${props.color === "red" ? "font-medium text-danger" : ""}`}>
            <span aria-hidden className={`dot ${DOT_CLASS[props.color]}`} />
            {props.dueLabel}
          </span>
          <span className="max-w-full truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-soft">
            {props.className}
          </span>
          {props.estimatedMinutes != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <ClockIcon className="h-3.5 w-3.5 text-ink-faint" />
              {formatMinutes(props.estimatedMinutes)}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">{props.reason}</p>
        {expanded && hasDetails && (
          <div className="mt-3 rounded-lg border border-border-soft bg-surface-2 p-3">
            {description && <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{description}</p>}
            {props.lmsLink && (
              <a
                href={props.lmsLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink hover:underline ${description ? "mt-2" : ""}`}
              >
                Open in {props.lmsLink.name}
                <ExternalIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
