"use client";

import { Children, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/icons";

/**
 * Shows the first `initial` children and a "Show all" button for the rest,
 * so a long list (51 overdue items, say) doesn't push everything below it
 * off the bottom of a phone screen. The children can be server-rendered.
 */
export function ShowMore({ initial, children }: { initial: number; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const hidden = items.length - initial;
  if (hidden <= 0) return <>{items}</>;

  return (
    <>
      {expanded ? items : items.slice(0, initial)}
      <li className="border-t border-border-soft">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1.5 py-3 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </li>
    </>
  );
}
