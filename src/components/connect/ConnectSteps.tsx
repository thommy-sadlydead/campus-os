/** Numbered how-to steps for a Connect page ("In Canvas, go to Account → Settings"). */
export function ConnectSteps({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="mt-4 flex flex-col gap-3 text-sm text-ink-soft">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-soft">
            {i + 1}
          </span>
          <span className="min-w-0 pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** The bold name of something to click or find in the LMS. */
export function Ui({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}
