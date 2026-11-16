import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";

/**
 * The numbers under a class: only the ones above zero (a wall of "0 exams,
 * 0 resources" on a new class says nothing), and a link to add a syllabus
 * where there are no resources, which is what fills the rest in.
 */
export function ClassStats({ classId, assignments, exams, resources }: { classId: string; assignments: number; exams: number; resources: number }) {
  const stats = [
    { n: assignments, label: assignments === 1 ? "assignment" : "assignments" },
    { n: exams, label: exams === 1 ? "exam" : "exams" },
    { n: resources, label: resources === 1 ? "resource" : "resources" },
  ].filter((s) => s.n > 0);
  return (
    <div className="mt-auto pt-6">
      {stats.length > 0 && (
        <div className="flex gap-8">
          {stats.map((s) => (
            <Stat key={s.label} n={s.n} label={s.label} />
          ))}
        </div>
      )}
      {resources === 0 && (
        <Link
          href={`/classes/${classId}?tab=resources`}
          className={`relative z-10 inline-flex items-center gap-1 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink ${stats.length > 0 ? "mt-4" : ""}`}
        >
          Add a syllabus
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

/** A big number with its label underneath. */
function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="display-num text-[32px] text-ink">{n}</p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</p>
    </div>
  );
}
