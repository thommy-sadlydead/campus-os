"use client";

import { useState, useSyncExternalStore } from "react";
import { StyleSelect } from "@/components/voicewrite/styles/StyleSelect";
import { StyleManagerModal } from "@/components/voicewrite/styles/StyleManagerModal";
import { GeneratorPanel } from "@/components/voicewrite/generator/GeneratorPanel";
import { OutputEditor } from "@/components/voicewrite/output/OutputEditor";
import { ToastProvider, useToast } from "@/components/voicewrite/ui/Toast";
import { DEFAULT_AUDIENCE } from "@/lib/voicewrite/constants";
import { markdownToSafeHtml } from "@/lib/voicewrite/markdown";
import {
  createStyle,
  removeStyle,
  selectedStyleIdStore,
  stylesStore,
  updateStyle,
} from "@/lib/voicewrite/storage";
import {
  DEFAULT_STYLE_ID,
  type ApiErrorBody,
  type GenerateResponseBody,
  type LengthOption,
  type ToneOption,
  type WritingStyle,
} from "@/lib/voicewrite/types";

// Voicewrite's standalone Header/Footer/InstallPrompt aren't ported — Campus
// OS's AppShell already provides page chrome, and PWA installability isn't
// part of this integration (see src/app/voicewrite/page.tsx for the brief
// privacy note that replaces Footer's disclosure).
export function StudioApp() {
  return (
    <ToastProvider>
      <Studio />
    </ToastProvider>
  );
}

function Studio() {
  const { showToast } = useToast();

  const styles = useSyncExternalStore(
    stylesStore.subscribe,
    stylesStore.getSnapshot,
    stylesStore.getServerSnapshot
  );
  const selectedStyleId = useSyncExternalStore(
    selectedStyleIdStore.subscribe,
    selectedStyleIdStore.getSnapshot,
    selectedStyleIdStore.getServerSnapshot
  );
  const [isManagerOpen, setIsManagerOpen] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState<ToneOption>("natural");
  const [length, setLength] = useState<LengthOption>("medium");
  const [audience, setAudience] = useState(DEFAULT_AUDIENCE);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState("");
  const [generationVersion, setGenerationVersion] = useState(0);
  const [generateError, setGenerateError] = useState<string | null>(null);

  function applyGeneratedHtml(html: string) {
    setGeneratedHtml(html);
    setGenerationVersion((v) => v + 1);
  }

  function persistStyles(next: WritingStyle[]) {
    const result = stylesStore.set(next);
    if (!result.ok && result.error) {
      showToast(result.error, "error");
    }
  }

  function handleSelectStyle(id: string) {
    selectedStyleIdStore.set(id);
  }

  function handleAddStyle(name: string, sample: string) {
    const { styles: next, style } = createStyle(styles, name, sample);
    persistStyles(next);
    selectedStyleIdStore.set(style.id);
    showToast("Style saved.", "success");
  }

  function handleUpdateStyle(id: string, name: string, sample: string) {
    persistStyles(updateStyle(styles, id, name, sample));
    showToast("Style updated.", "success");
  }

  function handleDeleteStyle(id: string) {
    persistStyles(removeStyle(styles, id));
    if (selectedStyleId === id) {
      selectedStyleIdStore.set(DEFAULT_STYLE_ID);
    }
    showToast("Style deleted.", "success");
  }

  const canGenerate = prompt.trim().length > 0 && !isGenerating;

  async function handleGenerate() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setGenerateError("Tell us what you'd like to write before generating.");
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const selectedStyle = styles.find((s) => s.id === selectedStyleId);
      const res = await fetch("/api/voicewrite-generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          tone,
          length,
          audience: audience.trim() || DEFAULT_AUDIENCE,
          styleSample: selectedStyle?.sample,
        }),
      });

      let data: GenerateResponseBody | ApiErrorBody;
      try {
        data = await res.json();
      } catch {
        throw new Error("The server sent back something unexpected. Please try again.");
      }

      if (!res.ok) {
        throw new Error((data as ApiErrorBody).error || "Something went wrong. Please try again.");
      }

      applyGeneratedHtml(markdownToSafeHtml((data as GenerateResponseBody).text));
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "Couldn't reach the server. Check your internet connection and try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.";
      setGenerateError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <section className="flex flex-col gap-5 rounded-xl2 border border-border-soft bg-surface p-4 shadow-card sm:p-6">
        <StyleSelect
          styles={styles}
          selectedStyleId={selectedStyleId}
          onChange={handleSelectStyle}
          onManageClick={() => setIsManagerOpen(true)}
        />

        <GeneratorPanel
          prompt={prompt}
          onPromptChange={setPrompt}
          tone={tone}
          onToneChange={setTone}
          length={length}
          onLengthChange={setLength}
          audience={audience}
          onAudienceChange={setAudience}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          errorMessage={generateError}
        />
      </section>

      <section className="rounded-xl2 border border-border-soft bg-surface p-4 shadow-card sm:p-6">
        <OutputEditor
          generatedHtml={generatedHtml}
          generationVersion={generationVersion}
          isGenerating={isGenerating}
          canRegenerate={canGenerate || isGenerating}
          onRegenerate={handleGenerate}
          onClear={() => applyGeneratedHtml("")}
        />
      </section>

      <StyleManagerModal
        open={isManagerOpen}
        onClose={() => setIsManagerOpen(false)}
        styles={styles}
        selectedStyleId={selectedStyleId}
        onSelect={handleSelectStyle}
        onAdd={handleAddStyle}
        onUpdate={handleUpdateStyle}
        onDelete={handleDeleteStyle}
      />
    </div>
  );
}
