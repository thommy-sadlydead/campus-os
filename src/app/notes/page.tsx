import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { NotesBoard } from "@/components/notes/NotesBoard";

export default async function NotesPage({ searchParams }: { searchParams: { classId?: string } }) {
  const user = await requireUser();

  const classes = await prisma.class.findMany({
    where: { userId: user.id, archived: false },
    orderBy: { name: "asc" },
  });

  if (classes.length === 0) {
    return (
      <AppShell active="/notes" userName={user.name ?? user.email}>
        <h1 className="mb-1 font-display text-2xl font-semibold">Notes</h1>
        <div className="mt-4 rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          Add a class first — notes belong to a class. Run{" "}
          <code className="font-mono">npm run db:seed</code> or <code className="font-mono">npm run canvas:sync</code>.
        </div>
      </AppShell>
    );
  }

  const activeClass = classes.find((c) => c.id === searchParams.classId) ?? classes[0];

  const sections = await prisma.noteSection.findMany({
    where: { classId: activeClass.id },
    orderBy: { order: "asc" },
    include: { notes: { orderBy: { order: "asc" } } },
  });

  return (
    <AppShell active="/notes" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Notes</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Organized however you want, per class — sections you name, notes you pin, nothing forced.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        {classes.map((c) => (
          <Link
            key={c.id}
            href={`/notes?classId=${c.id}`}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              c.id === activeClass.id
                ? "border-ink bg-ink text-surface"
                : "border-border text-ink-soft hover:bg-surface-2"
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: `var(--c-${c.color})` }} />
            {c.name}
          </Link>
        ))}
      </div>

      <NotesBoard
        classId={activeClass.id}
        sections={sections.map((s) => ({
          id: s.id,
          name: s.name,
          order: s.order,
          notes: s.notes.map((n) => ({
            id: n.id,
            title: n.title,
            bodyMarkdown: n.bodyMarkdown,
            pinned: n.pinned,
            order: n.order,
            updatedAt: n.updatedAt.toISOString(),
          })),
        }))}
      />
    </AppShell>
  );
}
