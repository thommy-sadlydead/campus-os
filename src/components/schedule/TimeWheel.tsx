"use client";

import { useEffect, useRef } from "react";

// A time picker as three scrolling wheels (hour, minute in 5s, AM/PM), the
// way iPhone time pickers work, instead of an empty time box. Posts the
// time as "HH:MM" (24-hour) in a hidden input named `name`, the same value
// an <input type="time"> sends.

const ROW = 40;
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
const PERIODS = ["AM", "PM"];

/** Minutes after midnight as "HH:MM". */
export function toTimeField(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function TimeWheel({ name, label, value, onChange }: { name: string; label: string; value: number; onChange: (minute: number) => void }) {
  const hour24 = Math.floor(value / 60);
  const hourIndex = (hour24 + 11) % 12;
  const minuteIndex = Math.min(11, Math.round((value % 60) / 5));
  const periodIndex = hour24 >= 12 ? 1 : 0;

  const set = (h: number, m: number, p: number) => onChange(((h + 1) % 12 + p * 12) * 60 + m * 5);

  return (
    <div>
      <span className="field-label">{label}</span>
      <input type="hidden" name={name} value={toTimeField(value)} />
      <div className="relative flex rounded-xl2 border border-border-soft bg-surface px-2">
        {/* The band the chosen row sits in. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-2 top-1/2 h-10 -translate-y-1/2 rounded-xl bg-surface-2" />
        <Wheel items={HOURS} index={hourIndex} label={`${label} hour`} onChange={(i) => set(i, minuteIndex, periodIndex)} />
        <span aria-hidden className="relative z-10 flex items-center text-[17px] font-semibold text-ink">:</span>
        <Wheel items={MINUTES} index={minuteIndex} label={`${label} minute`} onChange={(i) => set(hourIndex, i, periodIndex)} />
        <Wheel items={PERIODS} index={periodIndex} label={`${label} AM or PM`} onChange={(i) => set(hourIndex, minuteIndex, i)} />
      </div>
    </div>
  );
}

function Wheel({ items, index, label, onChange }: { items: string[]; index: number; label: string; onChange: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the value when it changes from outside (say, the end time moved
  // after the start did), without fighting a scroll in progress.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ROW) !== index) el.scrollTo({ top: index * ROW });
  }, [index]);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" && index < items.length - 1) {
          e.preventDefault();
          onChange(index + 1);
        } else if (e.key === "ArrowUp" && index > 0) {
          e.preventDefault();
          onChange(index - 1);
        }
      }}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (settle.current) clearTimeout(settle.current);
        settle.current = setTimeout(() => {
          const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
          if (i !== index) onChange(i);
        }, 90);
      }}
      className="relative z-10 h-[120px] flex-1 snap-y snap-mandatory overflow-y-scroll py-10 text-center outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item, i) => (
        <div
          key={item}
          role="option"
          aria-selected={i === index}
          onClick={() => onChange(i)}
          className={`flex h-10 snap-center items-center justify-center text-[17px] tabular-nums transition-colors ${
            i === index ? "font-semibold text-ink" : "text-ink-faint"
          }`}
        >
          {item}
        </div>
      ))}
    </div>
  );
}
