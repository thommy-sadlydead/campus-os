import { formatMinutes, formatDueLabel } from "@/lib/time";
import type { WorkloadSummary } from "@/lib/priority-engine";
import { CardHeader } from "@/components/ui/CardHeader";
import { ChecklistIcon } from "@/components/icons";

export function WorkloadSummaryCard({
  summary,
  now,
  tz,
}: {
  summary: WorkloadSummary;
  now: Date;
  tz: string;
}) {
  return (
    <section className="card card-pad">
      <CardHeader icon={<ChecklistIcon className="h-[18px] w-[18px]" />} title="Today's workload" />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Overdue" value={summary.overdueCount} tone={summary.overdueCount > 0 ? "danger" : undefined} />
        <Stat label="Due today" value={summary.dueTodayCount} />
        <Stat label="Due tomorrow" value={summary.dueTomorrowCount} />
      </div>

      <dl className="mt-4 flex flex-col gap-2.5 text-sm">
        <Row label="Work remaining today">
          {formatMinutes(summary.totalRemainingMinutesToday)}
          {summary.itemsMissingEstimateToday > 0 && (
            <span className="ml-1 text-xs font-normal text-ink-faint">(+{summary.itemsMissingEstimateToday} unestimated)</span>
          )}
        </Row>
        <Row label="Free time logged today">
          {summary.availableMinutesToday == null ? (
            <span className="font-normal text-ink-faint">not tracked yet</span>
          ) : (
            formatMinutes(summary.availableMinutesToday)
          )}
        </Row>
        {summary.aheadBehindMinutes != null && (
          <Row label="Ahead / behind">
            <span className={summary.aheadBehindMinutes < 0 ? "text-danger" : "text-ok"}>
              {summary.aheadBehindMinutes >= 0 ? "+" : ""}
              {formatMinutes(Math.abs(summary.aheadBehindMinutes))}
              {summary.aheadBehindMinutes < 0 ? " behind" : " ahead"}
            </span>
          </Row>
        )}
      </dl>

      {summary.upcomingDeadlines.length > 0 && (
        <div className="mt-5 border-t border-border-soft pt-4">
          <h3 className="eyebrow">Upcoming deadlines</h3>
          <ul className="mt-2.5 flex flex-col gap-2">
            {summary.upcomingDeadlines.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink">{d.title}</span>
                <span className="flex-none text-xs text-ink-faint">{formatDueLabel(d.dueAt, now, tz)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-ink">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  const danger = tone === "danger" && value > 0;
  return (
    <div className={`rounded-xl px-3 py-2.5 ${danger ? "bg-danger-soft" : "bg-surface-2"}`}>
      <div className={`text-xl font-semibold tabular-nums leading-tight ${danger ? "text-danger" : "text-ink"}`}>{value}</div>
      <div className={`mt-0.5 text-[11px] font-medium ${danger ? "text-danger" : "text-ink-faint"}`}>{label}</div>
    </div>
  );
}
