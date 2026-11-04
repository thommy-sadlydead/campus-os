"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClassOverviewAction, addScheduleEventAction, deleteScheduleEventsAction } from "@/app/classes/[id]/actions";
import { formatDueLabel } from "@/lib/time";
import { CardHeader } from "@/components/ui/CardHeader";
import { lmsName } from "@/lib/lms/providers";
import { PencilIcon, XIcon } from "@/components/icons";
import { DayPicker, SemesterDates } from "@/components/schedule/RepeatFields";
import { newMeetingProblem } from "@/components/schedule/ScheduleAddForm";
import { formatDays, formatMeetingDates, groupMeetings, timeLabel, type MeetingDates } from "@/lib/meetings";
import { useFeature } from "@/components/FeaturesProvider";
import { GradeCard, type GradeInfo } from "@/components/classes/GradeCard";
import { GetHelpCard, type HelpInfo } from "@/components/classes/GetHelpCard";

export interface OverviewClassInfo {
  id: string;
  code: string;
  name: string;
  professor: string | null;
  room: string | null;
  currentGrade: string | null;
  color: number;
  /** Where the class was synced from ("brightspace"), or null for one added by hand. */
  lmsProvider: string | null;
  nextAssignment: { title: string; dueAt: string | null } | null;
  nextExam: { title: string; examAt: string | null } | null;
  /** For Grades (src/lib/features.ts). */
  grade: GradeInfo;
  /** For Getting help. */
  help: HelpInfo;
}

export interface OverviewScheduleEvent {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  location: string | null;
  label: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface OverviewEmail {
  id: string;
  subject: string;
  category: string;
  receivedAt: string;
  gmailMessageId: string;
}

export function OverviewPanel({
  classInfo,
  scheduleEvents,
  semester,
  recentEmails,
  tz,
}: {
  classInfo: OverviewClassInfo;
  scheduleEvents: OverviewScheduleEvent[];
  /** The semester dates new meetings start with (see semesterToReuse). */
  semester: MeetingDates | null;
  recentEmails: OverviewEmail[];
  tz: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<number[]>([]);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const gradesOn = useFeature("grades");
  const helpOn = useFeature("get-help");
  const now = new Date();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <div className="card p-5">
          <CardHeader
            title="Details"
            action={
              <button onClick={() => setEditing((v) => !v)} className="btn btn-ghost btn-sm -mr-2 -mt-1">
                {!editing && <PencilIcon className="h-3.5 w-3.5" />}
                {editing ? "Cancel" : "Edit"}
              </button>
            }
          />

          {editing ? (
            <form
              // onSubmit, not action: React resets a form after its action,
              // which would wipe what was typed when the email is rejected.
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                setDetailsError(null);
                startTransition(async () => {
                  const result = await updateClassOverviewAction(classInfo.id, fd);
                  if (result?.error) {
                    setDetailsError(result.error);
                    return;
                  }
                  router.refresh();
                  setEditing(false);
                });
              }}
              className="mt-4 flex flex-col gap-3"
            >
              <Field label="Professor" name="professor" defaultValue={classInfo.professor ?? ""} placeholder="Dr. Jane Smith" />
              <Field label="Room" name="room" defaultValue={classInfo.room ?? ""} placeholder="Engineering Hall 210" />
              <Field
                label="Current grade"
                name="currentGrade"
                defaultValue={classInfo.currentGrade ?? ""}
                placeholder={gradesOn ? "88% or 45/50" : "B+ (only if you track it here)"}
              />
              {helpOn && (
                <>
                  <Field label="Professor's email" name="professorEmail" defaultValue={classInfo.help.professorEmail ?? ""} placeholder="jsmith@school.edu" />
                  <Field label="Office hours" name="officeHours" defaultValue={classInfo.help.officeHours ?? ""} placeholder="Tue and Thu 2–3 PM, Science 210" />
                </>
              )}
              {detailsError && (
                <p role="alert" className="text-[13px] text-danger">
                  {detailsError}
                </p>
              )}
              <button
                type="submit"
                disabled={pending}
                className="btn btn-primary btn-sm self-start"
              >
                Save
              </button>
            </form>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <Item label="Professor" value={classInfo.professor} />
              <Item label="Room" value={classInfo.room} />
              <Item label="Current grade" value={classInfo.currentGrade} />
              <Item label="Course code" value={classInfo.code} />
            </dl>
          )}
        </div>

