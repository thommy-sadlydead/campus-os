import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function EmailPage() {
  const user = await requireUser();
  return (
    <AppShell active="/email" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Email</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Connects to your school Gmail (Cedarville runs Google Workspace) via OAuth — read-only,
        no password ever touches this app — and surfaces only the academically relevant emails:
        due-date changes, room/schedule changes, syllabus updates, professor instructions.
      </p>
      <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        Coming in phase 4. Conflicting info from an email (e.g. an exam time change) will always
        show both versions and ask you which to keep — nothing gets overwritten automatically.
      </div>
    </AppShell>
  );
}
