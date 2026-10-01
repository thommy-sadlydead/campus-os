import { fromZonedTime } from "date-fns-tz";
import { dayKey, formatTzTime } from "@/lib/time";

// Due-date reminders for the iPhone app: one notification the evening
// before each day something is due, listing what's due. Pure, so it can be
// tested; NativeReminders schedules the result on the phone.

export interface ReminderDeadline {
  title: string;
  className: string;
  dueAt: Date;
}

export interface PlannedReminder {
  /** Stable per due day, so rescheduling replaces rather than duplicates. */
  id: number;
  at: Date;
  title: string;
  body: string;
}

/** Notification ids this feature owns: REMINDER_ID_BASE up to REMINDER_ID_BASE + 999. */
export const REMINDER_ID_BASE = 41_000;
export const REMINDER_HOUR = 19; // 7 PM, the evening before

const DAY_MS = 24 * 60 * 60 * 1000;

function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function isReminderId(id: number): boolean {
  return id >= REMINDER_ID_BASE && id < REMINDER_ID_BASE + 1000;
}

export function planDueReminders(deadlines: ReminderDeadline[], now: Date, tz: string): PlannedReminder[] {
  const byDay = new Map<string, ReminderDeadline[]>();
  for (const deadline of deadlines) {
    if (deadline.dueAt.getTime() <= now.getTime()) continue;
    const day = dayKey(deadline.dueAt, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), deadline]);
  }

  const plans: PlannedReminder[] = [];
  for (const [day, list] of byDay) {
    const at = fromZonedTime(`${previousDay(day)}T${String(REMINDER_HOUR).padStart(2, "0")}:00:00`, tz);
    if (at.getTime() <= now.getTime()) continue; // too late for a heads-up; the dashboard shows it
    const due = [...list].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    const id = REMINDER_ID_BASE + (Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS) % 1000);
    if (due.length === 1) {
      plans.push({
        id,
        at,
        title: "Due tomorrow",
        body: `${due[0].title} (${due[0].className}) is due at ${formatTzTime(due[0].dueAt, tz)}.`,
      });
    } else {
      const shown = due.slice(0, 3).map((d) => d.title);
      const more = due.length - shown.length;
      plans.push({
        id,
        at,
        title: `${due.length} things due tomorrow`,
        body: more > 0 ? `${shown.join(", ")}, and ${more} more.` : `${shown.join(", ")}.`,
      });
    }
  }
  return plans.sort((a, b) => a.at.getTime() - b.at.getTime());
}
