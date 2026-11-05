"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { extensionProgressAction, type ExtensionProgress } from "@/app/connect/extension-actions";
import { CardHeader } from "@/components/ui/CardHeader";
import { FileIcon } from "@/components/icons";

const POLL_MS = 4000;

/**
 * What's come in from Brightspace or Blackboard, course by course, from
 * what Campus OS actually saved (src/lib/lms/extension-import.ts). While a
 * course is still importing it checks again every few seconds: one request
 * at a time, scheduled after the last one finishes (see CLAUDE.md).
 */
export function ExtensionProgressPanel({ provider, initial }: { provider: "brightspace" | "blackboard"; initial: ExtensionProgress }) {
  const [progress, setProgress] = useState(initial);
  const importing = progress.courses.some((c) => c.status === "DOWNLOADING");

  useEffect(() => {
    if (!importing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await extensionProgressAction(provider);
      if (cancelled) return;
      if (next) setProgress(next);
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [importing, provider]);

  return (
    <div className="card card-pad">
      <CardHeader
        icon={<FileIcon className="h-[18px] w-[18px]" />}
        title="Your courses"
        description="Assignments and due dates, and the course files and pages Campus OS could read, for notes, flashcards and the class assistant."
      />
      {progress.error && <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink">{progress.error}</p>}
      {progress.courses.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No courses yet. Choose them from the extension.</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border-soft">
          {progress.courses.map((c) => (
            <li key={c.courseId ?? c.name} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                <p className="text-[13px] text-ink-soft">
                  {c.assignments} assignment{c.assignments === 1 ? "" : "s"} · {c.materials} file{c.materials === 1 ? "" : "s"} and page
                  {c.materials === 1 ? "" : "s"} read
                  {c.exams ? ` · ${c.exams} exam${c.exams === 1 ? "" : "s"}` : ""}
                </p>
                {c.problem && <p className="text-[13px] text-warn">{c.problem}</p>}
              </div>
              <span className="flex-none text-[13px] text-ink-soft">
                {c.status === "DOWNLOADING"
                  ? `Importing, ${c.pending} to go`
                  : c.status === "PARTIAL"
                    ? `${c.failed} couldn't be imported`
                    : c.status === "READY"
                      ? "Up to date"
                      : c.status === "FAILED"
                        ? "Couldn't import files"
                        : "Files not imported yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        Files that couldn&apos;t be imported are listed with the reason on each class&apos;s{" "}
        <Link href="/classes" className="underline decoration-border underline-offset-2 hover:text-ink">
          Resources tab
        </Link>
        , and they&apos;re tried again on the next sync.
      </p>
    </div>
  );
}
