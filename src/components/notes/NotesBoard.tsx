"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MARKDOWN_CLASSNAME, markdownPreview } from "@/lib/markdown";
import {
  createSectionAction,
  renameSectionAction,
  deleteSectionAction,
  moveSectionAction,
  createNoteAction,
  updateNoteAction,
  deleteNoteAction,
  toggleNotePinAction,
  moveNoteAction,
} from "@/app/classes/[id]/actions";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PinIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from "@/components/icons";

const ICON_BUTTON =
  "flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink";

export interface NotesBoardNote {
  id: string;
  title: string;
  bodyMarkdown: string;
  pinned: boolean;
  order: number;
  updatedAt: string; // ISO
  // Set when this note holds a lecture's notes (src/lib/lecture-notes-sync.ts).
  lecture: { id: string; createdAt: string } | null;
}

export interface NotesBoardSection {
  id: string;
  name: string;
  order: number;
  notes: NotesBoardNote[];
}

/**
 * Freeform per-class notes: create/rename/delete/reorder sections, create/
 * edit/delete/pin/reorder notes inside them, and a search box that filters
 * across everything. No forced structure — sections and notes are exactly
 * what the student names them, in whatever order they choose. Lecture
 * notes arrive here on their own, in a "Lecture notes" section.
 */
