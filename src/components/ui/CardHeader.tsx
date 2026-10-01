// The heading row of a card: an optional icon tile, the title, a short line
// about what the card does, and an optional action on the right.
export function CardHeader({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {icon && (
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold leading-snug text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-snug text-ink-faint">{description}</p>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}
