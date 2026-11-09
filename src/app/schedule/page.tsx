import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ScheduleAddForm } from "@/components/schedule/ScheduleAddForm";
import { CalendarSyncCard } from "@/components/schedule/CalendarSyncCard";
import { deleteScheduleEventAction } from "@/app/classes/[id]/actions";
import { lmsLink, type LmsLink } from "@/lib/lms/providers";
import { dayKey, formatTzTime, startOfTzDay } from "@/lib/time";
import { CardsIcon, ClockIcon, ExternalIcon, XIcon } from "@/components/icons";
import { meetingRunsOn } from "@/lib/meetings";
import { freeGaps, shortRange } from "@/lib/today";
import { semesterForNewMeetings } from "@/lib/meetings-server";
import { calendarLinksFor } from "@/lib/calendar-feed-server";
import { featuresFor } from "@/lib/features-server";
import { CommitmentsCard } from "@/components/schedule/CommitmentsCard";
import { AvailabilityCard } from "@/components/schedule/AvailabilityCard";

function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// A due assignment/exam's minute-of-day, in the student's tz — lets it sort
// alongside recurring class blocks (which are already stored as minutes)
// into one chronological agenda per day.
function minuteOfDay(instant: Date, tz: string): number {
  const [h, m] = formatInTimeZone(instant, tz, "HH:mm").split(":").map(Number);
  return h * 60 + m;
}

type AgendaEntry =
  | {
      type: "class";
      sortMinute: number;
      scheduleEventId: string;
      classId: string;
      className: string;
      color: number;
      timeLabel: string;
      location: string | null;
      label: string | null;
    }
  | {
      type: "due";
      sortMinute: number;
      kind: "assignment" | "exam";
      id: string;
      title: string;
      className: string;
      color: number;
      timeLabel: string;
      lmsLink: LmsLink | null;
    }
  | {
      // Work and other commitments (src/lib/features.ts).
      type: "commitment";
      sortMinute: number;
      id: string;
      label: string;
      timeLabel: string;
    }
  | {
      // An exam prep session (src/lib/exam-prep.ts).
      type: "study";
      sortMinute: number;
      id: string;
      classId: string;
      examName: string;
      className: string;
      color: number;
      timeLabel: string;
      done: boolean;
    }
  | {
      // An open stretch between the day's blocks (src/lib/today.ts freeGaps).
      type: "free";
      sortMinute: number;
      label: string;
    };

