"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  connectFeedAction,
  previewFeedAction,
  previewSavedFeedAction,
  saveFeedCoursesAction,
  type FeedPreviewResult,
} from "@/app/connect/feed-actions";
import type { FeedProvider } from "@/lib/lms/providers";
import { PlusIcon, XIcon } from "@/components/icons";

const MAX_LINKS = 12;

interface Row {
  key: string;
  /** The name the calendar gave it; only a different name is saved as the student's choice. */
  detected: string;
  name: string;
  include: boolean;
  assignments: number;
  exams: number;
  samples: string[];
}

function rowsFrom(result: FeedPreviewResult): Row[] {
  return (result.courses ?? []).map((course) => {
    const choice = result.choices?.[course.key];
    return {
      key: course.key,
      detected: course.name,
      name: choice?.name ?? course.name,
      include: !choice?.skip,
      assignments: course.assignments,
      exams: course.exams,
      samples: course.samples,
    };
  });
}

function choicesFrom(rows: Row[]) {
  return Object.fromEntries(
    rows.map((r) => {
      const name = r.name.trim();
      return [r.key, { ...(name && name !== r.detected ? { name } : {}), ...(r.include ? {} : { skip: true }) }];
    })
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Connecting Brightspace or Blackboard: paste the calendar link (or one
 * per course), see the classes it holds, rename or leave any out, then
 * connect. With mode "edit" it starts from the saved links instead, for
 * changing those choices later.
 */
export function FeedConnect({
  provider,
  providerName,
  mode,
}: {
  provider: FeedProvider;
  providerName: string;
  mode: "connect" | "edit";
}) {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>([""]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [problems, setProblems] = useState<NonNullable<FeedPreviewResult["problems"]>>([]);
  const [ignored, setIgnored] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function show(result: FeedPreviewResult) {
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(rowsFrom(result));
    setProblems(result.problems ?? []);
    setIgnored(result.ignored ?? 0);
  }

  function check() {
    startTransition(async () => show(await previewFeedAction(provider, urls)));
  }

  function openEditor() {
    setEditing(true);
    setMessage(null);
    startTransition(async () => show(await previewSavedFeedAction(provider)));
  }

  function save() {
    if (!rows) return;
    startTransition(async () => {
      if (mode === "connect") {
        const result = await connectFeedAction(provider, urls, choicesFrom(rows));
        if (result.error) setError(result.error);
        else router.refresh();
        return;
      }
      const result = await saveFeedCoursesAction(provider, choicesFrom(rows));
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "Saved.");
      setEditing(false);
      setRows(null);
      router.refresh();
    });
  }

  const update = (key: string, change: Partial<Row>) =>
    setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...change } : r)) ?? prev);

  if (mode === "edit" && !editing) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={openEditor} className="btn btn-secondary btn-sm">
          Edit classes
        </button>
        {message && (
          <span className="text-xs text-ink-faint" aria-live="polite">
            {message}
          </span>
        )}
      </div>
    );
  }

  if (!rows) {
    if (mode === "edit") {
      return (
        <div className="mt-4">
          {error ? (
            <div className="flex flex-col items-start gap-3">
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-faint">Reading your calendar…</p>
          )}
        </div>
      );
    }
    return (
      <div className="mt-5 flex flex-col gap-3">
        <label htmlFor="feed-url-0" className="field-label mb-0">
          Calendar link
        </label>
        {urls.map((url, i) => (
          <div key={i} className="flex gap-2">
            <input
              id={`feed-url-${i}`}
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              aria-label={i === 0 ? undefined : `Calendar link ${i + 1}`}
              placeholder={provider === "brightspace" ? "https://…/d2l/le/calendar/feed/…" : "https://…/calendarFeed/…/learn.ics"}
              value={url}
              onChange={(e) => setUrls((prev) => prev.map((u, j) => (j === i ? e.target.value : u)))}
              className="field"
            />
            {urls.length > 1 && (
              <button
                type="button"
                aria-label={`Remove calendar link ${i + 1}`}
                onClick={() => setUrls((prev) => prev.filter((_, j) => j !== i))}
                className="btn btn-ghost w-10 flex-none px-0"
              >
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {urls.length < MAX_LINKS && (
          <button
            type="button"
            onClick={() => setUrls((prev) => [...prev, ""])}
            className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-accent-ink hover:underline"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add another link
          </button>
        )}
        <p className="text-xs text-ink-faint">
          One link for all your courses is best. Add more only if your courses each have their own.
        </p>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <button
          type="button"
          onClick={check}
          disabled={pending || !urls.some((u) => u.trim())}
          className="btn btn-primary mt-1 w-full"
        >
          {pending ? "Reading your calendar…" : "Next"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      <p className="text-sm text-ink-soft">
        {rows.length === 1 ? "Found 1 class" : `Found ${rows.length} classes`} in your calendar. Rename any of them, or untick
        one to leave it out.
      </p>
      <ul className="flex flex-col divide-y divide-border-soft border-y border-border-soft">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3 py-3">
            <input
              type="checkbox"
              checked={r.include}
              onChange={(e) => update(r.key, { include: e.target.checked })}
              aria-label={`Sync ${r.name || r.detected}`}
              className="mt-2.5 h-4 w-4 flex-none accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={r.name}
                maxLength={120}
                disabled={!r.include}
                onChange={(e) => update(r.key, { name: e.target.value })}
                aria-label="Class name"
                className="field field-sm"
              />
              <p className="mt-1 text-xs text-ink-faint">
                {plural(r.assignments, "due date")}
                {r.exams > 0 && ` · ${plural(r.exams, "exam")}`}
              </p>
              {r.samples.length > 0 && <p className="mt-0.5 truncate text-xs text-ink-faint">Like {r.samples.join(", ")}</p>}
            </div>
          </li>
        ))}
      </ul>
      {problems.length > 0 && (
        <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {problems.map((p) => (
            <p key={p.index}>
              Link {p.index + 1}: {p.message}
            </p>
          ))}
        </div>
      )}
      {ignored > 0 && (
        <p className="text-xs leading-relaxed text-ink-faint">
          Left out {plural(ignored, "calendar item")} that {ignored === 1 ? "isn't a due date or an exam" : "aren't due dates or exams"}, like
          class meetings and &quot;available from&quot; dates.
        </p>
      )}
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setRows(null);
            setError(null);
            if (mode === "edit") setEditing(false);
          }}
          disabled={pending}
          className="btn btn-secondary"
        >
          {mode === "edit" ? "Cancel" : "Back"}
        </button>
        <button type="button" onClick={save} disabled={pending || !rows.some((r) => r.include)} className="btn btn-primary flex-1">
          {pending ? (mode === "edit" ? "Saving…" : "Connecting…") : mode === "edit" ? "Save classes" : `Connect ${providerName}`}
        </button>
      </div>
    </div>
  );
}
