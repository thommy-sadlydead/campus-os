import { formatDueLabel } from "@/lib/time";

export interface ExamRow {
  id: string;
  name: string;
  examAt: string | null;
  location: string | null;
  weight: number | null;
  notes: string | null;
}

export function ExamsPanel({ exams, tz }: { exams: ExamRow[]; tz: string }) {
  const now = new Date();
  if (exams.length === 0) {
    return <div className="empty">No exams on file for this class yet.</div>;
  }

  const upcoming = exams.filter((e) => !e.examAt || new Date(e.examAt) >= now);
  const past = exams.filter((e) => e.examAt && new Date(e.examAt) < now);

  return (
    <div className="flex flex-col gap-6">
      <ExamGroup title="Upcoming" exams={upcoming} tz={tz} now={now} empty="Nothing upcoming." />
      {past.length > 0 && <ExamGroup title="Past" exams={past} tz={tz} now={now} empty="" />}
    </div>
  );
}

function ExamGroup({ title, exams, tz, now, empty }: { title: string; exams: ExamRow[]; tz: string; now: Date; empty: string }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-border-soft px-4 py-3 sm:px-5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="badge bg-surface-2 tabular-nums text-ink-soft">{exams.length}</span>
      </header>
      {exams.length === 0 ? (
        <p className="px-4 py-5 text-sm text-ink-faint sm:px-5">{empty}</p>
      ) : (
        <ul className="divide-y divide-border-soft">
          {exams.map((e) => (
            <li key={e.id} className="flex gap-4 px-4 py-4 sm:px-5">
              <DateTile iso={e.examAt} tz={tz} />
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug text-ink">{e.name}</p>
                <p className="mt-0.5 text-[13px] text-ink-soft">{formatDueLabel(e.examAt ? new Date(e.examAt) : null, now, tz)}</p>
                {(e.location || e.weight != null) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.location && <span className="badge bg-surface-2 text-ink-soft">{e.location}</span>}
                    {e.weight != null && <span className="badge bg-surface-2 text-ink-soft">{e.weight}% of grade</span>}
                  </div>
                )}
                {e.notes && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{e.notes}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A calendar-page tile: "OCT" over "14", or "TBD" when there's no date yet. */
function DateTile({ iso, tz }: { iso: string | null; tz: string }) {
  if (!iso) {
    return (
      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-surface-2 text-[11px] font-semibold text-ink-faint">
        TBD
      </span>
    );
  }
  const d = new Date(iso);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: tz }).format(d);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: tz }).format(d);
  return (
    <span className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-xl bg-surface-2 leading-none">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-ink">{month}</span>
      <span className="mt-1 text-lg font-semibold tabular-nums text-ink">{day}</span>
    </span>
  );
}
