import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function SchedulePage() {
  const user = await requireUser();
  return (
    <AppShell active="/schedule" userName={user.name ?? user.email}>
      <h1 className="mb-1 font-display text-2xl font-semibold">Schedule</h1>
      <p className="mb-6 text-sm text-ink-soft">
        A weekly view of your recurring class meeting times, built on the <code>ScheduleEvent</code>{" "}
        model already in the schema.
      </p>
      <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        Coming in phase 2, alongside the per-class pages where you'll be able to add meeting
        times, rooms, and professors.
      </div>
    </AppShell>
  );
}
