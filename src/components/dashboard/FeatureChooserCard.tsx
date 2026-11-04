import Link from "next/link";
import { keepCurrentFeaturesAction } from "@/app/account/actions";
import { LayersIcon } from "@/components/icons";

/** On Today until the student picks features (src/lib/features.ts): accounts from before the picker, or a skipped /welcome. */
export function FeatureChooserCard() {
  return (
    <section className="card card-pad mb-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
          <LayersIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="pt-0.5 text-[15px] font-semibold leading-snug text-ink">Pick what you want in Campus OS</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            New: exam prep plans, grades, smart flashcard review, tutor mode, getting help in a class, and your work schedule.
            Turn on what you&apos;ll use and hide the rest.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/welcome" className="btn btn-primary btn-sm">
              Pick features
            </Link>
            <form action={keepCurrentFeaturesAction}>
              <button className="btn btn-ghost btn-sm">Keep things as they are</button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