export function NotesBoard({
  classId,
  sections,
  focusNoteId,
  onViewLecture,
}: {
  classId: string;
  sections: NotesBoardSection[];
  focusNoteId?: string | null;
  onViewLecture?: (lectureId: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [newSectionName, setNewSectionName] = useState("");
  const [openNoteId, setOpenNoteId] = useState<string | null>(focusNoteId ?? null);

  // Arriving from a lecture's "Edit in Notes": open that note and bring it into view.
  useEffect(() => {
    if (!focusNoteId) return;
    setOpenNoteId(focusNoteId);
    requestAnimationFrame(() =>
      document.getElementById(`note-${focusNoteId}`)?.scrollIntoView({ block: "start", behavior: "smooth" })
    );
  }, [focusNoteId]);

  function afterMutate() {
    startTransition(() => router.refresh());
  }

  const q = query.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!q) return sections;
    return sections
      .map((s) => ({
        ...s,
        notes: s.notes.filter(
          (n) => n.title.toLowerCase().includes(q) || n.bodyMarkdown.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.notes.length > 0);
  }, [sections, q]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative w-full sm:max-w-xs">
          <span className="sr-only">Search notes</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes in this class…"
            className="field pl-9"
          />
        </label>
        <form
          className="flex gap-2 sm:ml-auto"
          action={(fd) => {
            const name = String(fd.get("name") || "");
            if (!name.trim()) return;
            setNewSectionName("");
            startTransition(async () => {
              await createSectionAction(classId, name);
              router.refresh();
            });
          }}
        >
          <input
            type="text"
            name="name"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder="New section (e.g. Midterm Review)"
            aria-label="New section name"
            className="field min-w-0 flex-1 sm:w-60 sm:flex-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary flex-none"
          >
            <PlusIcon className="h-4 w-4" />
            Section
          </button>
        </form>
      </div>

      {q && filteredSections.length === 0 && (
        <p className="text-sm text-ink-soft">No notes match "{query}".</p>
      )}

      {!q && sections.length === 0 && (
        <div className="empty">
          No sections yet. Add one above to start organizing notes however you want — by week,
          by topic, whatever makes sense to you.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredSections.map((section, sIdx) => {
          const sortedNotes = [...section.notes].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return a.order - b.order;
          });
          // A note open for reading takes the full width, so long lecture
          // notes aren't squeezed into one narrow column.
          const hasOpenNote = section.notes.some((n) => n.id === openNoteId);
          return (
            <div
              key={section.id}
              className={`card p-4 ${hasOpenNote ? "md:col-span-2 xl:col-span-3" : ""}`}
            >
              <SectionHeader
                name={section.name}
                onRename={(name) => {
                  startTransition(async () => {
                    await renameSectionAction(section.id, name);
                    router.refresh();
                  });
                }}
                onDelete={() => {
                  startTransition(async () => {
                    await deleteSectionAction(section.id);
                    router.refresh();
                  });
                }}
                onMoveUp={sIdx > 0 ? () => { startTransition(async () => { await moveSectionAction(section.id, "up"); router.refresh(); }); } : undefined}
                onMoveDown={sIdx < filteredSections.length - 1 ? () => { startTransition(async () => { await moveSectionAction(section.id, "down"); router.refresh(); }); } : undefined}
              />

              <ul className="mt-3 flex flex-col gap-2">
                {sortedNotes.map((note, nIdx) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    isOpen={openNoteId === note.id}
                    onToggleOpen={() => setOpenNoteId(openNoteId === note.id ? null : note.id)}
                    onSave={(fd) => {
                      startTransition(async () => {
                        await updateNoteAction(note.id, fd);
                        router.refresh();
                      });
                    }}
                    onViewLecture={onViewLecture}
                    onDelete={() => {
                      startTransition(async () => {
                        await deleteNoteAction(note.id);
                        router.refresh();
                      });
                    }}
                    onTogglePin={() => {
                      startTransition(async () => {
                        await toggleNotePinAction(note.id);
                        router.refresh();
                      });
                    }}
                    onMoveUp={nIdx > 0 ? () => { startTransition(async () => { await moveNoteAction(note.id, "up"); router.refresh(); }); } : undefined}
                    onMoveDown={nIdx < sortedNotes.length - 1 ? () => { startTransition(async () => { await moveNoteAction(note.id, "down"); router.refresh(); }); } : undefined}
                  />
                ))}
              </ul>

              <form
                className="mt-3 flex gap-2 border-t border-border-soft pt-3"
                action={(fd) => {
                  startTransition(async () => {
                    await createNoteAction(section.id, fd);
                    router.refresh();
                  });
                }}
              >
                <input
                  type="text"
                  name="title"
                  placeholder="New note title"
                  aria-label="New note title"
                  className="field field-sm w-full"
                />
                <input type="hidden" name="bodyMarkdown" value="" />
                <button
                  type="submit"
                  disabled={pending}
                  className="btn btn-secondary btn-sm flex-none"
                >
                  Add
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeader({
  name,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  name: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  if (editing) {
    return (
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(value);
          setEditing(false);
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            onRename(value);
            setEditing(false);
          }}
          aria-label="Section name"
          className="field field-sm font-semibold"
        />
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-ink hover:text-accent-ink"
        title="Rename section"
      >
        {name}
      </button>
      <div className="flex flex-none items-center">
        {onMoveUp && (
          <button onClick={onMoveUp} aria-label="Move section up" title="Move up" className={ICON_BUTTON}>
            <ArrowUpIcon className="h-4 w-4" />
          </button>
        )}
        {onMoveDown && (
          <button onClick={onMoveDown} aria-label="Move section down" title="Move down" className={ICON_BUTTON}>
            <ArrowDownIcon className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => {
            if (confirm(`Delete "${name}" and all its notes?`)) onDelete();
          }}
          aria-label="Delete section"
          title="Delete section"
          className={`${ICON_BUTTON} hover:bg-danger-soft hover:text-danger`}
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function NoteCard({
  note,
  isOpen,
  onToggleOpen,
  onSave,
  onDelete,
  onTogglePin,
  onMoveUp,
  onMoveDown,
  onViewLecture,
}: {
  note: NotesBoardNote;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSave: (formData: FormData) => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onViewLecture?: (lectureId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.bodyMarkdown);

  const lectureLink = note.lecture && onViewLecture && (
    <button
      type="button"
      onClick={() => onViewLecture(note.lecture!.id)}
      className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
    >
      From lecture · {new Date(note.lecture.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </button>
  );

  if (isOpen && editing) {
    return (
      <li id={`note-${note.id}`} className="scroll-mt-4 rounded-xl border border-accent bg-surface p-3 shadow-[0_0_0_4px_var(--accent-ring)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData();
            fd.set("title", title);
            fd.set("bodyMarkdown", body);
            onSave(fd);
            setEditing(false);
          }}
          className="flex flex-col gap-2"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Note title"
            className="field field-sm font-medium w-auto"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={note.lecture ? 16 : 8}
            placeholder="Write your note… (**bold**, - lists and # headings work)"
            className="field field-sm font-mono text-xs leading-relaxed w-auto"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setTitle(note.title);
                setBody(note.bodyMarkdown);
                setEditing(false);
              }}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              Save
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (isOpen) {
    return (
      <li id={`note-${note.id}`} className="scroll-mt-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button onClick={onToggleOpen} className="min-w-0 flex-1 text-left" aria-expanded="true">
            <span className="flex items-center gap-1.5 text-base font-semibold text-ink">
              {note.pinned && <PinIcon className="h-4 w-4 flex-none text-accent" />}
              {note.title}
            </span>
          </button>
          <div className="-mr-1.5 flex flex-none items-center gap-0.5">
            <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm text-accent-ink">
              <PencilIcon className="h-3.5 w-3.5" />
              Edit
            </button>
            <button onClick={onTogglePin} className="btn btn-ghost btn-sm">
              <PinIcon className="h-3.5 w-3.5" />
              {note.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              onClick={() => confirm(`Delete "${note.title}"?`) && onDelete()}
              className="btn btn-ghost btn-sm hover:bg-danger-soft hover:text-danger"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
        {lectureLink && <div className="mt-1">{lectureLink}</div>}
        {note.bodyMarkdown.trim() ? (
          <div className={`mt-3 ${MARKDOWN_CLASSNAME}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.bodyMarkdown}</ReactMarkdown>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="mt-2 text-sm text-ink-faint hover:text-ink">
            Empty note. Tap Edit to start writing.
          </button>
        )}
      </li>
    );
  }

  const preview = markdownPreview(note.bodyMarkdown);
  return (
    <li
      id={`note-${note.id}`}
      className="group scroll-mt-4 rounded-xl border border-border-soft bg-bg p-3 transition-colors hover:border-border"
    >
      <div className="flex items-start gap-1.5">
        <button onClick={onToggleOpen} className="min-w-0 flex-1 text-left" aria-expanded="false">
          <div className="flex items-center gap-1.5">
            {note.pinned && <PinIcon className="h-3.5 w-3.5 flex-none text-accent" />}
            <span className="truncate text-sm font-medium text-ink">{note.title}</span>
          </div>
          {preview && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-faint">{preview}</p>}
        </button>
        <div className="-mr-1 -mt-1 flex flex-none items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {onMoveUp && (
            <button onClick={onMoveUp} aria-label="Move note up" title="Move up" className={ICON_BUTTON}>
              <ArrowUpIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} aria-label="Move note down" title="Move down" className={ICON_BUTTON}>
              <ArrowDownIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {lectureLink && <div className="mt-1">{lectureLink}</div>}
    </li>
  );
}
