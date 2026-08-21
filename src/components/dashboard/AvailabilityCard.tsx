import { addAvailabilityBlockAction, removeAvailabilityBlockAction } from "@/app/dashboard/actions";
import { formatMinutes } from "@/lib/time";

function minutesToTimeLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function AvailabilityCard({
  blocks,
}: {
  blocks: Array<{ id: string; startMinute: number; endMinute: number; label: string | null }>;
}) {
  const totalMinutes = blocks.reduce((s, b) => s + (b.endMinute - b.startMinute), 0);

  return (
    <div className="rounded-xl2 border border-border-soft bg-surface p-5 shadow-card">
      <h3 className="font-display text-base font-semibold">Free time today</h3>
      <p className="mt-0.5 text-xs text-ink-faint">
        Only used if you log it — the dashboard never guesses how much free time you have.
      </p>

      {blocks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {blocks.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-sm"
            >
              <span>
                {minutesToTimeLabel(b.startMinute)} – {minutesToTimeLabel(b.endMinute)}
                {b.label ? ` · ${b.label}` : ""}
              </span>
              <form action={removeAvailabilityBlockAction.bind(null, b.id)}>
                <button className="text-xs text-ink-faint hover:text-danger">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {blocks.length > 0 && (
        <p className="mt-2 text-xs text-ink-soft">Total logged: {formatMinutes(totalMinutes)}</p>
      )}

      <form action={addAvailabilityBlockAction} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-soft">Start</label>
          <input
            type="time"
            name="start"
            required
            className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-soft">End</label>
          <input
            type="time"
            name="end"
            required
            className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-ink-soft">Label (optional)</label>
          <input
            type="text"
            name="label"
            placeholder="e.g. between classes"
            className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
          Add
        </button>
      </form>
    </div>
  );
}
