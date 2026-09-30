"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MARKDOWN_CLASSNAME } from "@/lib/markdown";
import {
  addLectureNotesToNotesAction,
  createLectureFromTranscriptAction,
  deleteLectureAction,
  pollLectureStatusAction,
  retryLectureAction,
} from "@/app/classes/[id]/lecture-actions";
import { isLectureInProgress, lectureStatusLabel, type LectureStatus } from "@/lib/lecture-notes";
import { LectureRecorder } from "@/components/lectures/LectureRecorder";
import { AudioUpload } from "@/components/lectures/AudioUpload";

export interface LectureRow {
  id: string;
  title: string;
  status: LectureStatus;
  transcriptText: string | null;
  notesMarkdown: string | null;
  errorMessage: string | null;
  createdAt: string; // ISO
  // The lecture's note in the Notes tab (src/lib/lecture-notes-sync.ts),
  // shown here instead of notesMarkdown so edits there show up here too.
  note: { id: string; bodyMarkdown: string } | null;
}

const STATUS_TONE: Record<LectureStatus, string> = {
  UPLOADED: "bg-surface-2 text-ink-soft",
  TRANSCRIBING: "bg-warn-soft text-warn",
  GENERATING_NOTES: "bg-warn-soft text-warn",
  READY: "bg-ok-soft text-ok",
  FAILED: "bg-danger-soft text-danger",
};

const POLL_INTERVAL_MS = 4000;

