"use client";

import { useState, useTransition } from "react";
import { toggleWorkItemAction } from "@/app/dashboard/actions";
import { formatMinutes } from "@/lib/time";
import { haptic } from "@/lib/native-app";
import type { LmsLink } from "@/lib/lms/providers";
import { ChevronDownIcon, ExternalIcon } from "@/components/icons";

// The top of Today and its list, kept quiet on purpose (Nov 9, 2026: the
// first redesign read as busy). A short headline of what's due today, the
// overdue work folded into one black row, then each day's work as rows in
// one white card. Red is only for overdue work. Tap a row's text for its
// directions.

export interface TodayRow {
  id: string;
  kind: "assignment" | "task";
  title: string;
  /** Course code, or the class name when there's no code. */
  classLabel: string;
  className: string;
  dueShort: string | null;
  estimatedMinutes: number | null;
  reason: string;
  /** Directions, already plain text. */
  description: string | null;
  lmsLink: LmsLink | null;
}

export interface TodaySection {
  key: string;
  title: string;
  rows: TodayRow[];
}

export function TodayBoard({
  dateLabel,
  dueToday,
  dueLaterThisWeek,
  overdue,
  sections,
  emptyText,
  children,
}: {
  dateLabel: string;
  /** Rows due today, the headline. */
  dueToday: number;
  /** Rows due tomorrow through the next seven days. */
  dueLaterThisWeek: number;
  /** Overdue rows, shown folded into one row. */
  overdue: TodayRow[];
  /** Everything else, in order: today, tomorrow, this week, later, no date. */
  sections: TodaySection[];
  emptyText: string;
  /** The status line, "what now" and notices, between the headline and the list. */
  children?: React.ReactNode;
}) {
  return (
    <div>
      <section aria-label="Today">
        <p className="text-[13px] font-medium text-ink-soft">{dateLabel}</p>
        <h1 className="mt-1 font-display text-[32px] font-bold leading-tight tracking-[-0.03em] text-ink">
          {dueToday === 0 ? "Nothing due today" : `${dueToday} to do today`}
        </h1>
        {dueLaterThisWeek > 0 && <p className="mt-1 text-[15px] text-ink-soft">{dueLaterThisWeek} more this week</p>}
      </section>

      {children && <div className="mt-5 flex flex-col gap-3">{children}</div>}

      <div className="mt-8 flex flex-col gap-8">
        {overdue.length > 0 && <OverdueFold rows={overdue} />}
        {overdue.length === 0 && sections.length === 0 ? (
          <p className="empty">{emptyText}</p>
        ) : (
          sections.map((s) => (
            <section key={s.key}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 className="eyebrow text-ink">{s.title}</h2>
                <span className="text-[13px] font-semibold tabular-nums text-ink">{s.rows.length}</span>
              </div>
              <div className="card px-4">
                <RowList rows={s.rows} />
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** "● 8 overdue" on a black card, opening in place to the overdue rows. */
function OverdueFold({ rows }: { rows: TodayRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card theme-inverse px-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 py-4 text-left text-[15px] font-semibold text-ink ${open ? "border-b border-border-soft" : ""}`}
      >
        <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full bg-accent" />
        <span className="flex-1">{rows.length} overdue</span>
        <ChevronDownIcon className={`h-4 w-4 text-ink-soft transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <RowList rows={rows} overdue />}
    </section>
  );
}

const INITIAL = 5;

function RowList({ rows, overdue = false }: { rows: TodayRow[]; overdue?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, INITIAL);
  return (
    <>
      <ul className="divide-y divide-border-soft">
        {shown.map((r) => (
          <Row key={r.id} row={r} overdue={overdue} />
        ))}
      </ul>
      {rows.length > INITIAL && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mb-3.5 mt-1 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4">
          {all ? "Show less" : `Show ${rows.length - INITIAL} more`}
        </button>
      )}
    </>
  );
}

function Row({ row, overdue }: { row: TodayRow; overdue: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [done, setDone] = useState(false);
  const [, startTransition] = useTransition();

  function complete() {
    if (done) return;
    setDone(true);
    haptic("light");
    // The strike and fade play first; the action then refreshes the list.
    startTransition(async () => {
      await new Promise((r) => setTimeout(r, 350));
      await toggleWorkItemAction(row.kind, row.id);
    });
  }

  return (
    <li className={`flex items-start gap-3 py-3 transition-opacity duration-300 ${done ? "opacity-40" : ""}`}>
      <button
        type="button"
        aria-label={`Mark "${row.title}" complete`}
        aria-pressed={done}
        disabled={done}
        onClick={complete}
        className="-m-1.5 flex-none p-1.5"
      >
        <span
          className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
            done ? "border-ink bg-ink text-surface" : "border-ink text-transparent"
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="block w-full text-left">
          <span className={`block text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink ${expanded ? "" : "line-clamp-2"}`}>
            <span
              className="bg-no-repeat transition-[background-size] duration-300 ease-out"
              style={{ backgroundImage: "linear-gradient(currentColor, currentColor)", backgroundPosition: "0 55%", backgroundSize: done ? "100% 1.5px" : "0% 1.5px" }}
            >
              {row.title}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-ink-soft">
            {row.classLabel}
            {row.dueShort && (
              <>
                {" · "}
                <span className={overdue ? "font-medium text-accent" : ""}>{row.dueShort}</span>
              </>
            )}
            {row.estimatedMinutes != null && <span className="tabular-nums"> · {formatMinutes(row.estimatedMinutes)}</span>}
          </span>
        </button>
        {/* Opens with a short spring: grid rows 0fr → 1fr. */}
        <div
          className="grid transition-[grid-template-rows] duration-200"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr", transitionTimingFunction: "cubic-bezier(0.34, 1.4, 0.64, 1)" }}
        >
          <div className="overflow-hidden">
            <div className="pt-2">
              <p className="text-[13px] leading-relaxed text-ink-soft">
                {row.className}. {row.reason}
              </p>
              {row.description && (
                <p className="mt-2 whitespace-pre-wrap border-l-2 border-border-soft pl-3 text-[13px] leading-relaxed text-ink-soft">{row.description}</p>
              )}
              {row.lmsLink && (
                <a
                  href={row.lmsLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4"
                >
                  Open in {row.lmsLink.name}
                  <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
