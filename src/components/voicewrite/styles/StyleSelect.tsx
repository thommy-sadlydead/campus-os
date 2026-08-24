"use client";

import { DEFAULT_STYLE_ID } from "@/lib/voicewrite/types";
import type { WritingStyle } from "@/lib/voicewrite/types";
import { Button } from "@/components/voicewrite/ui/Button";

interface StyleSelectProps {
  styles: WritingStyle[];
  selectedStyleId: string;
  onChange: (id: string) => void;
  onManageClick: () => void;
}

export function StyleSelect({
  styles,
  selectedStyleId,
  onChange,
  onManageClick,
}: StyleSelectProps) {
  return (
    <div>
      <label htmlFor="writing-style" className="mb-1.5 block text-sm font-medium text-ink">
        Writing Style
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <select
            id="writing-style"
            value={selectedStyleId}
            onChange={(e) => onChange(e.target.value)}
            className="w-full appearance-none rounded-xl border border-border bg-surface px-3.5 py-2.5 pr-9 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          >
            <option value={DEFAULT_STYLE_ID}>Default Natural Style</option>
            {styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.name}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <Button type="button" variant="secondary" onClick={onManageClick} className="sm:w-auto">
          Manage Styles
        </Button>
      </div>
    </div>
  );
}
