"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toggleWorkItemAction } from "@/app/dashboard/actions";
import { formatMinutes } from "@/lib/time";
import { haptic } from "@/lib/native-app";
import type { LmsLink } from "@/lib/lms/providers";
import type { DayTimeline, DueBadge, WeekDay } from "@/lib/today";
import { ChevronDownIcon, ExternalIcon } from "@/components/icons";

// The top of Today and its list: the date and a giant "due this week"
// number, today as a strip (classes solid, free time hatched, a red NOW
// line), the week as pills with what's due each day (tap one to see just
// that day), and the open work as two-line cards. The numbers come from
// src/lib/today.ts.

export interface TodayCard {
  id: string;
  kind: "assignment" | "task";
  title: string;
  /** Course code, or the class name when there's no code. */
  classLabel: string;
  className: string;
  dueKey: string | null;
  dueShort: string | null;
  estimatedMinutes: number | null;
  reason: string;
  /** Directions, already plain text. */
  description: string | null;
  lmsLink: LmsLink | null;
  badge: DueBadge;
}

export interface TodaySection {
  key: string;
  title: string;
  cards: TodayCard[];
}

const BADGE_CLASS: Record<DueBadge["tone"], string> = {
  urgent: "badge-urgent",
  soon: "badge-soon",
  later: "badge-later",
};

