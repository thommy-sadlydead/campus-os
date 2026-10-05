"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { addResourceAction, deleteResourceAction } from "@/app/classes/[id]/actions";
import {
  addClassMaterialAction,
  addClassMaterialFromBlobAction,
  addClassMaterialFromFileAction,
  addClassMaterialFromUrlAction,
  deleteClassMaterialAction,
} from "@/app/classes/[id]/lecture-actions";
import {
  classMaterialTypeLabel,
  DIRECT_MATERIAL_UPLOAD_MAX_BYTES,
  type ClassMaterialType,
} from "@/lib/lecture-notes";
import { CardHeader } from "@/components/ui/CardHeader";
import { isLmsProvider, LMS_PROVIDER_INFO, lmsName } from "@/lib/lms/providers";
import { ChevronRightIcon, ExternalIcon, FileIcon, LayersIcon, LinkIcon, PlusIcon, SearchIcon, XIcon } from "@/components/icons";

export interface ResourceRow {
  id: string;
  title: string;
  type: string;
  url: string | null;
  notes: string | null;
  addedAt: string;
}

export interface ClassMaterialRow {
  id: string;
  type: ClassMaterialType;
  title: string;
  // First few hundred characters only; the page never ships a whole book
  // to the browser. For a failed import this is the reason it failed.
  preview: string;
  sourceUrl: string | null;
  createdAt: string; // ISO
  // Canvas-synced materials only (see canvas-materials-sync.ts); null for
  // anything added by hand, which is always usable.
  provider: string | null;
  syncStatus: string | null;
}

const TYPE_ICON: Record<string, (props: { className?: string }) => React.ReactElement> = {
  link: LinkIcon,
  file: FileIcon,
  document: FileIcon,
};

const REMOVE_BUTTON =
  "flex h-7 w-7 flex-none items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60";

const GROUP_ORDER: ClassMaterialType[] = ["SYLLABUS", "SLIDES", "BOOK", "NOTES"];
const GROUP_TITLES: Record<ClassMaterialType, string> = {
  SYLLABUS: "Syllabus",
  SLIDES: "Slides",
  BOOK: "Books and readings",
  NOTES: "Handouts and notes",
};

// Only materials synced from an LMS carry a non-READY syncStatus.
const STATUS_NOTE: Record<string, string> = {
  EXTERNAL: "Link",
  SKIPPED_TOO_LARGE: "Too large to import",
  SKIPPED_UNSUPPORTED: "Can't read this file type",
  FAILED: "Couldn't import",
};

function statusNote(m: ClassMaterialRow): string | null {
  const lms = lmsName(m.provider);
  if (!lms || !m.syncStatus) return null;
  if (m.syncStatus === "MISSING") return `No longer in ${lms}`;
  return STATUS_NOTE[m.syncStatus] ?? null;
}

/**
 * Everything to read for a class in one place: books, slides, syllabi and
 * handouts (ClassMaterial: imported from Canvas or Schoology or added by hand, and read
 * by the AI when it writes lecture notes), then saved links (Resource).
 */