        <div className="card p-5">
          <CardHeader title="Next up" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NextCard label="Next assignment" title={classInfo.nextAssignment?.title ?? null} dueLabel={classInfo.nextAssignment ? formatDueLabel(classInfo.nextAssignment.dueAt ? new Date(classInfo.nextAssignment.dueAt) : null, now, tz) : null} />
            <NextCard label="Next exam" title={classInfo.nextExam?.title ?? null} dueLabel={classInfo.nextExam ? formatDueLabel(classInfo.nextExam.examAt ? new Date(classInfo.nextExam.examAt) : null, now, tz) : null} />
          </div>
        </div>

        {/* Keyed by the grade so the calculator starts over from a new one. */}
        {gradesOn && <GradeCard key={String(classInfo.grade.percent)} classId={classInfo.id} lmsProvider={classInfo.lmsProvider} grade={classInfo.grade} tz={tz} />}
        {helpOn && (
          <GetHelpCard
            classId={classInfo.id}
            className={classInfo.name}
            classCode={classInfo.code || null}
            professor={classInfo.professor}
            help={classInfo.help}
            initialReason={classInfo.grade.slip ? "grade" : "question"}
          />
        )}

        {recentEmails.length > 0 && (
          <div className="card p-5">
            <CardHeader title="From your email" />
            <ul className="mt-4 flex flex-col gap-1.5">
              {recentEmails.map((e) => (
                <li key={e.id}>
                  <a
                    href={`https://mail.google.com/mail/u/0/#all/${e.gmailMessageId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink transition-colors hover:bg-border-soft"
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

      <div className="card h-fit p-5">
        <CardHeader
          title="Meeting times"
          description={
            lmsName(classInfo.lmsProvider)
              ? `These don't come over from ${lmsName(classInfo.lmsProvider)}, so add them yourself.`
              : "Add the times this class meets."
          }
        />

        {scheduleEvents.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5">
            {groupMeetings(scheduleEvents).map((m) => {
              const dates = formatMeetingDates(m);
              return (
                <li key={m.ids.join()} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 py-1.5 pl-3 pr-1.5 text-sm">
                  <span className="min-w-0 tabular-nums">
                    <span className="font-medium text-ink">{formatDays(m.days)}</span> {timeLabel(m.startMinute)}–{timeLabel(m.endMinute)}
                    {m.location ? ` · ${m.location}` : ""}
                    {m.label ? ` · ${m.label}` : ""}
                    <span className="block text-xs text-ink-faint">{dates ? `Weekly, ${dates}` : "Every week"}</span>
                  </span>
                  <form
                    action={() => {
                      startTransition(async () => {
                        await deleteScheduleEventsAction(m.ids);
                        router.refresh();
                      });
                    }}
                  >
                    <button
                      title="Remove"
                      aria-label="Remove"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        <form
          // onSubmit, not action: React empties a form after its action runs,
          // which would wipe what the student typed when there's a problem to fix.
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            if (days.length === 0) return;
            const problem = newMeetingProblem(fd);
            setMeetingError(problem);
            if (problem) return;
            startTransition(async () => {
              const result = await addScheduleEventAction(classInfo.id, fd);
              if (result.error) {
                setMeetingError(result.error);
                return;
              }
              form.reset();
              setDays([]);
              router.refresh();
            });
          }}
          className="mt-4 flex flex-col gap-2 border-t border-border-soft pt-4"
        >
          <DayPicker days={days} onChange={setDays} compact />
          <div className="flex gap-2">
            <input type="time" name="start" required className="field field-sm w-full" />
            <input type="time" name="end" required className="field field-sm w-full" />
          </div>
          <input type="text" name="location" placeholder="Room (optional)" className="field field-sm w-auto" />
          <input type="text" name="label" placeholder="Lecture / Lab / Discussion (optional)" className="field field-sm w-auto" />
          <SemesterDates initial={semester} compact />
          {meetingError && (
            <p role="alert" className="text-xs text-danger">
              {meetingError}
            </p>
          )}
          <button type="submit" disabled={pending || days.length === 0} className="btn btn-secondary btn-sm">
            {days.length > 1 ? `Add on ${days.length} days` : "Add meeting time"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue: string; placeholder: string }) {
  return (
    <label className="flex flex-col">
      <span className="field-label">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="field field-sm font-normal w-auto"
      />
    </label>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-1 font-medium text-ink">{value || <span className="font-normal text-ink-faint">Not set</span>}</dd>
    </div>
  );
}

function NextCard({ label, title, dueLabel }: { label: string; title: string | null; dueLabel: string | null }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3.5">
      <div className="eyebrow">{label}</div>
      {title ? (
        <>
          <div className="mt-1.5 truncate text-sm font-semibold text-ink">{title}</div>
          <div className="mt-0.5 text-xs text-ink-soft">{dueLabel}</div>
        </>
      ) : (
        <div className="mt-1 text-sm text-ink-faint">Nothing on file</div>
      )}
    </div>
  );
}
