import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function NotesPage() {
  const user = await requireUser();
  return (
    <AppShell active="/notes" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Notes</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Freeform, per-class notes organized into sections you create, rename, delete, and
        reorder yourself — no forced structure.
      </p>
      <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        Coming in phase 2. The <code>NoteSection</code> / <code>Note</code> models are already in
        the schema — the seed script creates a starter "General" section per class.
      </div>
    </AppShell>
  );
}