export default async function SchedulePage() {
  const user = await requireUser();
  const now = new Date();
  const features = await featuresFor(user);

  const [classes, events, assignments, exams, semester, calendarLinks, commitments, studySessions, freeBlocks] = await Promise.all([
    prisma.class.findMany({ where: { userId: user.id, archived: false }, orderBy: { name: "asc" } }),
    prisma.scheduleEvent.findMany({
      where: { class: { userId: user.id, archived: false } },
      include: { class: true },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
    prisma.assignment.findMany({
      where: {
        class: { userId: user.id, archived: false },
        dueAt: { not: null },
        status: { notIn: ["SUBMITTED", "GRADED"] },
      },
      include: { class: true },
    }),
    prisma.exam.findMany({
      where: { class: { userId: user.id, archived: false }, examAt: { not: null } },
      include: { class: true },
    }),
    semesterForNewMeetings(user.id, user.timezone),
    calendarLinksFor(user.id),
    features.has("commitments")
      ? prisma.commitment.findMany({ where: { userId: user.id }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] })
      : Promise.resolve([]),
    features.has("exam-prep")
      ? prisma.studySession.findMany({
          where: {
            userId: user.id,
            status: { not: "SKIPPED" },
            startsAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), lte: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000) },
          },
          include: { class: true, exam: { select: { name: true } } },
        })
      : Promise.resolve([]),
    features.has("free-time")
      ? prisma.availabilityBlock.findMany({ where: { userId: user.id, date: startOfTzDay(now, user.timezone) }, orderBy: { startMinute: "asc" } })
      : Promise.resolve([]),
  ]);

  // Bucket recurring meeting blocks by weekday (0 = Sunday .. 6 = Saturday,
  // matching ScheduleEvent.dayOfWeek).
  const eventsByDow = new Map<number, typeof events>();
  for (const ev of events) {
    const list = eventsByDow.get(ev.dayOfWeek) ?? [];
    list.push(ev);
    eventsByDow.set(ev.dayOfWeek, list);
  }

  // Bucket real due dates by calendar day (a specific date, not a weekday —
  // these don't recur).
  const dueByDayKey = new Map<string, AgendaEntry[]>();
  for (const a of assignments) {
    if (!a.dueAt) continue;
    const key = dayKey(a.dueAt, user.timezone);
    const list = dueByDayKey.get(key) ?? [];
    list.push({
      type: "due",
      sortMinute: minuteOfDay(a.dueAt, user.timezone),
      kind: "assignment",
      id: a.id,
      title: a.name,
      className: a.class.name,
      color: a.class.color,
      timeLabel: formatTzTime(a.dueAt, user.timezone),
      lmsLink: lmsLink(a.lmsUrl, a.class.lmsProvider),
    });
    dueByDayKey.set(key, list);
  }
  for (const e of exams) {
    if (!e.examAt) continue;
    const key = dayKey(e.examAt, user.timezone);
    const list = dueByDayKey.get(key) ?? [];
    list.push({
      type: "due",
      sortMinute: minuteOfDay(e.examAt, user.timezone),
      kind: "exam",
      id: e.id,
      title: e.name,
      className: e.class.name,
      color: e.class.color,
      timeLabel: formatTzTime(e.examAt, user.timezone),
      lmsLink: lmsLink(e.lmsUrl, e.class.lmsProvider),
    });
    dueByDayKey.set(key, list);
  }
  for (const s of studySessions) {
    const key = dayKey(s.startsAt, user.timezone);
    const list = dueByDayKey.get(key) ?? [];
    list.push({
      type: "study",
      sortMinute: minuteOfDay(s.startsAt, user.timezone),
      id: s.id,
      classId: s.classId,
      examName: s.exam.name,
      className: s.class.name,
      color: s.class.color,
      timeLabel: `${formatTzTime(s.startsAt, user.timezone)}, ${s.minutes} min`,
      done: s.status === "DONE",
    });
    dueByDayKey.set(key, list);
  }

  // Next 7 calendar days starting today, in the student's timezone — every
  // weekday appears exactly once, so this naturally covers the full
  // recurring pattern plus whatever's actually due this week.
  const days = Array.from({ length: 7 }, (_, i) => {
    const instant = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dayKey(instant, user.timezone);
    const iso = Number(formatInTimeZone(instant, user.timezone, "i")); // 1 = Mon .. 7 = Sun
    const dow = iso % 7; // 0 = Sun .. 6 = Sat, matches ScheduleEvent.dayOfWeek

    // Only meetings inside their semester dates, when they have them.
    const classEntries: AgendaEntry[] = (eventsByDow.get(dow) ?? []).filter((ev) => meetingRunsOn(ev, key)).map((ev) => ({
      type: "class",
      sortMinute: ev.startMinute,
      scheduleEventId: ev.id,
      classId: ev.classId,
      className: ev.class.name,
      color: ev.class.color,
      timeLabel: `${minutesToLabel(ev.startMinute)}–${minutesToLabel(ev.endMinute)}`,
      location: ev.location,
      label: ev.label,
    }));
    const commitmentEntries: AgendaEntry[] = commitments
      .filter((c) => c.dayOfWeek === dow && meetingRunsOn(c, key))
      .map((c) => ({
        type: "commitment",
        sortMinute: c.startMinute,
        id: c.id,
        label: c.label,
        timeLabel: `${minutesToLabel(c.startMinute)}–${minutesToLabel(c.endMinute)}`,
      }));
    const dueEntries = dueByDayKey.get(key) ?? [];
    // Free time between what's on the day, as dashed "plan something" rows.
    const blocks = [
      ...(eventsByDow.get(dow) ?? []).filter((ev) => meetingRunsOn(ev, key)).map((ev) => ({ start: ev.startMinute, end: ev.endMinute })),
      ...commitments.filter((c) => c.dayOfWeek === dow && meetingRunsOn(c, key)).map((c) => ({ start: c.startMinute, end: c.endMinute })),
      ...studySessions
        .filter((st) => dayKey(st.startsAt, user.timezone) === key)
        .map((st) => ({ start: minuteOfDay(st.startsAt, user.timezone), end: minuteOfDay(st.startsAt, user.timezone) + st.minutes })),
    ];
    const freeEntries: AgendaEntry[] = freeGaps(blocks, { notBefore: i === 0 ? minuteOfDay(now, user.timezone) : 0 }).map((g) => ({
      type: "free",
      sortMinute: g.start,
      label: `Free ${shortRange(g.start, g.end)}, plan something`,
    }));
    const entries = [...classEntries, ...commitmentEntries, ...dueEntries, ...freeEntries].sort((a, b) => a.sortMinute - b.sortMinute);

    return {
      key,
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : formatInTimeZone(instant, user.timezone, "EEEE"),
      dateLabel: formatInTimeZone(instant, user.timezone, "EEE, MMM d"),
      entries,
    };
  });

  return (
    <AppShell active="/schedule" userName={user.name ?? user.email}>
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Next 7 days</p>
          <h1 className="mt-1.5 font-display text-[40px] font-bold leading-[1.02] text-ink">Schedule</h1>
        </div>
        {classes.length > 0 && (
          <ScheduleAddForm classes={classes.map((c) => ({ id: c.id, name: c.name, color: c.color }))} semester={semester} />
        )}
      </header>

      {classes.length === 0 ? (
        <div className="empty">
          No classes on file.{" "}
          <Link href="/connect" className="font-semibold text-ink underline decoration-border underline-offset-4">
            Connect your classes
          </Link>{" "}
          to bring in your courses, then add their meeting times here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-9">
            {days.map((day) => (
              <section key={day.key}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-[22px] font-bold text-ink">{day.label}</h2>
                  <span className="eyebrow">{day.dateLabel}</span>
                </div>
                {day.entries.length === 0 ? (
                  <p className="text-[13px] text-ink-faint">Nothing on file.</p>
                ) : (
                  <ol className="flex flex-col gap-2.5">
                    {day.entries.map((entry, i) => (
                      <li key={i} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3">
                        <TimeLabel minute={entry.sortMinute} />
                        <EntryCard entry={entry} />
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>

          <div className="flex flex-col gap-3 lg:sticky lg:top-10 lg:h-fit">
            {features.has("free-time") && <AvailabilityCard blocks={freeBlocks} />}
            {features.has("commitments") && (
              <CommitmentsCard
                commitments={commitments.map((c) => ({ id: c.id, label: c.label, dayOfWeek: c.dayOfWeek, startMinute: c.startMinute, endMinute: c.endMinute }))}
                cutoffMinute={user.studyCutoffMinute}
              />
            )}
            <CalendarSyncCard links={calendarLinks} />
          </div>
        </div>
      )}
    </AppShell>
  );
}

/** The time column: "9:00" over "AM". */
function TimeLabel({ minute }: { minute: number }) {
  const h = Math.floor(minute / 60);
  return (
    <div className="pt-3.5 text-right">
      <p className="text-[15px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink">
        {(h % 12) || 12}:{String(minute % 60).padStart(2, "0")}
      </p>
      <p className="mt-1 text-[11px] font-medium text-ink-faint">{h >= 12 ? "PM" : "AM"}</p>
    </div>
  );
}

function EntryCard({ entry }: { entry: AgendaEntry }) {
  if (entry.type === "free") {
    return (
      <div className="flex items-center gap-2.5 rounded-xl2 border border-dashed border-border px-4 py-3.5 text-[14px] text-ink-faint">
        <span aria-hidden className="text-lg leading-none">+</span>
        {entry.label}
      </div>
    );
  }
  if (entry.type === "class") {
    return (
      <div className="card flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink">{entry.className}</p>
          <p className="mt-0.5 truncate text-[13px] tabular-nums text-ink-soft">
            {entry.timeLabel}
            {entry.location ? ` · ${entry.location}` : ""}
            {entry.label ? ` · ${entry.label}` : ""}
          </p>
        </div>
        <form action={deleteScheduleEventAction.bind(null, entry.scheduleEventId)}>
          <button
            title="Remove"
            aria-label={`Remove this ${entry.className} meeting`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </form>
      </div>
    );
  }
  if (entry.type === "commitment") {
    return (
      <div className="flex items-center gap-3 rounded-xl2 bg-surface-2 px-4 py-3">
        <ClockIcon className="h-4 w-4 flex-none text-ink-faint" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink">{entry.label}</p>
          <p className="mt-0.5 text-[13px] tabular-nums text-ink-soft">{entry.timeLabel}</p>
        </div>
      </div>
    );
  }
  if (entry.type === "study") {
    return (
      <Link href={`/classes/${entry.classId}?tab=study`} className="card flex items-center gap-3 px-4 py-3 transition-colors hover:border-border">
        <CardsIcon className="h-4 w-4 flex-none text-ink-faint" />
        <div className="min-w-0 flex-1">
          <p className={`text-[15px] font-semibold leading-snug ${entry.done ? "text-ink-faint line-through" : "text-ink"}`}>Quiz for {entry.examName}</p>
          <p className="mt-0.5 truncate text-[13px] text-ink-soft">
            {entry.timeLabel} · {entry.className}
          </p>
        </div>
      </Link>
    );
  }
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{entry.title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-soft">
          <span className={`flex-none ${entry.kind === "exam" ? "badge-urgent" : "badge-soon"} px-2 py-0 text-[11px]`}>
            {entry.kind === "exam" ? "Exam" : "Due"}
          </span>
          <span className="truncate">{entry.className}</span>
        </p>
      </div>
      {entry.lmsLink && (
        <a
          href={entry.lmsLink.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${entry.title} in ${entry.lmsLink.name}`}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ExternalIcon className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}
