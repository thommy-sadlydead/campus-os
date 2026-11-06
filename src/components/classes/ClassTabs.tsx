"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import type { MeetingDates } from "@/lib/meetings";
import { useFeature } from "@/components/FeaturesProvider";

export function ClassTabs({
  initialTab,
  classInfo,
  scheduleEvents,
  semester,
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
  semester: MeetingDates | null;
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
  // Tabs for features the student turned off (src/lib/features.ts) are hidden.
  const lecturesOn = useFeature("lectures");
  const flashcardsOn = useFeature("flashcards");
  const assistantOn = useFeature("assistant");
  const tabs = CLASS_TABS.filter((t) => (t === "Lectures" ? lecturesOn : t === "Study" ? flashcardsOn || assistantOn : true));
  const [tab, setTab] = useState<ClassTab>(tabs.includes(initialTab) ? initialTab : "Overview");
  const tabRowRef = useRef<HTMLDivElement>(null);

  // On a phone the tab row scrolls sideways; keep the selected tab in view
  // (say, Lectures when arriving from Record). Scrolls only the row, never
  // the page.
  useEffect(() => {
    const row = tabRowRef.current;
    const selected = row?.querySelector<HTMLElement>("[data-selected]");
    if (!row || !selected) return;
    // The row is the tabs' positioned parent, so offsetLeft is within it.
    const left = selected.offsetLeft;
    if (left < row.scrollLeft || left + selected.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 16) });
    }
  }, [tab]);
  // Where the sliding pill sits: under the selected tab, measured after
  // layout and again when the window resizes.
  const [pill, setPill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const selected = tabRowRef.current?.querySelector<HTMLElement>("[data-selected]");
      if (selected) setPill({ left: selected.offsetLeft, width: selected.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
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
      {/* A segmented control: a black pill slides to the selected tab. On a
          phone the row scrolls sideways, edge to edge. */}
      <div className="-mx-5 mb-6 px-5 sm:mx-0 sm:px-0">
        <div
          ref={tabRowRef}
          role="tablist"
          aria-label="Class sections"
          className="relative flex gap-0.5 overflow-x-auto rounded-full border border-border-soft bg-surface p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <span
            aria-hidden
            className="absolute bottom-1 top-1 rounded-full bg-ink transition-[left,width] duration-300"
            style={{ left: pill.left, width: pill.width, transitionTimingFunction: "cubic-bezier(0.34, 1.3, 0.64, 1)", opacity: pill.width ? 1 : 0 }}
          />
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              data-selected={tab === t || undefined}
              aria-selected={tab === t}
              onClick={() => go(t)}
              className={`relative z-10 flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors duration-200 ${
                tab === t ? "text-surface" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t}
              {counts[t] != null && (
                <span className={`text-[11px] tabular-nums ${tab === t ? "text-surface opacity-60" : "text-ink-faint"}`}>{counts[t]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === "Overview" && (
        <OverviewPanel classInfo={classInfo} scheduleEvents={scheduleEvents} semester={semester} recentEmails={recentEmails} tz={tz} />
      )}
      {/* On the Study tab the assistant comes first, then flashcards and ChatGPT. */}
      {tab === "Study" && (
        <div className="flex flex-col gap-6">
          {assistantOn && <ClassAssistant classId={classInfo.id} className={classInfo.name} chatgpt={study.chatgpt} />}
          {flashcardsOn && <StudyPanel classId={classInfo.id} tz={tz} {...study} />}
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
      {tab === "Exams" && <ExamsPanel exams={exams} tz={tz} onStudy={tabs.includes("Study") ? () => go("Study") : undefined} />}
      {tab === "Resources" && (
        <ResourcesPanel classId={classInfo.id} lmsProvider={classInfo.lmsProvider} resources={resources} materials={materials} />
      )}

      {tab !== "Study" && assistantOn && (
        <div className="mt-10">
          <ClassAssistant classId={classInfo.id} className={classInfo.name} chatgpt={study.chatgpt} />
        </div>
      )}
    </div>
  );
}
