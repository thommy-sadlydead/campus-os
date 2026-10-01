"use client";

import { Children, useState, type ReactNode } from "react";

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
      <li>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full rounded-lg border border-dashed border-border py-2 text-sm font-medium text-ink-soft hover:bg-surface-2 hover:text-ink"
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      </li>
    </>
  );
}
