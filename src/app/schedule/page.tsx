import { formatInTimeZone } from "date-fns-tz";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ScheduleAddForm } from "@/components/schedule/ScheduleAddForm";
import { deleteScheduleEventAction } from "@/app/classes/[id]/actions";
import { canvasAssignmentUrl } from "@/lib/canvas";
import { dayKey, formatTzTime } from "@/lib/time";

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
      <h1 className="mb-1 font-display text-2xl font-semibold">Schedule</h1>
      <p className="mb-6 text-sm text-ink-soft">
        The next 7 days: your recurring class meetings alongside real assignment and exam due dates.
        Canvas doesn't provide meeting times, so those are added by hand below (or from a class's
        Overview tab) — due dates come straight from your assignments and exams.
      </p>

      {classes.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          Add a class first. Run <code className="font-mono">npm run db:seed</code> or{" "}
          <code className="font-mono">npm run canvas:sync</code>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-3">
            {days.map((day) => (
              <section key={day.key}>
                <h2 className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  {day.label}
                  <span className="font-normal normal-case text-ink-faint/70">{day.dateLabel}</span>
                </h2>
                {day.entries.length === 0 ? (
                  <div className="rounded-xl2 border border-dashed border-border-soft p-3 text-xs text-ink-faint">
                    Nothing on the calendar.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {day.entries.map((entry) =>
                      entry.type === "class" ? (
                        <li
                          key={`class-${entry.scheduleEventId}`}
                          className="flex items-center justify-between gap-3 rounded-xl2 border border-border-soft bg-surface p-3 shadow-card"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                              style={{ background: `var(--c-${entry.color})` }}
                            />
                            <div>
                              <div className="text-sm font-medium">{entry.className}</div>
                              <div className="text-xs text-ink-soft">
                                {entry.timeLabel}
                                {entry.location ? ` · ${entry.location}` : ""}
                                {entry.label ? ` · ${entry.label}` : ""}
                              </div>
                            </div>
                          </div>
                          <form action={deleteScheduleEventAction.bind(null, entry.scheduleEventId)}>
                            <button className="text-xs text-ink-faint hover:text-danger">Remove</button>
                          </form>
                        </li>
                      ) : (
                        <li
                          key={`due-${entry.kind}-${entry.id}`}
                          className="flex items-center justify-between gap-3 rounded-xl2 border border-dashed border-warn/50 bg-warn-soft/30 p-3"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                              style={{ background: `var(--c-${entry.color})` }}
                            />
                            <div>
                              <div className="text-sm font-medium">
                                {entry.kind === "exam" ? "📝 " : ""}
                                {entry.title}
                              </div>
                              <div className="text-xs text-ink-soft">
                                Due {entry.timeLabel} · {entry.className}
                              </div>
                            </div>
                          </div>
                          {entry.canvasUrl && (
                            <a
                              href={entry.canvasUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-none text-xs font-medium text-accent hover:underline"
                            >
                              Canvas ↗
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
