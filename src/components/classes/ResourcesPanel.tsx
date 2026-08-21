import { addResourceAction, deleteResourceAction } from "@/app/classes/[id]/actions";

export interface ResourceRow {
  id: string;
  title: string;
  type: string;
  url: string | null;
  notes: string | null;
  addedAt: string;
}

const TYPE_ICON: Record<string, string> = { link: "🔗", file: "📄", document: "📝" };

export function ResourcesPanel({ classId, resources }: { classId: string; resources: ResourceRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      {resources.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No resources saved yet — add a syllabus link, a study guide, or anything else worth keeping handy.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {resources.map((r) => (
            <li key={r.id} className="flex items-start gap-3 rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
              <span aria-hidden className="text-lg">{TYPE_ICON[r.type] ?? "🔗"}</span>
              <div className="min-w-0 flex-1">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {r.title}
                  </a>
                ) : (
                  <span className="font-medium">{r.title}</span>
                )}
                {r.notes && <p className="mt-0.5 text-sm text-ink-soft">{r.notes}</p>}
              </div>
              <form action={deleteResourceAction.bind(null, r.id)}>
                <button className="flex-none text-xs text-ink-faint hover:text-danger">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addResourceAction.bind(null, classId)} className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
        <h4 className="mb-3 text-sm font-semibold">Add a resource</h4>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input name="title" required placeholder="Title" className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
          <select name="type" defaultValue="link" className="rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent">
            <option value="link">Link</option>
            <option value="document">Document</option>
            <option value="file">File</option>
          </select>
        </div>
        <input name="url" placeholder="https:// (optional)" className="mt-2 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
        <input name="notes" placeholder="Notes (optional)" className="mt-2 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
        <button type="submit" className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
          Add
        </button>
      </form>
    </div>
  );
}
