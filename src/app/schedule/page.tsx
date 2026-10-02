import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ScheduleAddForm } from "@/components/schedule/ScheduleAddForm";
import { deleteScheduleEventAction } from "@/app/classes/[id]/actions";
import { canvasAssignmentUrl } from "@/lib/canvas";
import { dayKey, formatTzTime } from "@/lib/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { ChecklistIcon, ExternalIcon, PencilIcon, XIcon } from "@/components/icons";
import { courseStyle } from "@/lib/course-style";

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
      canvasUrl: string | null;
    };

export default async function SchedulePage() {
  const user = await requireUser();
  const now = new Date();

  const [classes, events, assignments, exams] = await Promise.all([
    prisma.class.findMany({ where: { userId: user.id, archived: false }, orderBy: { name: "asc" } }),
    prisma.scheduleEvent.findMany({
      where: { class: { userId: user.id } },
      include: { class: true },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
    prisma.assignment.findMany({
      where: {
        class: { userId: user.id },
        dueAt: { not: null },
        status: { notIn: ["SUBMITTED", "GRADED"] },
      },
      include: { class: true },
    }),
    prisma.exam.findMany({
      where: { class: { userId: user.id }, examAt: { not: null } },
      include: { class: true },
    }),
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
      canvasUrl: canvasAssignmentUrl(a.class.canvasCourseId, a.canvasAssignmentId),
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
      canvasUrl: canvasAssignmentUrl(e.class.canvasCourseId, e.canvasAssignmentId),
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

    const classEntries: AgendaEntry[] = (eventsByDow.get(dow) ?? []).map((ev) => ({
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
    const dueEntries = dueByDayKey.get(key) ?? [];
    const entries = [...classEntries, ...dueEntries].sort((a, b) => a.sortMinute - b.sortMinute);

    return {
      key,
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : formatInTimeZone(instant, user.timezone, "EEEE"),
      dateLabel: formatInTimeZone(instant, user.timezone, "MMM d"),
      entries,
    };
  });

  return (
    <AppShell active="/schedule" userName={user.name ?? user.email}>
      <PageHeader
        title="Schedule"
        description="The next 7 days: your recurring class meetings alongside real assignment and exam due dates. Canvas doesn't provide meeting times, so add those yourself, here or on a class's Overview tab."
      />

      {classes.length === 0 ? (
        <div className="empty">
          No classes yet.{" "}
          <Link href="/canvas" className="font-medium text-accent-ink underline">
            Connect Canvas
          </Link>{" "}
          to bring in your courses, then add their meeting times here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-4">
            {days.map((day) => (
              <section key={day.key} className="card overflow-hidden">
                <header className="flex items-baseline justify-between gap-3 border-b border-border-soft px-4 py-3 sm:px-5">
                  <h2 className="text-sm font-semibold text-ink">{day.label}</h2>
                  <span className="text-[13px] text-ink-faint">{day.dateLabel}</span>
                </header>
                {day.entries.length === 0 ? (
                  <p className="px-4 py-3.5 text-[13px] text-ink-faint sm:px-5">Nothing on the calendar.</p>
                ) : (
                  <ul className="divide-y divide-border-soft">
                    {day.entries.map((entry) =>
                      entry.type === "class" ? (
                        <li key={`class-${entry.scheduleEventId}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                          <span
                            aria-hidden
                            className="h-9 w-1 flex-none rounded-full"
                            style={{ background: `var(--c-${entry.color})` }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">{entry.className}</p>
                            <p className="mt-0.5 text-[13px] tabular-nums text-ink-soft">
                              {entry.timeLabel}
                              {entry.location ? ` · ${entry.location}` : ""}
                              {entry.label ? ` · ${entry.label}` : ""}
                            </p>
                          </div>
                          <form action={deleteScheduleEventAction.bind(null, entry.scheduleEventId)}>
                            <button
                              title="Remove"
                              aria-label="Remove"
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                            >
                              <XIcon className="h-4 w-4" />
                            </button>
                          </form>
                        </li>
                      ) : (
                        <li key={`due-${entry.kind}-${entry.id}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                          <span
                            aria-hidden
                            className="course-tint flex h-9 w-9 flex-none items-center justify-center rounded-xl"
                            style={courseStyle(entry.color)}
                          >
                            {entry.kind === "exam" ? <PencilIcon className="h-4 w-4" /> : <ChecklistIcon className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug text-ink">
                              <span className="line-clamp-2">{entry.title}</span>
                            </p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-soft">
                              {entry.kind === "exam" && (
                                <span className="badge flex-none bg-danger-soft px-2 py-0 text-[11px] text-danger">Exam</span>
                              )}
                              <span className="truncate">
                                Due {entry.timeLabel} · {entry.className}
                              </span>
                            </p>
                          </div>
                          {entry.canvasUrl && (
                            <a
                              href={entry.canvasUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${entry.title} in Canvas`}
                              className="btn btn-ghost btn-sm flex-none px-2 sm:px-3"
                            >
                              <span className="hidden sm:inline">Canvas</span>
                              <ExternalIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                            </a>
                          )}
                        </li>
                      )
                    )}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <ScheduleAddForm classes={classes.map((c) => ({ id: c.id, name: c.name, color: c.color }))} />
        </div>
      )}
    </AppShell>
  );
}
