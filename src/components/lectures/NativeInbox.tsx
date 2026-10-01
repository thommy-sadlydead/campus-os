"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { formatInTimeZone } from "date-fns-tz";
import { hasNativePlugin, readInboxFile, SharedInbox, type InboxItem } from "@/lib/native-app";
import { inboxPickTime, suggestClassToRecord, type ScheduleSlot } from "@/lib/record-class";
import { formatMinutes } from "@/lib/time";
import { saveLectureAudio } from "./save-lecture-audio";
import type { RecordableClass } from "./RecordLecture";

interface Draft {
  classId: string;
  title: string;
  busy?: boolean;
  progress?: number;
  error?: string;
}

/**
 * In the iPhone app, recordings waiting to be added to a class: ones shared
 * from Voice Memos (or Files) and ones recorded here whose upload didn't
 * finish. The class is picked from the schedule by when the audio was
 * recorded, so adding one is usually a single tap.
 */
export function NativeInbox({
  classes,
  slots,
  timezone,
}: {
  classes: RecordableClass[];
  slots: ScheduleSlot[];
  timezone: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    const { items } = await SharedInbox.list();
    setItems(items);
    setDrafts((current) => {
      const next: Record<string, Draft> = {};
      for (const item of items) {
        const when = inboxPickTime(item);
        next[item.id] = current[item.id] ?? {
          classId: (when && suggestClassToRecord(slots, when, timezone)?.classId) || "",
          title: item.title,
        };
      }
      return next;
    });
  }, [slots, timezone]);

  useEffect(() => {
    if (!hasNativePlugin("SharedInbox")) return;
    void load();
    // Something shared from Voice Memos while the app was in the background.
    const listener = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void load();
    });
    return () => void listener.then((handle) => handle.remove());
  }, [load]);

  if (items.length === 0) return null;

  const update = (id: string, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...change } }));

  async function add(item: InboxItem) {
    const draft = drafts[item.id];
    if (!draft?.classId) return;
    update(item.id, { busy: true, error: undefined, progress: 0 });
    try {
      const file = await readInboxFile(item);
      const result = await saveLectureAudio(draft.classId, file, draft.title.trim() || item.title, (percent) =>
        update(item.id, { progress: percent })
      );
      if (result.error) {
        update(item.id, { busy: false, error: result.error });
        return;
      }
      await SharedInbox.remove({ id: item.id });
      router.push(`/classes/${draft.classId}?tab=lectures`);
    } catch {
      update(item.id, { busy: false, error: "The upload didn't finish. It's still saved here; try again." });
    }
  }

  async function remove(item: InboxItem) {
    if (!confirm(`Delete "${item.title}" from Campus OS? It's still in Voice Memos if it came from there.`)) return;
    await SharedInbox.remove({ id: item.id });
    void load();
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
        Waiting to be added <span className="font-normal">({items.length})</span>
      </h2>
      {items.map((item) => {
        const draft = drafts[item.id] ?? { classId: "", title: item.title };
        const meta = [
          item.source === "share" ? "Shared from another app" : "Recorded in Campus OS",
          item.durationSeconds ? formatMinutes(item.durationSeconds / 60) : null,
          item.recordedAt ? formatInTimeZone(new Date(item.recordedAt), timezone, "EEE, MMM d 'at' h:mm a") : null,
        ].filter(Boolean);
        return (
          <div key={item.id} className="flex flex-col gap-3 rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => update(item.id, { title: e.target.value })}
              disabled={draft.busy}
              aria-label="Lecture title"
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium outline-none focus:border-accent disabled:opacity-60"
            />
            <p className="text-xs text-ink-faint">{meta.join(" · ")}</p>
            <select
              value={draft.classId}
              onChange={(e) => update(item.id, { classId: e.target.value })}
              disabled={draft.busy}
              aria-label="Class"
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60"
            >
              <option value="" disabled>
                Choose a class…
              </option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {draft.busy ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm">{(draft.progress ?? 0) < 100 ? `Uploading… ${draft.progress ?? 0}%` : "Starting the transcript…"}</p>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(draft.progress ?? 0, 4)}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void add(item)}
                  disabled={!draft.classId}
                  className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-40"
                >
                  Add to class
                </button>
                <button onClick={() => void remove(item)} className="px-2 py-2.5 text-sm text-ink-faint hover:text-danger">
                  Delete
                </button>
              </div>
            )}
            {draft.error && <p className="text-sm text-danger">{draft.error}</p>}
          </div>
        );
      })}
    </section>
  );
}
