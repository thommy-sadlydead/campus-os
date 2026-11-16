"use client";

import { useState } from "react";
import Link from "next/link";
import { CLASS_TIMES_NOT_NOW_COOKIE } from "@/lib/class-times";
import { CalendarIcon } from "@/components/icons";

/**
 * Today's one-time ask for class times, once classes have come in without
 * any (src/lib/class-times.ts). "Add class times" goes to Schedule, where
 * they're typed in; "Not now" hides it for a year. It also ends by itself
 * the moment any meeting time exists.
 */
export function ClassTimesCard({ recordOn }: { recordOn: boolean }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  function notNow() {
    setHidden(true);
    document.cookie = `${CLASS_TIMES_NOT_NOW_COOKIE}=1; path=/; max-age=${365 * 24 * 60 * 60}; samesite=lax`;
  }

  return (
    <section className="card card-pad">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
          <CalendarIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="pt-0.5 text-[15px] font-semibold leading-snug text-ink">When do your classes meet?</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            {recordOn
              ? "Your school doesn't share class times, so add them once. Then Record opens on the right class, and your Schedule shows your day."
              : "Your school doesn't share class times, so add them once. Then your Schedule shows your day and which class is next."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/schedule" className="btn btn-primary btn-sm">
              Add class times
            </Link>
            <button type="button" onClick={notNow} className="btn btn-ghost btn-sm">
              Not now
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
