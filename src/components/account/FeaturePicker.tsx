"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFeaturesAction } from "@/app/account/actions";
import { CORE_FEATURES, FEATURES, FEATURE_GROUPS, featureInfo, toggleFeature, type FeatureId } from "@/lib/features";
import { CheckIcon } from "@/components/icons";

/**
 * Checkboxes for every optional feature (src/lib/features.ts), grouped,
 * with what's always included listed first. Used at sign-up (/welcome,
 * which then goes to Today) and under Account → Features.
 */
export function FeaturePicker({
  initial,
  available,
  aiAllowed,
  mode,
}: {
  initial: FeatureId[];
  /** What this account can turn on (Email only for Gmail testers). */
  available: FeatureId[];
  aiAllowed: boolean;
  mode: "welcome" | "account";
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<FeatureId[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const shown = FEATURES.filter((f) => available.includes(f.id));
  const anyAi = picked.some((id) => featureInfo(id).usesAi);

  function set(next: FeatureId[]) {
    setPicked(next);
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveFeaturesAction(picked);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (mode === "welcome") {
        router.push("/dashboard");
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow mb-2">Always included</p>
        <ul className="flex flex-wrap gap-1.5">
          {CORE_FEATURES.map((name) => (
            <li key={name} className="badge max-w-full whitespace-normal bg-surface-2 text-ink-soft">
              <CheckIcon className="h-3.5 w-3.5 flex-none" />
              {name}
            </li>
          ))}
        </ul>
      </div>

      {FEATURE_GROUPS.map((group) => {
        const items = shown.filter((f) => f.group === group);
        if (items.length === 0) return null;
        return (
          <fieldset key={group}>
            <legend className="eyebrow mb-2">{group}</legend>
            <ul className="flex flex-col divide-y divide-border-soft rounded-xl2 border border-border-soft">
              {items.map((f) => {
                const on = picked.includes(f.id);
                const needs = (f.requires ?? []).map((r) => featureInfo(r).name);
                return (
                  <li key={f.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent-ring)]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => set(toggleFeature(picked, f.id, e.target.checked))}
                        className="mt-1 h-4 w-4 flex-none accent-[var(--accent)]"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                          {f.name}
                          {f.isNew && <span className="badge bg-accent-soft text-accent-ink">New</span>}
                        </span>
                        <span className="mt-0.5 block text-sm leading-relaxed text-ink-soft">{f.description}</span>
                        {(needs.length > 0 || f.usesAi) && (
                          <span className="mt-1 block text-xs text-ink-faint">
                            {[needs.length > 0 ? `Turns on ${needs.join(" and ")} too` : null, f.usesAi ? "Uses AI" : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      {anyAi && !aiAllowed && (
        <p className="text-sm leading-relaxed text-ink-soft">
          Features marked &quot;Uses AI&quot; also need your permission to send your class info to the AI services we use. You can
          allow that from Today or under Account → AI features.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className={`btn btn-primary ${mode === "welcome" ? "btn-lg" : ""}`}>
          {pending ? "Saving…" : mode === "welcome" ? "Continue" : "Save features"}
        </button>
        <button type="button" onClick={() => set(toggleAll(shown.map((f) => f.id), picked))} className="btn btn-ghost btn-sm">
          {picked.length === shown.length ? "Clear all" : "Select all"}
        </button>
        {saved && <span className="text-sm text-ink-soft">Saved.</span>}
        {error && (
          <p role="alert" className="w-full text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
      {mode === "welcome" && <p className="-mt-3 text-xs text-ink-faint">You can change these any time under Account → Features.</p>}
    </div>
  );
}

function toggleAll(all: FeatureId[], picked: FeatureId[]): FeatureId[] {
  return picked.length === all.length ? [] : all;
}