export function LecturesPanel({
  classId,
  lectures,
  defaultTitle,
  materialCount,
  focusLectureId,
  onOpenNote,
  onOpenResources,
}: {
  classId: string;
  lectures: LectureRow[];
  defaultTitle: string;
  materialCount: number;
  focusLectureId: string | null;
  onOpenNote: (noteId: string) => void;
  onOpenResources: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openLectureId, setOpenLectureId] = useState<string | null>(focusLectureId);

  useEffect(() => {
    if (!focusLectureId) return;
    setOpenLectureId(focusLectureId);
    document.getElementById(`lecture-${focusLectureId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusLectureId]);

  // Only lecture ids, joined into one primitive string — using the
  // lectures/objects themselves as a dependency would re-arm this effect
  // (and reset the poll timer) on every render, since a fresh array/object
  // comes down as props each time.
  const inProgressKey = lectures
    .filter((l) => isLectureInProgress(l.status))
    .map((l) => l.id)
    .join(",");

  useEffect(() => {
    if (!inProgressKey) return;
    const ids = inProgressKey.split(",");
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    // A self-scheduling loop, not setInterval: note generation can now
    // legitimately take well over POLL_INTERVAL_MS (a full lecture's notes,
    // not truncated), and setInterval fires on a fixed clock regardless of
    // whether the previous tick's request ever returned. That would stack
    // up overlapping pollLectureStatusAction calls — each one still
    // "GENERATING_NOTES" would kick off its own redundant, concurrent,
    // costly generateNotes call for the same lecture. Waiting for one poll
    // to fully resolve before scheduling the next guarantees only one is
    // ever in flight.
    async function pollOnce() {
      await Promise.all(ids.map((id) => pollLectureStatusAction(id)));
      if (cancelled) return;
      startTransition(() => {
        router.refresh();
      });
      timeoutId = setTimeout(pollOnce, POLL_INTERVAL_MS);
    }

    timeoutId = setTimeout(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [inProgressKey, router]);

  return (
    <div className="flex flex-col gap-4">
      <AddLectureCard classId={classId} defaultTitle={defaultTitle} onDone={() => router.refresh()} />

      <p className="text-xs text-ink-faint">
        Notes are written from the recording, using{" "}
        <button onClick={onOpenResources} className="font-medium text-ink-soft underline hover:text-ink">
          {materialCount > 0 ? `this class's ${materialCount} books and slides` : "any books and slides you add"}
        </button>{" "}
        for extra detail. They also show up in the Notes tab.
      </p>

      {lectures.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No lectures yet. Record one above, or upload a recording you already have.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {lectures.map((lecture) => (
            <LectureCard
              key={lecture.id}
              lecture={lecture}
              isOpen={openLectureId === lecture.id}
              onToggleOpen={() => setOpenLectureId(openLectureId === lecture.id ? null : lecture.id)}
              onDelete={() => {
                const keepsNotes = lecture.note
                  ? " Its notes stay in the Notes tab."
                  : " Its notes are deleted too.";
                if (!confirm(`Delete "${lecture.title}"? This deletes the recording and transcript.${keepsNotes}`)) return;
                startTransition(async () => {
                  await deleteLectureAction(lecture.id);
                  router.refresh();
                });
              }}
              onRetry={() => {
                startTransition(async () => {
                  await retryLectureAction(lecture.id);
                  router.refresh();
                });
              }}
              onOpenNote={onOpenNote}
              onAddToNotes={() => {
                startTransition(async () => {
                  const { noteId } = await addLectureNotesToNotesAction(lecture.id);
                  router.refresh();
                  if (noteId) onOpenNote(noteId);
                });
              }}
              pending={pending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adding a lecture: record it here, upload a recording (Voice Memos and so
// on), or paste a transcript, which skips straight to note generation.
// ---------------------------------------------------------------------------

function AddLectureCard({
  classId,
  defaultTitle,
  onDone,
}: {
  classId: string;
  defaultTitle: string;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"record" | "upload" | "transcript">("record");
  const [busy, setBusy] = useState(false);

  const tab = (value: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      disabled={busy}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 sm:flex-none ${
        mode === value ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-display text-base font-semibold">Add a lecture</h4>
        <div className="flex w-full rounded-lg border border-border p-0.5 sm:w-auto">
          {tab("record", "Record")}
          {tab("upload", "Upload")}
          {tab("transcript", "Paste transcript")}
        </div>
      </div>
      <div className="mt-3">
        {mode === "record" && (
          <LectureRecorder classId={classId} defaultTitle={defaultTitle} onSaved={onDone} onBusyChange={setBusy} />
        )}
        {mode === "upload" && <AudioUpload classId={classId} onSaved={onDone} />}
        {mode === "transcript" && <TranscriptForm classId={classId} defaultTitle={defaultTitle} onDone={onDone} />}
      </div>
    </div>
  );
}

function TranscriptForm({ classId, defaultTitle, onDone }: { classId: string; defaultTitle: string; onDone: () => void }) {
  const [title, setTitle] = useState(defaultTitle);
  const [transcriptText, setTranscriptText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = transcriptText.trim();
    if (!trimmed) {
      setError("Paste a transcript first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createLectureFromTranscriptAction(classId, {
        title: title.trim() || defaultTitle,
        transcriptText: trimmed,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTranscriptText("");
      onDone();
    } catch {
      setError("Couldn't make notes from that. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Lecture title"
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <textarea
        value={transcriptText}
        onChange={(e) => setTranscriptText(e.target.value)}
        rows={6}
        placeholder="Paste the lecture transcript here…"
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="flex items-center justify-end gap-3">
        {error && <p className="mr-auto text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Writing notes… (about a minute)" : "Make notes"}
        </button>
      </div>
    </form>
  );
}

function LectureCard({
  lecture,
  isOpen,
  onToggleOpen,
  onDelete,
  onRetry,
  onOpenNote,
  onAddToNotes,
  pending,
}: {
  lecture: LectureRow;
  isOpen: boolean;
  onToggleOpen: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onOpenNote: (noteId: string) => void;
  onAddToNotes: () => void;
  pending: boolean;
}) {
  const date = new Date(lecture.createdAt);
  const notes = lecture.note?.bodyMarkdown ?? lecture.notesMarkdown;

  return (
    <li id={`lecture-${lecture.id}`} className="scroll-mt-4 rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onToggleOpen} className="min-w-0 flex-1 text-left" aria-expanded={isOpen}>
          <span className="font-medium">{lecture.title}</span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            {date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </span>
        </button>
        <div className="flex flex-none items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[lecture.status]}`}>
            {lectureStatusLabel(lecture.status)}
          </span>
          <button onClick={onDelete} className="text-xs text-ink-faint hover:text-danger">
            Delete
          </button>
        </div>
      </div>

      {lecture.status === "FAILED" && lecture.errorMessage && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-danger-soft p-2.5 text-xs text-danger">
          <span>{lecture.errorMessage}</span>
          <button onClick={onRetry} disabled={pending} className="flex-none font-medium underline disabled:opacity-60">
            Try again
          </button>
        </div>
      )}

      {isLectureInProgress(lecture.status) && (
        <p className="mt-2 text-xs text-ink-faint">
          Transcribing and writing notes. This usually takes a few minutes; you can leave this page.
        </p>
      )}

      {isOpen && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border-soft pt-3">
          {notes && (
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Notes</h5>
                {lecture.note ? (
                  <button
                    onClick={() => onOpenNote(lecture.note!.id)}
                    className="text-xs font-medium text-accent-ink hover:underline"
                  >
                    Edit in Notes
                  </button>
                ) : (
                  <button
                    onClick={onAddToNotes}
                    disabled={pending}
                    className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-60"
                  >
                    Add to Notes tab
                  </button>
                )}
              </div>
              <div className={MARKDOWN_CLASSNAME}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
              </div>
            </div>
          )}
          {lecture.transcriptText && (
            <details>
              <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Transcript
              </summary>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2.5 text-xs leading-relaxed text-ink-soft">
                {lecture.transcriptText}
              </p>
            </details>
          )}
          {!notes && !lecture.transcriptText && (
            <p className="text-xs text-ink-faint">
              {lecture.status === "FAILED" ? "Nothing to show yet." : "Still working on this one…"}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
