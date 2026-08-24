interface PillOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface PillGroupProps<T extends string> {
  legend: string;
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name: string;
}

export function PillGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  name,
}: PillGroupProps<T>) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={legend}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={opt.hint}
              onClick={() => onChange(opt.value)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
                active
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface text-ink hover:bg-surface-2"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <input type="hidden" name={name} value={value} />
    </fieldset>
  );
}