export function ResourcesPanel({
  classId,
  lmsProvider,
  resources,
  materials,
}: {
  classId: string;
  /** Where the class was synced from, for what to say when there's nothing here yet. */
  lmsProvider: string | null;
  resources: ResourceRow[];
  materials: ClassMaterialRow[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <MaterialsSection classId={classId} lmsProvider={lmsProvider} materials={materials} />
      <LinksSection classId={classId} resources={resources} />
    </div>
  );
}

/** What an empty materials list says, depending on whether the class's LMS shares files. */
function emptyMaterialsNote(lmsProvider: string | null): string {
  const name = lmsName(lmsProvider);
  if (!name) return "Nothing here yet. Add your own above, or connect Canvas or Schoology to import a course's files automatically.";
  if (isLmsProvider(lmsProvider) && !LMS_PROVIDER_INFO[lmsProvider].capabilities.materials) {
    return `${name} doesn't share course files with other apps. Add yours above: upload a file, paste text, or add a link.`;
  }
  return `Nothing here yet. Use "Go fetch materials" on the ${name} page to import this course's files, or add your own above.`;
}

function MaterialsSection({
  classId,
  lmsProvider,
  materials,
}: {
  classId: string;
  lmsProvider: string | null;
  materials: ClassMaterialRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(materials.length === 0);

  const failed = materials.filter((m) => m.syncStatus === "FAILED");
  // A class syncs from one LMS, so its failed imports all came from it.
  const failedFrom = lmsName(failed[0]?.provider) ?? "your school's site";
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => materials.filter((m) => m.syncStatus !== "FAILED" && (!q || m.title.toLowerCase().includes(q))),
    [materials, q]
  );
  const groups = GROUP_ORDER.map((type) => ({ type, items: visible.filter((m) => m.type === type) })).filter(
    (g) => g.items.length > 0
  );

  function remove(m: ClassMaterialRow) {
    if (!confirm(`Remove "${m.title}"? Lecture notes and the class assistant won't use it anymore.`)) return;
    startTransition(async () => {
      await deleteClassMaterialAction(m.id);
      router.refresh();
    });
  }

  return (
    <section className="card card-pad">
      <CardHeader
        icon={<LayersIcon className="h-[18px] w-[18px]" />}
        title="Books and slides"
        description="Campus OS reads these when it writes lecture notes and answers questions about this class."
        action={
          !adding && (
            <button onClick={() => setAdding(true)} className="btn btn-secondary btn-sm">
              <PlusIcon className="h-4 w-4" />
              Add
            </button>
          )
        }
      />

      {adding && (
        <AddMaterialForm
          classId={classId}
          onAdded={() => router.refresh()}
          onClose={materials.length > 0 ? () => setAdding(false) : undefined}
        />
      )}

      {materials.length === 0 && (
        <p className="mt-4 text-sm text-ink-soft">
          {emptyMaterialsNote(lmsProvider)}
        </p>
      )}

      {failed.length > 0 && (
        <details className="group/failed mt-4 rounded-xl bg-warn-soft p-3.5" open={failed.length <= 5}>
          <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 text-sm font-medium text-warn [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="h-4 w-4 flex-none transition-transform group-open/failed:rotate-90" />
            {failed.length} file{failed.length === 1 ? "" : "s"} couldn&apos;t be imported from {failedFrom}
          </summary>
          <p className="mt-1 text-xs text-ink-soft">
            Open one in {failedFrom} to read it there, or paste its text in with Add so Campus OS can use it.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {failed.map((m) => (
              <MaterialItem key={m.id} material={m} onRemove={() => remove(m)} pending={pending} showReason />
            ))}
          </ul>
        </details>
      )}

      {materials.length > 12 && (
        <label className="relative mt-4 block">
          <span className="sr-only">Search files</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${materials.length} files…`}
            className="field pl-9"
          />
        </label>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {groups.map((group) => (
          <details key={group.type} open={!!q || group.items.length <= 8} className="group/section">
            <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="h-3.5 w-3.5 text-ink-faint transition-transform group-open/section:rotate-90" />
              <span className="eyebrow">{GROUP_TITLES[group.type]}</span>
              <span className="badge bg-surface-2 px-2 text-[11px] tabular-nums text-ink-soft">{group.items.length}</span>
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {group.items.map((m) => (
                <MaterialItem key={m.id} material={m} onRemove={() => remove(m)} pending={pending} />
              ))}
            </ul>
          </details>
        ))}
        {q && groups.length === 0 && <p className="text-sm text-ink-soft">No files match &quot;{query}&quot;.</p>}
      </div>
    </section>
  );
}

function MaterialItem({
  material: m,
  onRemove,
  pending,
  showReason,
}: {
  material: ClassMaterialRow;
  onRemove: () => void;
  pending: boolean;
  showReason?: boolean;
}) {
  const note = statusNote(m);
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border-soft bg-surface p-3">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-surface-2 text-ink-soft">
        <FileIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-medium text-ink">{m.title}</span>
          {note && <span className="badge flex-none bg-warn-soft px-2 text-[11px] text-warn">{note}</span>}
        </div>
        {m.preview && (
          <p className={`mt-0.5 text-xs leading-relaxed text-ink-faint ${showReason ? "" : "line-clamp-1"}`}>{m.preview}</p>
        )}
      </div>
      <div className="flex flex-none items-center gap-0.5">
        {m.sourceUrl && (
          <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm text-accent-ink">
            Open
            <ExternalIcon className="h-3.5 w-3.5" />
          </a>
        )}
        <button onClick={onRemove} disabled={pending} title="Remove" aria-label={`Remove ${m.title}`} className={REMOVE_BUTTON}>
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function AddMaterialForm({
  classId,
  onAdded,
  onClose,
}: {
  classId: string;
  onAdded: () => void;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<"file" | "text" | "link">("file");
  const [type, setType] = useState<"BOOK" | "SLIDES">("SLIDES");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Big classes start with their groups collapsed, so say so when something
  // was added instead of leaving it to be found.
  const [added, setAdded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAdded(null);
    const fd = new FormData();
    fd.set("type", type);
    if (title.trim()) fd.set("title", title.trim());

    try {
      let result: { error: string } | undefined;
      if (mode === "file") {
        const file = fileRef.current?.files?.[0];
        if (!file) return setError("Choose a file first.");
        if (file.size > DIRECT_MATERIAL_UPLOAD_MAX_BYTES) {
          setBusy("Uploading…");
          const blob = await upload(`materials/${classId}/${file.name.replace(/[^\w.-]+/g, "-")}`, file, {
            access: "public",
            handleUploadUrl: "/api/material-upload",
            contentType: file.type || undefined,
          });
          setBusy("Reading the file…");
          result = await addClassMaterialFromBlobAction(classId, {
            url: blob.url,
            fileName: file.name,
            type,
            title: title.trim() || undefined,
          });
        } else {
          setBusy("Reading the file…");
          fd.set("file", file);
          result = await addClassMaterialFromFileAction(classId, fd);
        }
      } else if (mode === "link") {
        if (!url.trim()) return setError("Paste a link first.");
        setBusy("Fetching…");
        fd.set("url", url.trim());
        result = await addClassMaterialFromUrlAction(classId, fd);
      } else {
        if (!title.trim() || !content.trim()) return setError("Add a title and some text.");
        setBusy("Saving…");
        fd.set("content", content.trim());
        await addClassMaterialAction(classId, fd);
      }

      if (result?.error) return setError(result.error);
      setAdded(`Added to ${type === "SLIDES" ? "Slides" : "Books and readings"}.`);
      setTitle("");
      setContent("");
      setUrl("");
      if (fileRef.current) fileRef.current.value = "";
      onAdded();
    } catch {
      setError("That didn't work. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const tab = (value: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        mode === value ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5 rounded-xl border border-border-soft bg-bg p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-surface-2 p-0.5">
          {tab("file", "Upload a file")}
          {tab("text", "Paste text")}
          {tab("link", "Add from a link")}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "BOOK" | "SLIDES")}
          aria-label="What is it?"
          className="field field-sm flex-none w-auto"
        >
          <option value="SLIDES">Slides</option>
          <option value="BOOK">Book or reading</option>
        </select>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={mode === "text" ? "Title, like “Chapter 3” or “Week 5 slides”" : "Title (optional)"}
          className="field field-sm flex-1"
        />
      </div>

      {mode === "file" && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.pptx,.docx,.epub,.txt,.html,.htm"
            className="field field-sm w-full file:mr-2 file:rounded-md file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:font-medium"
          />
          <p className="text-xs text-ink-faint">PDF, PowerPoint (.pptx), Word (.docx), EPUB or text, up to 25 MB.</p>
        </>
      )}
      {mode === "text" && (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="Paste an excerpt, an outline, or key points…"
          className="field field-sm w-full"
        />
      )}
      {mode === "link" && (
        <>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="field field-sm w-full"
          />
          <p className="text-xs text-ink-faint">
            A Canvas file link or a regular web page. The text is saved once, when you add it.
          </p>
        </>
      )}

      <div className="flex items-center justify-end gap-3">
        {error && <p className="mr-auto text-xs text-danger">{error}</p>}
        {added && !error && <p className="mr-auto text-xs text-ok">{added}</p>}
        <button
          type="submit"
          disabled={!!busy}
          className="btn btn-primary btn-sm"
        >
          {busy ?? "Add"}
        </button>
      </div>
    </form>
  );
}

function LinksSection({ classId, resources }: { classId: string; resources: ResourceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <section className="card card-pad">
      <CardHeader
        icon={<LinkIcon className="h-[18px] w-[18px]" />}
        title="Links"
        description="Websites, study guides, anything you want one tap away."
      />

      {resources.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {resources.map((r) => (
            <li key={r.id} className="flex items-start gap-3 rounded-xl border border-border-soft bg-surface p-3">
              <ResourceIcon type={r.type} />
              <div className="min-w-0 flex-1 pt-1">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-ink hover:underline">
                    {r.title}
                  </a>
                ) : (
                  <span className="text-sm font-medium text-ink">{r.title}</span>
                )}
                {r.notes && <p className="mt-0.5 text-xs text-ink-soft">{r.notes}</p>}
              </div>
              <button
                onClick={() => {
                  if (!confirm(`Remove "${r.title}"?`)) return;
                  startTransition(async () => {
                    await deleteResourceAction(r.id);
                    router.refresh();
                  });
                }}
                disabled={pending}
                title="Remove"
                aria-label={`Remove ${r.title}`}
                className={REMOVE_BUTTON}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        action={(fd) => {
          startTransition(async () => {
            await addResourceAction(classId, fd);
            router.refresh();
          });
        }}
        className="mt-4 flex flex-col gap-2 border-t border-border-soft pt-4 sm:flex-row"
      >
        <input type="hidden" name="type" value="link" />
        <input
          name="title"
          required
          placeholder="Title"
          aria-label="Link title"
          className="field field-sm sm:w-48"
        />
        <input
          name="url"
          type="url"
          placeholder="https://…"
          aria-label="Link address"
          className="field field-sm flex-1"
        />
        <button
          type="submit"
          disabled={pending}
          className="btn btn-secondary btn-sm flex-none"
        >
          Add link
        </button>
      </form>
    </section>
  );
}

function ResourceIcon({ type }: { type: string }) {
  const Icon = TYPE_ICON[type] ?? LinkIcon;
  return (
    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-surface-2 text-ink-soft">
      <Icon className="h-4 w-4" />
    </span>
  );
}
