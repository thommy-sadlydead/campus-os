"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClassOverviewAction, addScheduleEventAction, deleteScheduleEventAction } from "@/app/classes/[id]/actions";
import { formatDueLabel } from "@/lib/time";

export interface OverviewClassInfo {
  id: string;
  code: string;
  name: string;
  professor: string | null;
  room: string | null;
  currentGrade: string | null;
  color: number;
  nextAssignment: { title: string; dueAt: string | null } | null;
  nextExam: { title: string; examAt: string | null } | null;
}

export interface OverviewScheduleEvent {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  location: string | null;
  label: string | null;
}

export interface OverviewEmail {
  id: string;
  subject: string;
  category: string;
  receivedAt: string;
  gmailMessageId: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function OverviewPanel({
  classInfo,
  scheduleEvents,
  recentEmails,
  tz,
}: {
  classInfo: OverviewClassInfo;
  scheduleEvents: OverviewScheduleEvent[];
  recentEmails: OverviewEmail[];
  tz: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const now = new Date();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Details</h3>
            <button onClick={() => setEditing((v) => !v)} className="text-xs font-medium text-accent-ink hover:underline">
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>

          {editing ? (
            <form
              action={(fd) => {
                startTransition(async () => {
                  await updateClassOverviewAction(classInfo.id, fd);
                  router.refresh();
                  setEditing(false);
                });
              }}
              className="mt-3 flex flex-col gap-3"
            >
              <Field label="Professor" name="professor" defaultValue={classInfo.professor ?? ""} placeholder="Dr. Jane Smith" />
              <Field label="Room" name="room" defaultValue={classInfo.room ?? ""} placeholder="Engineering Hall 210" />
              <Field label="Current grade" name="currentGrade" defaultValue={classInfo.currentGrade ?? ""} placeholder="B+ (only if you track it here)" />
              <button
                type="submit"
                disabled={pending}
                className="self-start rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-surface hover:opacity-90 disabled:opacity-60"
              >
                Save
              </button>
            </form>
          ) : (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Item label="Professor" value={classInfo.professor} />
              <Item label="Room" value={classInfo.room} />
              <Item label="Current grade" value={classInfo.currentGrade} />
              <Item label="Course code" value={classInfo.code} />
            </dl>
          )}
        </div>

        <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
          <h3 className="font-display text-base font-semibold">Next up</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NextCard label="Next assignment" title={classInfo.nextAssignment?.title ?? null} dueLabel={classInfo.nextAssignment ? formatDueLabel(classInfo.nextAssignment.dueAt ? new Date(classInfo.nextAssignment.dueAt) : null, now, tz) : null} />
            <NextCard label="Next exam" title={classInfo.nextExam?.title ?? null} dueLabel={classInfo.nextExam ? formatDueLabel(classInfo.nextExam.examAt ? new Date(classInfo.nextExam.examAt) : null, now, tz) : null} />
          </div>
        </div>

        {recentEmails.length > 0 && (
          <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
            <h3 className="font-display text-base font-semibold">From your email</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {recentEmails.map((e) => (
                <li key={e.id}>
                  <a
                    href={`https://mail.google.com/mail/u/0/#all/${e.gmailMessageId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm hover:underline"
                  >
                    <span className="truncate">{e.subject}</span>
                    <span className="flex-none text-xs text-ink-faint">{new Date(e.receivedAt).toLocaleDateString()}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
        <h3 className="font-display text-base font-semibold">Meeting times</h3>
        <p className="mt-0.5 text-xs text-ink-faint">Canvas doesn't provide these — add them yourself.</p>

        {scheduleEvents.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {scheduleEvents
              .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute)
              .map((ev) => (
                <li key={ev.id} className="flex items-center justify-between rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm">
                  <span>
                    {DAY_LABELS[ev.dayOfWeek]} {minutesToLabel(ev.startMinute)}–{minutesToLabel(ev.endMinute)}
                    {ev.location ? ` · ${ev.location}` : ""}
                    {ev.label ? ` · ${ev.label}` : ""}
                  </span>
                  <form
                    action={() => {
                      startTransition(async () => {
                        await deleteScheduleEventAction(ev.id);
                        router.refresh();
                      });
                    }}
                  >
                    <button className="text-xs text-ink-faint hover:text-danger">Remove</button>
                  </form>
                </li>
              ))}
          </ul>
        )}

        <form
          action={(fd) => {
            startTransition(async () => {
              await addScheduleEventAction(classInfo.id, fd);
              router.refresh();
            });
          }}
          className="mt-3 flex flex-col gap-2"
        >
          <select name="dayOfWeek" defaultValue="1" className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent">
            {DAY_LABELS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input type="time" name="start" required className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <input type="time" name="end" required className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent" />
          </div>
          <input type="text" name="location" placeholder="Room (optional)" className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent" />
          <input type="text" name="label" placeholder="Lecture / Lab / Discussion (optional)" className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent" />
          <button type="submit" disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60">
            Add meeting time
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue: string; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
      {label}
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-accent"
      />
    </label>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-medium">{value || <span className="font-normal text-ink-faint">Not set</span>}</dd>
    </div>
  );
}

function NextCard({ label, title, dueLabel }: { label: string; title: string | null; dueLabel: string | null }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      {title ? (
        <>
          <div className="mt-1 truncate text-sm font-medium">{title}</div>
          <div className="text-xs text-ink-soft">{dueLabel}</div>
        </>
      ) : (
        <div className="mt-1 text-sm text-ink-faint">Nothing on file</div>
      )}
    </div>
  );
}