export function TodayBoard({
  dateLabel,
  dueThisWeek,
  overdue,
  week,
  timeline,
  tz,
  sections,
  emptyText,
  children,
}: {
  dateLabel: string;
  dueThisWeek: number;
  overdue: number;
  week: WeekDay[];
  timeline: DayTimeline;
  tz: string;
  sections: TodaySection[];
  emptyText: string;
  /** Notices and "what now", between the week and the list. */
  children?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDay = week.find((d) => d.key === selected) ?? null;
  const shown = useMemo(
    () =>
      selected
        ? sections.map((s) => ({ ...s, cards: s.cards.filter((c) => c.dueKey === selected) })).filter((s) => s.cards.length > 0)
        : sections,
    [sections, selected]
  );

  return (
    <div>
      <section aria-label="This week">
        <p className="text-[13px] font-medium text-ink-soft">{dateLabel}</p>
        <div className="mt-2 flex items-end gap-4">
          <span className="display-num text-[96px] text-ink">{dueThisWeek}</span>
          <div className="pb-2.5">
            <p className="eyebrow">due this week</p>
            {overdue > 0 && <p className="mt-1.5 text-[13px] font-semibold text-accent">{overdue} overdue</p>}
          </div>
        </div>
        <DayStrip timeline={timeline} tz={tz} />
        <div className="mt-6 grid grid-cols-7 gap-1.5" role="group" aria-label="Pick a day">
          {week.map((d) => {
            const isSelected = selected ? d.key === selected : d.isToday;
            return (
              <button
                key={d.key}
                type="button"
                aria-pressed={selected === d.key}
                onClick={() => setSelected(d.isToday || selected === d.key ? null : d.key)}
                className={`flex flex-col items-center rounded-full py-2.5 transition-colors ${
                  isSelected
                    ? "bg-ink text-surface"
                    : d.isToday
                      ? "border border-ink text-ink"
                      : `border border-border-soft bg-surface ${d.isPast ? "text-ink-faint" : "text-ink"}`
                }`}
              >
                <span className={`text-[10px] font-semibold uppercase tracking-[0.06em] ${isSelected ? "opacity-70" : "text-ink-faint"}`}>
                  {d.label}
                </span>
                <span className="mt-0.5 text-[19px] font-bold leading-tight tracking-[-0.03em] tabular-nums">{d.date}</span>
                <span className={`mt-0.5 text-[10px] tabular-nums ${isSelected ? "opacity-80" : d.due ? "text-ink-soft" : "text-ink-faint"}`}>
                  {d.due ? `${d.due} due` : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {children && <div className="mt-8 flex flex-col gap-3">{children}</div>}

      <div className="mt-8 flex flex-col gap-7">
        {selectedDay && (
          <div className="flex items-center justify-between">
            <p className="font-display text-[22px] font-semibold text-ink">
              {selectedDay.label} {selectedDay.date}
            </p>
            <button type="button" onClick={() => setSelected(null)} className="chip">
              Show everything
            </button>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="empty">{selectedDay ? "Nothing due that day." : emptyText}</p>
        ) : (
          shown.map((s) => <CardSection key={s.key} section={s} />)
        )}
      </div>
    </div>
  );
}

/** Today from morning to night: class meetings solid, logged free time hatched, and where "now" is. */
function DayStrip({ timeline, tz }: { timeline: DayTimeline; tz: string }) {
  const [nowMinute, setNowMinute] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz }).formatToParts(new Date());
      const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
      setNowMinute(get("hour") * 60 + get("minute"));
    };
    read();
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, [tz]);

  const span = timeline.end - timeline.start;
  const pct = (m: number) => `${((Math.min(Math.max(m, timeline.start), timeline.end) - timeline.start) / span) * 100}%`;
  const hours: number[] = [];
  for (let m = timeline.start; m <= timeline.end; m += 240) hours.push(m);
  const hourLabel = (m: number) => {
    const h = Math.floor(m / 60) % 24;
    return h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`;
  };
  const showNow = nowMinute != null && nowMinute >= timeline.start && nowMinute <= timeline.end;

  return (
    <div className="mt-6" aria-label="Today's classes and free time">
      <div className="relative h-7">
        <div className="absolute inset-0 overflow-hidden rounded-full bg-surface-2">
          {timeline.segments.map((s, i) => (
            <span
              key={i}
              title={s.label}
              className={`absolute inset-y-0 ${s.kind === "class" ? "bg-ink" : "border-x border-ink/40"}`}
              style={{
                left: pct(s.start),
                width: `calc(${pct(s.end)} - ${pct(s.start)})`,
                ...(s.kind === "free"
                  ? { backgroundImage: "repeating-linear-gradient(135deg, var(--ink) 0 1.5px, transparent 1.5px 6px)", opacity: 0.55 }
                  : {}),
              }}
            />
          ))}
        </div>
        {showNow && (
          <div className="pointer-events-none absolute -top-1.5 bottom-[-6px] w-0.5 -translate-x-1/2 rounded-full bg-accent" style={{ left: pct(nowMinute) }} />
        )}
      </div>
      <div className="relative mt-2 h-5">
        {hours.map((m) => (
          <span key={m} className="absolute -translate-x-1/2 text-[10px] font-medium text-ink-faint first:translate-x-0 last:-translate-x-full" style={{ left: pct(m) }}>
            {hourLabel(m)}
          </span>
        ))}
        {showNow && (
          <span
            className="absolute top-0 -translate-x-1/2 rounded-full bg-accent px-2 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-white"
            style={{ left: `clamp(1.25rem, ${pct(nowMinute)}, calc(100% - 1.25rem))` }}
          >
            Now
          </span>
        )}
      </div>
      {timeline.segments.length === 0 && (
        <p className="mt-1 text-[12px] text-ink-faint">No classes on the schedule today.</p>
      )}
    </div>
  );
}

const INITIAL = 5;

function CardSection({ section }: { section: TodaySection }) {
  const [all, setAll] = useState(false);
  const cards = all ? section.cards : section.cards.slice(0, INITIAL);
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="eyebrow">{section.title}</h2>
        <span className="text-[13px] font-medium tabular-nums text-ink-faint">{section.cards.length}</span>
      </div>
      <ul className="flex flex-col gap-3">
        {cards.map((c) => (
          <Card key={c.id} card={c} />
        ))}
      </ul>
      {section.cards.length > INITIAL && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4">
          {all ? "Show less" : `Show ${section.cards.length - INITIAL} more`}
        </button>
      )}
    </section>
  );
}

function Card({ card }: { card: TodayCard }) {
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
      await toggleWorkItemAction(card.kind, card.id);
    });
  }

  return (
    <li className={`card px-4 py-3.5 transition-opacity duration-300 ${done ? "opacity-40" : ""}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label={`Mark "${card.title}" complete`}
          aria-pressed={done}
          disabled={done}
          onClick={complete}
          className="-m-1 flex-none p-1"
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-[6px] border-[1.5px] transition-colors duration-200 ${
              done ? "border-ink bg-ink text-surface" : "border-border text-transparent hover:border-ink"
            }`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className={`min-w-0 flex-1 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink ${expanded ? "" : "line-clamp-2"}`}>
              <span
                className="bg-no-repeat transition-[background-size] duration-300 ease-out"
                style={{ backgroundImage: "linear-gradient(currentColor, currentColor)", backgroundPosition: "0 55%", backgroundSize: done ? "100% 1.5px" : "0% 1.5px" }}
              >
                {card.title}
              </span>
            </p>
            <span className={`${BADGE_CLASS[card.badge.tone]} mt-0.5 flex-none`}>{card.badge.text}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-soft">
            <span className="max-w-[8rem] flex-none truncate rounded-full border border-border-soft px-2 py-px text-[11px] font-semibold uppercase tracking-[0.04em] text-ink">
              {card.classLabel}
            </span>
            {card.dueShort && <span className="truncate">· {card.dueShort}</span>}
            {card.estimatedMinutes != null && <span className="flex-none tabular-nums">· {formatMinutes(card.estimatedMinutes)}</span>}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? "Hide details" : "Show details"}
              className="-my-1 -mr-1 ml-auto flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-faint hover:bg-surface-2 hover:text-ink"
            >
              <ChevronDownIcon className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            </button>
          </div>
          {/* Opens with a short spring: grid rows 0fr → 1fr. */}
          <div
            className="grid transition-[grid-template-rows] duration-200"
            style={{ gridTemplateRows: expanded ? "1fr" : "0fr", transitionTimingFunction: "cubic-bezier(0.34, 1.4, 0.64, 1)" }}
          >
            <div className="overflow-hidden">
              <div className="pt-3">
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  {card.className}. {card.reason}
                </p>
                {card.description && (
                  <p className="mt-2 whitespace-pre-wrap border-l-2 border-border-soft pl-3 text-[13px] leading-relaxed text-ink-soft">{card.description}</p>
                )}
                {card.lmsLink && (
                  <a
                    href={card.lmsLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4"
                  >
                    Open in {card.lmsLink.name}
                    <ExternalIcon className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
