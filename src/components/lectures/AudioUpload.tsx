"use client";

import { useRef, useState, type DragEvent } from "react";
import { audioTypeForFile } from "@/lib/lecture-notes";
import { saveLectureAudio } from "./save-lecture-audio";

/**
 * Upload an existing recording, such as a Voice Memo, by choosing it or
 * dropping it on the box. Voice Memos keeps recordings in its own library
 * that websites can't reach, hence the short how-to for getting one out.
 */
export function AudioUpload({ classId, onSaved }: { classId: string | null; onSaved: (classId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(candidate: File | undefined) {
    if (!candidate) return;
    const type = audioTypeForFile(candidate.name, candidate.type);
    if (!type) {
      setError("That doesn't look like an audio recording. Voice Memos saves .m4a files.");
      return;
    }
    setError(null);
    setFile(type === candidate.type ? candidate : new File([candidate], candidate.name, { type }));
    setTitle(candidate.name.replace(/\.[^.]+$/, ""));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0]);
  }

  async function upload() {
    if (!file || !classId) return;
    setError(null);
    setProgress(0);
    try {
      const result = await saveLectureAudio(classId, file, title.trim() || file.name, setProgress);
      if (result.error) {
        setError(result.error);
        return;
      }
      setFile(null);
      setTitle("");
      if (inputRef.current) inputRef.current.value = "";
      onSaved(classId);
    } catch {
      setError("The upload didn't finish. Check your connection and try again.");
    } finally {
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-xl2 border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? "border-accent bg-surface-2" : "border-border"
        }`}
      >
        {file ? (
          <>
            <p className="max-w-full truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-ink-faint">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-ink-soft underline hover:text-ink disabled:opacity-50"
            >
              Choose a different file
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface hover:opacity-90"
            >
              Choose a recording
            </button>
            <p className="text-xs text-ink-faint">or drop an audio file here</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.m4a"
          className="hidden"
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </div>

      {file && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Lecture title"
            placeholder="Lecture title"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void upload()}
            disabled={uploading || !classId}
            className="flex-none rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-60"
          >
            {uploading ? `Uploading… ${progress}%` : "Upload and make notes"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <details className="text-xs text-ink-soft">
        <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-ink">
          Getting a recording out of Voice Memos
        </summary>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
          <li>
            <strong className="text-ink">iPhone or iPad:</strong> in Voice Memos, open the recording, tap ••• → Share →
            Save to Files. Then tap Choose a recording above and pick it from Files.
          </li>
          <li>
            <strong className="text-ink">Mac:</strong> drag the recording from Voice Memos to your desktop, then drop it
            on the box above.
          </li>
        </ul>
      </details>
    </div>
  );
}
