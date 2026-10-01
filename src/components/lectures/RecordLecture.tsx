"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClassSuggestion, ScheduleSlot } from "@/lib/record-class";
import { LectureRecorder } from "./LectureRecorder";
import { AudioUpload } from "./AudioUpload";
import { NativeInbox } from "./NativeInbox";

export interface RecordableClass {
  id: string;
  name: string;
  code: string;
  color: number;
}

const SUGGESTION_LABEL: Record<ClassSuggestion["reason"], string> = {
  "in-session": "in session now",
  "starting-soon": "starting soon",
  "just-ended": "just ended",
};

/**
 * The Record page: pick a class (chosen for you from your schedule when one
 * is meeting now), then record, or upload a recording such as a Voice
 * Memo. When it's saved, you land on that class's Lectures tab, where the
 * transcript and notes appear.
 */
export function RecordLecture({
  classes,
  suggestion,
  defaultTitle,
  slots,
  timezone,
}: {
  classes: RecordableClass[];
  suggestion: ClassSuggestion | null;
  defaultTitle: string;
  /** The weekly schedule, for picking the class of a recording shared into the app. */
  slots: ScheduleSlot[];
  timezone: string;
}) {
  const router = useRouter();
  const [classId, setClassId] = useState<string>(suggestion?.classId ?? "");
  const [mode, setMode] = useState<"record" | "upload">("record");
  const [busy, setBusy] = useState(false);

  if (classes.length === 0) {
    return (
      <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        Recordings are saved to a class, and you don&apos;t have any yet.{" "}
        <Link href="/canvas" className="font-medium text-accent-ink underline">
          Connect Canvas
        </Link>{" "}
        to bring in your classes.
      </div>
    );
  }

  const suggested = suggestion && classes.find((c) => c.id === suggestion.classId);
  const onSaved = (savedClassId: string) => router.push(`/classes/${savedClassId}?tab=lectures`);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <NativeInbox classes={classes} slots={slots} timezone={timezone} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="record-class" className="text-xs font-medium text-ink-soft">
          Class
        </label>
        <select
          id="record-class"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          disabled={busy}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60"
        >
          <option value="" disabled>
            Choose a class…
          </option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {suggested && c.id === suggested.id ? ` (${SUGGESTION_LABEL[suggestion.reason]})` : ""}
            </option>
          ))}
        </select>
        {!suggested && (
          <p className="text-xs text-ink-faint">
            No class is on your schedule right now. Add meeting times on the Schedule page and Campus OS will pick
            the class for you.
          </p>
        )}
      </div>

      <div className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
        <div className="flex rounded-lg border border-border p-0.5">
          {(["record", "upload"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              disabled={busy}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                mode === value ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"
              }`}
            >
              {value === "record" ? "Record now" : "Upload a recording"}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {mode === "record" ? (
            <LectureRecorder
              classId={classId || null}
              defaultTitle={defaultTitle}
              onSaved={onSaved}
              onBusyChange={setBusy}
            />
          ) : (
            <AudioUpload classId={classId || null} onSaved={onSaved} />
          )}
        </div>
      </div>
    </div>
  );
}
