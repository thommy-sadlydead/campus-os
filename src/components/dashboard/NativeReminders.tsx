"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalNotifications } from "@capacitor/local-notifications";
import { isNativeApp } from "@/lib/native-app";
import { isReminderId, planDueReminders } from "@/lib/reminders";

const DISMISSED_KEY = "campusos-reminders-not-now";

/**
 * In the iPhone app: offers due-date reminders once, and while they're on,
 * reschedules them each time the dashboard opens, so they follow the
 * latest due dates. Renders nothing on the website.
 */
export function NativeReminders({
  deadlines,
  timezone,
}: {
  deadlines: Array<{ title: string; className: string; dueAt: string }>;
  timezone: string;
}) {
  const [offer, setOffer] = useState(false);

  const schedule = useCallback(async () => {
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter((n) => isReminderId(n.id));
    if (ours.length > 0) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
    const plans = planDueReminders(
      deadlines.map((d) => ({ ...d, dueAt: new Date(d.dueAt) })),
      new Date(),
      timezone
    );
    if (plans.length === 0) return;
    await LocalNotifications.schedule({
      notifications: plans.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        schedule: { at: p.at, allowWhileIdle: true },
        extra: { route: "/dashboard" },
      })),
    });
  }, [deadlines, timezone]);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    void (async () => {
      const { display } = await LocalNotifications.checkPermissions();
      if (display === "granted") return schedule();
      if (display === "denied" || cancelled) return;
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
      } catch {
        // storage unavailable: offer again, that's all
      }
      if (!dismissed && !cancelled) setOffer(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [schedule]);

  async function turnOn() {
    setOffer(false);
    const { display } = await LocalNotifications.requestPermissions();
    if (display === "granted") await schedule();
  }

  function notNow() {
    setOffer(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // as above
    }
  }

  if (!offer) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl2 border border-border-soft bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">Get reminders on this iPhone?</p>
        <p className="mt-0.5 text-sm text-ink-soft">A heads-up at 7 PM the evening before something&apos;s due.</p>
      </div>
      <div className="flex flex-none gap-2">
        <button onClick={notNow} className="rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-surface-2">
          Not now
        </button>
        <button
          onClick={() => void turnOn()}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface hover:opacity-90"
        >
          Turn on reminders
        </button>
      </div>
    </div>
  );
}
