import Link from "next/link";
import { CardHeader } from "@/components/ui/CardHeader";
import { CardsIcon, ChevronRightIcon } from "@/components/icons";

/** Smart review on Today (src/lib/spaced-review.ts): flashcards whose day has come, by class. */
export function ReviewDueCard({ classes }: { classes: { classId: string; className: string; due: number }[] }) {
  const total = classes.reduce((n, c) => n + c.due, 0);
  return (
    <section className="card card-pad">
      <CardHeader
        icon={<CardsIcon className="h-[18px] w-[18px]" />}
        title={`${total} flashcard${total === 1 ? "" : "s"} to review`}
        description="A few minutes now keeps them from slipping away."
      />
      <ul className="mt-3 flex flex-col">
        {classes.map((c) => (
          <li key={c.classId}>
            <Link href={`/classes/${c.classId}?tab=study`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
              <span className="min-w-0 truncate text-ink">{c.className}</span>
              <span className="flex flex-none items-center gap-1 text-ink-soft">
                {c.due}
                <ChevronRightIcon className="h-4 w-4 text-ink-faint" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
