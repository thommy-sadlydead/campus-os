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
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes in this class…"
          className="w-full max-w-xs rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <form
          className="ml-auto flex gap-2"
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
            className="w-56 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className="flex-none rounded-lg bg-ink px-3 py-2 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-60"
          >
            + Section
          </button>
        </form>
      </div>

      {q && filteredSections.length === 0 && (
        <p className="text-sm text-ink-soft">No notes match "{query}".</p>
      )}

      {!q && sections.length === 0 && (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
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
              className={`rounded-xl2 border border-border-soft bg-surface p-4 shadow-card ${
                hasOpenNote ? "md:col-span-2 xl:col-span-3" : ""
              }`}
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
                className="mt-3 flex gap-2"
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
                  placeholder="+ New note title"
                  className="w-full rounded-lg border border-border-soft bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                />
                <input type="hidden" name="bodyMarkdown" value="" />
                <button
                  type="submit"
                  disabled={pending}
                  className="flex-none rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-60"
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
          className="w-full rounded-lg border border-accent bg-bg px-2 py-1 text-sm font-semibold outline-none"
        />
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEditing(true)}
        className="flex-1 truncate text-left font-display text-base font-semibold hover:underline"
        title="Rename section"
      >
        {name}
      </button>
      <div className="flex flex-none items-center gap-0.5 text-ink-faint">
        {onMoveUp && (
          <button onClick={onMoveUp} aria-label="Move section up" className="rounded p-1 hover:bg-surface-2 hover:text-ink">
            ↑
          </button>
        )}
        {onMoveDown && (
          <button onClick={onMoveDown} aria-label="Move section down" className="rounded p-1 hover:bg-surface-2 hover:text-ink">
            ↓
          </button>
        )}
        <button
          onClick={() => {
            if (confirm(`Delete "${name}" and all its notes?`)) onDelete();
          }}
          aria-label="Delete section"
          className="rounded p-1 hover:bg-danger-soft hover:text-danger"
        >
          ×
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
      className="text-xs font-medium text-accent-ink hover:underline"
    >
      From lecture · {new Date(note.lecture.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </button>
  );

  if (isOpen && editing) {
    return (
      <li id={`note-${note.id}`} className="scroll-mt-4 rounded-lg border border-accent bg-bg p-2.5">
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
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm font-medium outline-none focus:border-accent"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={note.lecture ? 16 : 8}
            placeholder="Write your note… (**bold**, - lists and # headings work)"
            className="rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs leading-relaxed outline-none focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setTitle(note.title);
                setBody(note.bodyMarkdown);
                setEditing(false);
              }}
              className="rounded-lg px-2.5 py-1 text-xs text-ink-soft hover:bg-surface-2"
            >
              Cancel
            </button>
            <button type="submit" className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-surface hover:opacity-90">
              Save
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (isOpen) {
    return (
      <li id={`note-${note.id}`} className="scroll-mt-4 rounded-lg border border-border bg-bg p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button onClick={onToggleOpen} className="min-w-0 flex-1 text-left" aria-expanded="true">
            <span className="text-sm font-semibold">
              {note.pinned && <span aria-hidden>📌 </span>}
              {note.title}
            </span>
          </button>
          <div className="flex flex-none items-center gap-3 text-xs">
            <button onClick={() => setEditing(true)} className="font-medium text-accent-ink hover:underline">
              Edit
            </button>
            <button onClick={onTogglePin} className="text-ink-soft hover:text-ink">
              {note.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              onClick={() => confirm(`Delete "${note.title}"?`) && onDelete()}
              className="text-ink-faint hover:text-danger"
            >
              Delete
            </button>
          </div>
        </div>
        {lectureLink && <div className="mt-1">{lectureLink}</div>}
        {note.bodyMarkdown.trim() ? (
          <div className={`mt-2 ${MARKDOWN_CLASSNAME}`}>
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
    <li id={`note-${note.id}`} className="group scroll-mt-4 rounded-lg border border-border-soft bg-bg p-2.5">
      <div className="flex items-start gap-1.5">
        <button onClick={onToggleOpen} className="min-w-0 flex-1 text-left" aria-expanded="false">
          <div className="flex items-center gap-1.5">
            {note.pinned && <span aria-hidden title="Pinned">📌</span>}
            <span className="truncate text-sm font-medium">{note.title}</span>
          </div>
          {preview && <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">{preview}</p>}
        </button>
        <div className="flex flex-none items-center gap-0.5 text-ink-faint opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          {onMoveUp && (
            <button onClick={onMoveUp} aria-label="Move note up" className="rounded p-1 hover:bg-surface-2 hover:text-ink">↑</button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} aria-label="Move note down" className="rounded p-1 hover:bg-surface-2 hover:text-ink">↓</button>
          )}
        </div>
      </div>
      {lectureLink && <div className="mt-1">{lectureLink}</div>}
    </li>
  );
}
