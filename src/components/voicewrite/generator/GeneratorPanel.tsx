"use client";

import {
  AUDIENCE_SUGGESTIONS,
  LENGTH_OPTIONS,
  MAX_PROMPT_LENGTH,
  PROMPT_PLACEHOLDER,
  TONE_OPTIONS,
} from "@/lib/voicewrite/constants";
import type { LengthOption, ToneOption } from "@/lib/voicewrite/types";
import { Button } from "@/components/voicewrite/ui/Button";
import { Spinner } from "@/components/voicewrite/ui/Spinner";
import { PillGroup } from "./PillGroup";

interface GeneratorPanelProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  tone: ToneOption;
  onToneChange: (value: ToneOption) => void;
  length: LengthOption;
  onLengthChange: (value: LengthOption) => void;
  audience: string;
  onAudienceChange: (value: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  errorMessage: string | null;
}

export function GeneratorPanel({
  prompt,
  onPromptChange,
  tone,
  onToneChange,
  length,
  onLengthChange,
  audience,
  onAudienceChange,
  onGenerate,
  isGenerating,
  errorMessage,
}: GeneratorPanelProps) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="prompt" className="mb-1.5 block text-sm font-medium text-ink">
          What do you want to write?
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
          placeholder={PROMPT_PLACEHOLDER}
          rows={5}
          className="w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-base leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <div className="mt-1 text-right text-xs text-ink-faint">
          {prompt.length}/{MAX_PROMPT_LENGTH}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PillGroup
          legend="Tone"
          name="tone"
          options={TONE_OPTIONS}
          value={tone}
          onChange={onToneChange}
        />
        <PillGroup
          legend="Length"
          name="length"
          options={LENGTH_OPTIONS}
          value={length}
          onChange={onLengthChange}
        />
      </div>

      <div>
        <label htmlFor="audience" className="mb-1.5 block text-sm font-medium text-ink">
          Audience
        </label>
        <input
          id="audience"
          type="text"
          list="audience-suggestions"
          value={audience}
          onChange={(e) => onAudienceChange(e.target.value)}
          placeholder="General audience"
          className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <datalist id="audience-suggestions">
          {AUDIENCE_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      {errorMessage && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      <Button
        type="button"
        variant="primary"
        size="lg"
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-full sm:w-auto sm:self-start sm:px-10"
      >
        {isGenerating ? (
          <>
            <Spinner /> Generating…
          </>
        ) : (
          "Generate"
        )}
      </Button>
    </div>
  );
}
