import { fromZonedTime } from "date-fns-tz";
import { dayKey } from "@/lib/time";

// Smart review (src/lib/features.ts): flashcards come back on a schedule.
// A card you get right waits longer before it comes back each time in a
// row (1, 3, 7, 14, then 30 days); one you miss comes back the same day.
// Spacing reviews out and testing yourself are the two study techniques
// with the strongest evidence (Dunlosky et al., 2013). Pure, so it's easy
// to test.

/** Days until a card comes back, by how many times in a row it's been right. */
export const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
export const MAX_BOX = REVIEW_INTERVAL_DAYS.length - 1;

/** "2026-11-04" plus `days` calendar days. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Where a card goes after an answer: right moves it up a box and later, wrong starts it over today. */
export function nextReview(box: number, gotIt: boolean, now: Date, tz: string): { box: number; dueAt: Date } {
  if (!gotIt) return { box: 0, dueAt: now };
  const next = Math.min(Math.max(0, box) + 1, MAX_BOX);
  return { box: next, dueAt: fromZonedTime(`${addDays(dayKey(now, tz), REVIEW_INTERVAL_DAYS[next])}T00:00:00`, tz) };
}

/**
 * A card to review now: one that's been studied and whose day has come.
 * Cards never studied aren't "due" (they're new, and Study covers them),
 * or every deck made before Smart review would be due all at once.
 */
export function isDue(card: { dueAt: Date | string | null }, now: Date): boolean {
  return card.dueAt !== null && new Date(card.dueAt).getTime() <= now.getTime();
}

export function dueCount(cards: { dueAt: Date | string | null }[], now: Date): number {
  return cards.filter((c) => isDue(c, now)).length;
}
