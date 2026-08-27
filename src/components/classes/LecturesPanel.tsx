"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import ReactMarkdown from "react-markdown";
import {
  addClassMaterialAction,
  addClassMaterialFromUrlAction,
  createLectureAction,
  createLectureFromTranscriptAction,
  deleteClassMaterialAction,
  deleteLectureAction,
  pollLectureStatusAction,
  retryLectureAction,
} from "@/app/classes/[id]/lecture-actions";
import {
  classMaterialTypeLabel,
  isAllowedAudioType,
  isLectureInProgress,
  lectureStatusLabel,
  type ClassMaterialType,
  type LectureStatus,
} from "@/lib/lecture-notes";

export interface LectureRow {
  id: string;
  title: string;
  status: LectureStatus;
  transcriptText: string | null;
  notesMarkdown: string | null;
  errorMessage: string | null;
  createdAt: string; // ISO
}

export interface ClassMaterialRow {
  id: string;
  type: ClassMaterialType;
  title: string;
  content: string;
  sourceUrl: string | null;
  createdAt: string; // ISO
}

const STATUS_TONE: Record<LectureStatus, string> = {
  UPLOADED: "bg-surface-2 text-ink-soft",
  TRANSCRIBING: "bg-warn-soft text-warn",
  GENERATING_NOTES: "bg-warn-soft text-warn",
  READY: "bg-ok-soft text-ok",
  FAILED: "bg-danger-soft text-danger",
};

// No @tailwindcss/typography plugin in this app (tailwind.config.ts has no
// plugins) — style markdown output with plain child-selector utilities
// instead of "prose", matching the rest of the app's no-plugin Tailwind use.
const MARKDOWN_CLASSNAME =
  "text-sm leading-relaxed text-ink [&_h1]:mt-3 [&_h1]:font-display [&_h1]:text-base [&_h1]:font-semibold [&_h1]:first:mt-0 " +
  "[&_h2]:mt-3 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h2]:first:mt-0 " +
  "[&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold " +
  "[&_p]:mt-2 [&_p]:first:mt-0 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mt-1 [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs";

const POLL_INTERVAL_MS = 4000;

