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
    return (
      <div className="rounded-xl2 border border-dashed border-border p-8 text-center text-sm text-ink-soft">
        No exams on file for this class yet.
      </div>
    );
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
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {exams.length === 0 ? (
        <p className="text-sm text-ink-faint">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {exams.map((e) => (
            <li key={e.id} className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{e.name}</span>
                <span className="text-sm text-ink-soft">{formatDueLabel(e.examAt ? new Date(e.examAt) : null, now, tz)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-faint">
                {e.location && <span>{e.location}</span>}
                {e.weight != null && <span>{e.weight}% of grade</span>}
              </div>
              {e.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{e.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
