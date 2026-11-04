import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { CardHeader } from "@/components/ui/CardHeader";
import { AlertIcon, ChevronRightIcon } from "@/components/icons";
import { formatPercent, type GradeSlip } from "@/lib/grades";

export interface GradeAlert {
  classId: string;
  className: string;
  percent: number;
  slip: GradeSlip;
  /** With Getting help on: the class's office hours, when they're on file. */
  officeHours: string | null;
}

/** Grades on Today: classes whose grade dropped or is under the student's goal (gradeSlip). */
export function GradeAlertsCard({ alerts, tz, helpOn }: { alerts: GradeAlert[]; tz: string; helpOn: boolean }) {
  return (
    <section className="card card-pad">
      <CardHeader icon={<AlertIcon className="h-[18px] w-[18px]" />} title="Grades to keep an eye on" />
      <ul className="mt-3 flex flex-col gap-1">
        {alerts.map((a) => (
          <li key={a.classId}>
            <Link href={`/classes/${a.classId}`} className="-mx-2 flex items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">
                  {a.className}: {formatPercent(a.percent)}
                </span>
                <span className="mt-0.5 block text-[13px] text-ink-soft">
                  {a.slip.kind === "dropped"
                    ? `Down ${a.slip.points} points since ${formatInTimeZone(a.slip.since, tz, "MMM d")}`
                    : `Under your goal of ${formatPercent(a.slip.target)}`}
                  {helpOn ? (a.officeHours ? ` · Office hours ${a.officeHours}` : " · Email your professor from the class page") : ""}
                </span>
              </span>
              <ChevronRightIcon className="mt-0.5 h-4 w-4 flex-none text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
