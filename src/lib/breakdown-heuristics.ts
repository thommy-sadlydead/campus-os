// The no-AI-key fallback for Automatic Assignment Breakdown. Pure,
// dependency-free — mirrors heuristicEstimateMinutes in priority-engine.ts
// (same regex-pattern-matching style) so it's unit-tested the same way;
// see tests/breakdown-heuristics.test.ts.
//
// Splits an assignment's *existing* time estimate into steps rather than
// inventing new total effort — the sum of step estimates always comes
// back to roughly the input total. Deliberately skips anything too small
// to be worth splitting (the spec's own example only breaks down the big
// research paper, not the 2-minute attendance check), and picks a
// different shape of steps depending on what kind of assignment this
// looks like — "not a one-size-fits-all workflow."

export interface BreakdownInput {
  name: string;
  baseEstimateMinutes: number;
}

export interface BreakdownStep {
  title: string;
  estimatedMinutes: number;
}

/** Below this, breaking work into steps adds more overhead than it saves. */
const MIN_MINUTES_TO_SPLIT = 30;

function split(total: number, parts: Array<[string, number]>): BreakdownStep[] {
  return parts.map(([title, fraction]) => ({ title, estimatedMinutes: Math.max(5, Math.round(total * fraction)) }));
}

export function heuristicBreakdown(input: BreakdownInput): BreakdownStep[] {
  const total = input.baseEstimateMinutes;
  if (!total || total < MIN_MINUTES_TO_SPLIT) return [];

  const name = input.name.toLowerCase();

  // Order matters: check the more specific "what kind of deliverable is
  // this" words first, and leave the bare "exam"/"midterm" catch-all for
  // last — otherwise something like "Final Project" or "Final
  // Presentation" would get misread as exam prep just because it starts
  // with "Final." ("final exam" itself is still caught explicitly below.)
  if (/\b(paper|essay|draft)\b/.test(name)) {
    return split(total, [
      ["Outline", 0.2],
      ["Write first draft", 0.5],
      ["Revise and edit", 0.3],
    ]);
  }
  if (/\bpresentation\b/.test(name)) {
    return split(total, [
      ["Research the topic", 0.35],
      ["Build slides", 0.4],
      ["Practice run-through", 0.25],
    ]);
  }
  if (/\bproject\b/.test(name)) {
    return split(total, [
      ["Plan and outline", 0.2],
      ["Do the core work", 0.6],
      ["Review and finalize", 0.2],
    ]);
  }
  if (/\b(final exam|midterm exam|midterm|exam)\b/.test(name)) {
    return split(total, [
      ["Review notes", 0.4],
      ["Practice problems", 0.4],
      ["Final review pass", 0.2],
    ]);
  }
  if (/\b(homework|problem set|hw)\b/.test(name)) {
    return split(total, [
      ["Work through the problems", 0.8],
      ["Check your answers", 0.2],
    ]);
  }
  if (/\breading\b/.test(name)) {
    return split(total, [
      ["Read", 0.8],
      ["Take notes / summarize", 0.2],
    ]);
  }
  if (/\b(quiz|discussion|response|reflection|journal)\b/.test(name)) {
    // Short-form work — even above the split threshold, these are rarely
    // worth more than a single step.
    return [];
  }

  // Generic fallback for anything else large enough to bother splitting.
  return split(total, [
    ["Get started", 0.3],
    ["Finish the work", 0.5],
    ["Review before submitting", 0.2],
  ]);
}
