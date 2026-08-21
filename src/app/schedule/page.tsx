import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { ScheduleAddForm } from "@/components/schedule/ScheduleAddForm";
import { deleteScheduleEventAction } from "@/app/classes/[id]/actions";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default async function SchedulePage() {
  const user = await requireUser();

  const [classes, events] = await Promise.all([
    prisma.class.findMany({ where: { userId: user.id, archived: false }, orderBy: { name: "asc" } }),
    prisma.scheduleEvent.findMany({
      where: { class: { userId: user.id } },
      include: { class: true },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
  ]);

  const byDay = new Map<number, typeof events>();
  for (const ev of events) {
    const list = byDay.get(ev.dayOfWeek) ?? [];
    list.push(ev);
    byDay.set(ev.dayOfWeek, list);
  }

  return (
    <AppShell active="/schedule" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Schedule</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Your recurring weekly meeting times. Canvas doesn't provide these, so they're added by hand
        here (or confirmed from a professor's email) — you can also add them from a class's Overview tab.
      </p>

      {classes.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          Add a class first. Run <code className="font-mono">npm run db:seed</code> or{" "}
          <code className="font-mono">npm run canvas:sync</code>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-3">
            {[1, 2, 3, 4, 5, 0, 6].map((day) => {
              const dayEvents = byDay.get(day) ?? [];
              if (dayEvents.length === 0) return null;
              return (
                <section key={day}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    {DAY_LABELS[day]}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {dayEvents.map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-center justify-between gap-3 rounded-xl2 border border-border-soft bg-surface p-3 shadow-card"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                            style={{ background: `var(--c-${ev.class.color})` }}
                          />
                          <div>
                            <div className="text-sm font-medium">{ev.class.name}</div>
                            <div className="text-xs text-ink-soft">
                              {minutesToLabel(ev.startMinute)}–{minutesToLabel(ev.endMinute)}
                              {ev.location ? ` · ${ev.location}` : ""}
                              {ev.label ? ` · ${ev.label}` : ""}
                            </div>
                          </div>
                        </div>
                        <form action={deleteScheduleEventAction.bind(null, ev.id)}>
                          <button className="text-xs text-ink-faint hover:text-danger">Remove</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {events.length === 0 && (
              <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
                No meeting times added yet — use the form to add your first one.
              </div>
            )}
          </div>

          <ScheduleAddForm classes={classes.map((c) => ({ id: c.id, name: c.name, color: c.color }))} />
        </div>
      )}
    </AppShell>
  );
}
