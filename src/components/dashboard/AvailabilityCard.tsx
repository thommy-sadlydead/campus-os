import { addAvailabilityBlockAction, removeAvailabilityBlockAction } from "@/app/dashboard/actions";
import { formatMinutes } from "@/lib/time";
import { CardHeader } from "@/components/ui/CardHeader";
import { CalendarIcon, XIcon } from "@/components/icons";

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
    <section className="card card-pad">
      <CardHeader
        icon={<CalendarIcon className="h-[18px] w-[18px]" />}
        title="Free time today"
        description="Only used if you log it — the dashboard never guesses how much free time you have."
      />

      {blocks.length > 0 && (
        <>
          <ul className="mt-4 flex flex-col gap-1.5">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 py-1.5 pl-3 pr-1.5 text-sm">
                <span className="min-w-0 truncate tabular-nums text-ink">
                  {minutesToTimeLabel(b.startMinute)} – {minutesToTimeLabel(b.endMinute)}
                  {b.label ? <span className="text-ink-soft"> · {b.label}</span> : ""}
                </span>
                <form action={removeAvailabilityBlockAction.bind(null, b.id)}>
                  <button
                    title="Remove"
                    aria-label="Remove"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Total logged: {formatMinutes(totalMinutes)}</p>
        </>
      )}

      <form action={addAvailabilityBlockAction} className="mt-4 grid grid-cols-2 gap-2">
        <label>
          <span className="field-label">Start</span>
          <input type="time" name="start" required className="field" />
        </label>
        <label>
          <span className="field-label">End</span>
          <input type="time" name="end" required className="field" />
        </label>
        <label className="col-span-2">
          <span className="field-label">Label (optional)</span>
          <input type="text" name="label" placeholder="e.g. between classes" className="field" />
        </label>
        <button className="btn btn-secondary col-span-2 mt-1">Add free time</button>
      </form>
    </section>
  );
}
