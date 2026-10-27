"use client";

import { useEffect, useRef, useState } from "react";
import { NotesBoard, type NotesBoardSection } from "@/components/notes/NotesBoard";
import { OverviewPanel, type OverviewClassInfo, type OverviewScheduleEvent, type OverviewEmail } from "@/components/classes/OverviewPanel";
import { ClassAssignmentsPanel, type ClassAssignmentRow } from "@/components/classes/ClassAssignmentsPanel";
import { ExamsPanel, type ExamRow } from "@/components/classes/ExamsPanel";
import { ResourcesPanel, type ResourceRow, type ClassMaterialRow } from "@/components/classes/ResourcesPanel";
import { LecturesPanel, type LectureRow } from "@/components/classes/LecturesPanel";
import { ClassAssistant } from "@/components/classes/ClassAssistant";
import { StudyPanel } from "@/components/study/StudyPanel";
import type { ChatGptStudyInfo, StudyDeck, StudySourceOption } from "@/components/study/study-types";
import { CLASS_TABS, type ClassTab } from "@/components/classes/class-tabs";

export function ClassTabs({
  initialTab,
  classInfo,
  scheduleEvents,
  assignments,
  noteSections,
  lectures,
  defaultLectureTitle,
  materials,
  exams,
  resources,
  recentEmails,
  study,
  tz,
}: {
  initialTab: ClassTab;
  classInfo: OverviewClassInfo;
  scheduleEvents: OverviewScheduleEvent[];
  assignments: ClassAssignmentRow[];
  noteSections: NotesBoardSection[];
  lectures: LectureRow[];
  defaultLectureTitle: string;
  materials: ClassMaterialRow[];
  exams: ExamRow[];
  resources: ResourceRow[];
  recentEmails: OverviewEmail[];
  study: { decks: StudyDeck[]; sources: StudySourceOption[]; hasMaterial: boolean; aiAllowed: boolean; chatgpt: ChatGptStudyInfo };
  tz: string;
}) {
  const [tab, setTab] = useState<ClassTab>(initialTab);
  const tabRowRef = useRef<HTMLDivElement>(null);

  // On a phone the tab row scrolls sideways; keep the selected tab in view
  // (say, Lectures when arriving from Record). Scrolls only the row, never
  // the page.
  useEffect(() => {
    const row = tabRowRef.current;
    const selected = row?.querySelector<HTMLElement>("[data-selected]");
    if (!row || !selected) return;
    const left = selected.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + selected.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 16) });
    }
  }, [tab]);
  // Set when one tab sends you to a specific item in another: a lecture's
  // "Edit in Notes", or a lecture note's "From lecture" link.
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [focusLectureId, setFocusLectureId] = useState<string | null>(null);
  const noteCount = noteSections.reduce((s, sec) => s + sec.notes.length, 0);
  // What note generation can actually read (same rule as MATERIALS_WITH_TEXT
  // in src/lib/class-context.ts): hand-added, imported, or external links.
  const usableMaterialCount = materials.filter(
    (m) => !m.syncStatus || m.syncStatus === "READY" || m.syncStatus === "EXTERNAL"
  ).length;

  const counts: Partial<Record<ClassTab, number>> = {
    ...(study.decks.length ? { Study: study.decks.length } : {}),
    Assignments: assignments.length,
    Notes: noteCount,
    Lectures: lectures.length,
    Exams: exams.length,
    Resources: materials.length + resources.length,
  };

  // Deliberately doesn't write ?tab= back to the address bar: Next.js treats
  // history.replaceState as a navigation, and a navigation throws away any
  // refresh still in flight, so switching tabs right after an action (say,
  // deleting a note) would leave the other tab showing stale data. ?tab= is
  // read once, for links into a tab (/record, the Canvas page).
  function go(next: ClassTab) {
    setTab(next);
    setFocusNoteId(null);
    setFocusLectureId(null);
  }

  return (
    <div>
      {/* On a phone the row scrolls sideways, edge to edge. */}
      <div
        ref={tabRowRef}
        className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {CLASS_TABS.map((t) => (
          <button
            key={t}
            data-selected={tab === t || undefined}
            aria-pressed={tab === t}
            onClick={() => go(t)}
            className={`flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "bg-ink text-surface shadow-sm" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {t}
            {counts[t] != null && (
              <span className={`text-xs tabular-nums ${tab === t ? "text-surface opacity-60" : "text-ink-faint"}`}>{counts[t]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <OverviewPanel classInfo={classInfo} scheduleEvents={scheduleEvents} recentEmails={recentEmails} tz={tz} />
      )}
      {/* On the Study tab the assistant comes first, then flashcards and ChatGPT. */}
      {tab === "Study" && (
        <div className="flex flex-col gap-6">
          <ClassAssistant classId={classInfo.id} className={classInfo.name} chatgpt={study.chatgpt} />
          <StudyPanel classId={classInfo.id} tz={tz} {...study} />
        </div>
      )}
      {tab === "Assignments" && <ClassAssignmentsPanel assignments={assignments} tz={tz} />}
      {tab === "Notes" && (
        <NotesBoard
          classId={classInfo.id}
          sections={noteSections}
          focusNoteId={focusNoteId}
          onViewLecture={(lectureId) => {
            go("Lectures");
            setFocusLectureId(lectureId);
          }}
        />
      )}
      {tab === "Lectures" && (
        <LecturesPanel
          classId={classInfo.id}
          lectures={lectures}
          defaultTitle={defaultLectureTitle}
          materialCount={usableMaterialCount}
          focusLectureId={focusLectureId}
          onOpenNote={(noteId) => {
            go("Notes");
            setFocusNoteId(noteId);
          }}
          onOpenResources={() => go("Resources")}
        />
      )}
      {tab === "Exams" && <ExamsPanel exams={exams} tz={tz} />}
      {tab === "Resources" && (
        <ResourcesPanel classId={classInfo.id} lmsProvider={classInfo.lmsProvider} resources={resources} materials={materials} />
      )}

      {tab !== "Study" && (
        <div className="mt-10">
          <ClassAssistant classId={classInfo.id} className={classInfo.name} chatgpt={study.chatgpt} />
        </div>
      )}
    </div>
  );
}