export function LecturesPanel({
  classId,
  lectures,
  materials,
}: {
  classId: string;
  lectures: LectureRow[];
  materials: ClassMaterialRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openLectureId, setOpenLectureId] = useState<string | null>(null);

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
    const interval = setInterval(() => {
      startTransition(async () => {
        await Promise.all(ids.map((id) => pollLectureStatusAction(id)));
        router.refresh();
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [inProgressKey, router]);

  return (
    <div className="flex flex-col gap-4">
      <UploadCard classId={classId} onDone={() => router.refresh()} />

      <ClassMaterialsSection classId={classId} materials={materials} />

      {lectures.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No lectures uploaded yet — upload a recording above to get a transcript and AI-generated notes.
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
                if (!confirm(`Delete "${lecture.title}"? This also deletes the uploaded audio.`)) return;
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
              pending={pending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload — audio (direct-to-Blob, transcribed via AssemblyAI) or a transcript
// pasted directly, which skips straight to note generation.
// ---------------------------------------------------------------------------

function UploadCard({ classId, onDone }: { classId: string; onDone: () => void }) {
  const [mode, setMode] = useState<"audio" | "transcript">("audio");
  const [title, setTitle] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAudioSubmit(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setUploadError("Choose an audio file first.");
      return;
    }
    if (!isAllowedAudioType(file.type)) {
      setUploadError("That doesn't look like an audio file.");
      return;
    }

    const lectureTitle = title.trim() || file.name.replace(/\.[^.]+$/, "");
    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      const blob = await upload(`lectures/${classId}/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/lecture-audio/upload",
        onUploadProgress: (event) => setUploadProgress(Math.round(event.percentage)),
      });

      await createLectureAction(classId, { title: lectureTitle, audioUrl: blob.url });
      setTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onDone();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleTranscriptSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = transcriptText.trim();
    if (!trimmed) {
      setUploadError("Paste a transcript first.");
      return;
    }

    const lectureTitle = title.trim() || "Untitled lecture";
    setIsUploading(true);
    setUploadError(null);

    try {
      await createLectureFromTranscriptAction(classId, { title: lectureTitle, transcriptText: trimmed });
      setTitle("");
      setTranscriptText("");
      onDone();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't generate notes. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form
      onSubmit={mode === "audio" ? handleAudioSubmit : handleTranscriptSubmit}
      className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Add a lecture</h4>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => setMode("audio")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "audio" ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"
            }`}
          >
            Upload audio
          </button>
          <button
            type="button"
            onClick={() => setMode("transcript")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "transcript" ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"
            }`}
          >
            Paste transcript
          </button>
        </div>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={mode === "audio" ? "Title (optional — defaults to the filename)" : "Title (optional)"}
        className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
      />

      {mode === "audio" ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none file:mr-2 file:rounded-md file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:font-medium focus:border-accent"
          />
          <button
            type="submit"
            disabled={isUploading}
            className="flex-none rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-60"
          >
            {isUploading ? `Uploading… ${uploadProgress}%` : "Upload"}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            rows={5}
            placeholder="Paste the lecture transcript here…"
            className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={isUploading}
            className="flex-none self-end rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-60"
          >
            {isUploading ? "Generating notes…" : "Generate notes"}
          </button>
        </div>
      )}

      {uploadError && <p className="mt-2 text-xs text-danger">{uploadError}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Class materials — books/slides that inform every lecture's notes in this
// class (see ClassMaterial in schema.prisma and generateNotes in
// lecture-actions.ts). Pasted text only for now, no file upload/parsing.
// ---------------------------------------------------------------------------

function ClassMaterialsSection({ classId, materials }: { classId: string; materials: ClassMaterialRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"text" | "link">("text");
  const [type, setType] = useState<ClassMaterialType>("BOOK");
  const [materialTitle, setMaterialTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddText(e: FormEvent) {
    e.preventDefault();
    if (!materialTitle.trim() || !content.trim()) {
      setError("Enter a title and some content.");
      return;
    }
    setError(null);

    const fd = new FormData();
    fd.set("type", type);
    fd.set("title", materialTitle.trim());
    fd.set("content", content.trim());

    startTransition(async () => {
      try {
        await addClassMaterialAction(classId, fd);
        setMaterialTitle("");
        setContent("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add that. Please try again.");
      }
    });
  }

  async function handleAddFromUrl(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setError("Enter a link first.");
      return;
    }
    setError(null);

    const fd = new FormData();
    fd.set("type", type);
    if (materialTitle.trim()) fd.set("title", materialTitle.trim());
    fd.set("url", url.trim());

    setIsFetching(true);
    try {
      await addClassMaterialFromUrlAction(classId, fd);
      setMaterialTitle("");
      setUrl("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fetch that link. Please try again.");
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <div className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
      <h4 className="text-sm font-semibold">Class materials</h4>
      <p className="mt-0.5 text-xs text-ink-faint">
        Textbook excerpts and slide content, used as extra context every time notes are generated for a lecture in
        this class.
      </p>

      {materials.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {materials.map((m) => (
            <li key={m.id} className="flex items-start gap-3 rounded-lg border border-border-soft bg-bg p-2.5">
              <span className="flex-none rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-soft">
                {classMaterialTypeLabel(m.type)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.title}</div>
                {m.sourceUrl && (
                  <a
                    href={m.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-ink-faint hover:text-accent hover:underline"
                  >
                    {m.sourceUrl}
                  </a>
                )}
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">{m.content}</p>
              </div>
              <button
                onClick={() => {
                  if (!confirm(`Remove "${m.title}"?`)) return;
                  startTransition(async () => {
                    await deleteClassMaterialAction(m.id);
                    router.refresh();
                  });
                }}
                disabled={pending}
                className="flex-none text-xs text-ink-faint hover:text-danger disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={mode === "text" ? handleAddText : handleAddFromUrl}
        className="mt-3 flex flex-col gap-2 border-t border-border-soft pt-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setMode("text")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === "text" ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"
              }`}
            >
              Paste text
            </button>
            <button
              type="button"
              onClick={() => setMode("link")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === "link" ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"
              }`}
            >
              Add a link
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ClassMaterialType)}
            className="flex-none rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="BOOK">Book</option>
            <option value="SLIDES">Slides</option>
          </select>
          <input
            type="text"
            value={materialTitle}
            onChange={(e) => setMaterialTitle(e.target.value)}
            placeholder={
              mode === "text"
                ? "Title (e.g. the textbook name, or “Week 3 slides”)"
                : "Title (optional — defaults to the page title)"
            }
            className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>

        {mode === "text" ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder="Paste an excerpt, outline, or key points…"
            className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        ) : (
          <p className="text-xs text-ink-faint">
            Fetched once when added — the page's text is saved as-is and never looked at again, so it won't change if
            the page does later.
          </p>
        )}

        {mode === "link" && (
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        )}

        <button
          type="submit"
          disabled={mode === "text" ? pending : isFetching}
          className="flex-none self-end rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
        >
          {mode === "text" ? "Add" : isFetching ? "Fetching…" : "Fetch & add"}
        </button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </form>
    </div>
  );
}

function LectureCard({
  lecture,
  isOpen,
  onToggleOpen,
  onDelete,
  onRetry,
  pending,
}: {
  lecture: LectureRow;
  isOpen: boolean;
  onToggleOpen: () => void;
  onDelete: () => void;
  onRetry: () => void;
  pending: boolean;
}) {
  const date = new Date(lecture.createdAt);

  return (
    <li className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onToggleOpen} className="min-w-0 flex-1 text-left">
          <span className="font-medium">{lecture.title}</span>
        </button>
        <div className="flex flex-none items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[lecture.status]}`}>
            {lectureStatusLabel(lecture.status)}
          </span>
          <button onClick={onDelete} className="text-xs text-ink-faint hover:text-danger">
            Remove
          </button>
        </div>
      </div>
      <div className="mt-1 text-xs text-ink-faint">
        {date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
      </div>

      {lecture.status === "FAILED" && lecture.errorMessage && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-danger-soft p-2.5 text-xs text-danger">
          <span>{lecture.errorMessage}</span>
          <button onClick={onRetry} disabled={pending} className="flex-none font-medium underline disabled:opacity-60">
            Retry
          </button>
        </div>
      )}

      {isOpen && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border-soft pt-3">
          {lecture.notesMarkdown && (
            <div>
              <h5 className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Notes</h5>
              <div className={MARKDOWN_CLASSNAME}>
                <ReactMarkdown>{lecture.notesMarkdown}</ReactMarkdown>
              </div>
            </div>
          )}
          {lecture.transcriptText && (
            <div>
              <h5 className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Transcript</h5>
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2.5 text-xs leading-relaxed text-ink-soft">
                {lecture.transcriptText}
              </p>
            </div>
          )}
          {!lecture.notesMarkdown && !lecture.transcriptText && (
            <p className="text-xs text-ink-faint">
              {lecture.status === "FAILED" ? "Nothing to show yet." : "Still working on this one…"}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
