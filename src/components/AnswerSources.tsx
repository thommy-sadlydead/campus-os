// Under an assistant's answer: the items and files it opened to write it
// (src/lib/study-agent), so the student can see what it's based on.
export function AnswerSources({ sources }: { sources?: string[] }) {
  if (!sources?.length) return null;
  const shown = sources.slice(0, 8);
  const more = sources.length - shown.length;
  return (
    <p className="mt-3 border-t border-border-soft pt-2.5 text-xs text-ink-faint">
      <span className="font-medium text-ink-soft">Based on:</span> {shown.join(" · ")}
      {more > 0 ? ` · and ${more} more` : ""}
    </p>
  );
}
