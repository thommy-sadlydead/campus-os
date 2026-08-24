import type { NaturalnessCheck } from "@/lib/voicewrite/naturalness";

interface NaturalnessCheckPanelProps {
  data: NaturalnessCheck | null;
}

const VARIETY_LABEL: Record<NaturalnessCheck["lengthVariety"], string> = {
  low: "sentences are fairly uniform in length",
  moderate: "some sentence-length variation",
  good: "good sentence-length variation",
};

export function NaturalnessCheckPanel({ data }: NaturalnessCheckPanelProps) {
  if (!data) return null;

  const hasFlags = data.repeatedOpeners.length > 0 || data.flaggedPhrases.length > 0;

  return (
    <div className="rounded-xl border border-border-soft bg-surface-2 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink">
          Naturalness check
        </h3>
        <span className="text-xs text-ink-faint">
          {data.wordCount} words · {data.sentenceCount} sentences
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-xs text-ink-faint">
        <li>
          Sentence length {data.shortestSentence}–{data.longestSentence} words (avg{" "}
          {data.avgSentenceLength}) — {VARIETY_LABEL[data.lengthVariety]}
        </li>
        <li>
          {data.contractionCount} contraction{data.contractionCount === 1 ? "" : "s"} used
        </li>
        {data.repeatedOpeners.map((o) => (
          <li key={o.word} className="text-warn">
            {o.count} sentences start with &ldquo;{o.word}&rdquo;
          </li>
        ))}
        {data.flaggedPhrases.map((p) => (
          <li key={p.phrase} className="text-warn">
            Common phrase found: &ldquo;{p.phrase}&rdquo; ({p.count}×)
          </li>
        ))}
        {!hasFlags && (
          <li className="text-ok">
            No repeated sentence openers or common filler phrases detected.
          </li>
        )}
      </ul>
      <p className="mt-2 text-[11px] italic text-ink-faint">
        A plain analysis of this text&apos;s own structure — not a prediction
        from any AI detector.
      </p>
    </div>
  );
}
