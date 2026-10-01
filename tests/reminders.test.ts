import { describe, it, expect } from "vitest";
import { planDueReminders, isReminderId, REMINDER_ID_BASE } from "@/lib/reminders";

const TZ = "America/New_York";
const NOW = new Date("2026-10-01T10:00:00-04:00"); // Thursday morning

describe("planDueReminders", () => {
  it("reminds at 7 PM the evening before, in the student's time zone", () => {
    const [plan] = planDueReminders(
      [{ title: "Homework (Ch 07)", className: "Microeconomics", dueAt: new Date("2026-10-03T23:59:00-04:00") }],
      NOW,
      TZ
    );
    expect(plan.at.toISOString()).toBe(new Date("2026-10-02T19:00:00-04:00").toISOString());
    expect(plan.title).toBe("Due tomorrow");
    expect(plan.body).toBe("Homework (Ch 07) (Microeconomics) is due at 11:59 PM.");
    expect(isReminderId(plan.id)).toBe(true);
  });

  it("sends one reminder per day, listing what's due", () => {
    const due = (title: string, time: string) => ({ title, className: "Class", dueAt: new Date(`2026-10-05T${time}-04:00`) });
    const plans = planDueReminders(
      [due("Reading 8", "23:30:00"), due("Quiz 3", "09:00:00"), due("Essay draft", "23:59:00"), due("Lab", "12:00:00")],
      NOW,
      TZ
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe("4 things due tomorrow");
    expect(plans[0].body).toBe("Quiz 3, Lab, Reading 8, and 1 more.");
  });

  it("skips work already past due and evenings already gone", () => {
    const plans = planDueReminders(
      [
        { title: "Late", className: "C", dueAt: new Date("2026-09-30T23:59:00-04:00") },
        { title: "Tonight", className: "C", dueAt: new Date("2026-10-01T23:59:00-04:00") },
      ],
      NOW,
      TZ
    );
    expect(plans).toEqual([]);
  });

  it("gives the same day the same id, so rescheduling replaces it", () => {
    const a = planDueReminders([{ title: "A", className: "C", dueAt: new Date("2026-10-06T09:00:00-04:00") }], NOW, TZ);
    const b = planDueReminders([{ title: "B", className: "C", dueAt: new Date("2026-10-06T22:00:00-04:00") }], NOW, TZ);
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toBeGreaterThanOrEqual(REMINDER_ID_BASE);
  });
});
