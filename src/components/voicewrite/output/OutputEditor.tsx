"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/voicewrite/ui/Button";
import { Spinner } from "@/components/voicewrite/ui/Spinner";
import { ConfirmDialog } from "@/components/voicewrite/ui/ConfirmDialog";
import { useToast } from "@/components/voicewrite/ui/Toast";
import { htmlToPlainText } from "@/lib/voicewrite/markdown";
import { copyGeneratedText } from "@/lib/voicewrite/clipboard";
import { analyzeNaturalness, type NaturalnessCheck } from "@/lib/voicewrite/naturalness";
import { NaturalnessCheckPanel } from "./NaturalnessCheckPanel";

interface OutputEditorProps {
  generatedHtml: string;
  /**
   * Increments on every generate/clear, even ones that happen to produce
   * the same HTML string as before (e.g. a regenerate that lands on
   * identical text). The sync effect keys off this instead of
   * generatedHtml alone so React's same-value state bailout can't leave a
   * stale, user-edited DOM in place after a confirmed regenerate/clear.
   */
  generationVersion: number;
  isGenerating: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onClear: () => void;
}

export function OutputEditor({
  generatedHtml,
  generationVersion,
  isGenerating,
  canRegenerate,
  onRegenerate,
  onClear,
}: OutputEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"regenerate" | "clear" | null>(null);
  const [naturalness, setNaturalness] = useState<NaturalnessCheck | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = generatedHtml;
    baselineRef.current = generatedHtml;
    setHasContent(!!editorRef.current.textContent?.trim());
    setNaturalness(analyzeNaturalness(editorRef.current.innerText));
    // generationVersion guarantees this runs on every generate/clear (see
    // prop doc comment); generatedHtml is listed too since the effect reads it.
  }, [generationVersion, generatedHtml]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleInput() {
    setHasContent(!!editorRef.current?.textContent?.trim());
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setNaturalness(editorRef.current ? analyzeNaturalness(editorRef.current.innerText) : null);
    }, 500);
  }

  function isDirty(): boolean {
    return !!editorRef.current && editorRef.current.innerHTML !== baselineRef.current;
  }

  function requestRegenerate() {
    if (hasContent && isDirty()) {
      setConfirmAction("regenerate");
    } else {
      onRegenerate();
    }
  }

  function requestClear() {
    if (hasContent) {
      setConfirmAction("clear");
    } else {
      onClear();
    }
  }

  async function handleCopy() {
    if (!editorRef.current) return;
    const plain = htmlToPlainText(editorRef.current);
    if (!plain) return;
    try {
      await copyGeneratedText(plain, editorRef.current.innerHTML);
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 2000);
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : "Couldn't copy automatically. Select the text and press Ctrl/Cmd+C.",
        "error"
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Generated Writing</h2>
        <span className="text-xs text-ink-faint">Times New Roman · editable</span>
      </div>

      <div className="relative">
        <div
          ref={editorRef}
          contentEditable={!isGenerating}
          suppressContentEditableWarning
          onInput={handleInput}
          data-placeholder="Your generated writing will appear here. You'll be able to edit it before copying."
          aria-label="Generated writing, editable"
          className={`editor-prose min-h-[280px] w-full rounded-xl border border-border bg-surface px-5 py-4 font-editor text-[17px] leading-[1.8] text-ink outline-none transition-opacity focus:border-accent focus:ring-2 focus:ring-accent/30 sm:min-h-[360px] ${
            isGenerating ? "opacity-40" : ""
          }`}
        />
        {isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface/30">
            <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 shadow-md">
              <Spinner className="h-4 w-4 text-accent" />
              <span className="text-sm font-medium text-ink">Generating…</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={handleCopy}
          disabled={!hasContent || isGenerating}
        >
          {justCopied ? (
            <>
              <CheckIcon /> Copied!
            </>
          ) : (
            "Copy Text"
          )}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={requestRegenerate}
          disabled={!canRegenerate || isGenerating}
        >
          Regenerate
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={requestClear}
          disabled={!hasContent || isGenerating}
        >
          Clear
        </Button>
      </div>

      {!isGenerating && <NaturalnessCheckPanel data={naturalness} />}

      <ConfirmDialog
        open={confirmAction === "regenerate"}
        title="Regenerate writing?"
        message="You've made edits to this text. Regenerating will replace it with a new version, and your edits will be lost."
        confirmLabel="Regenerate"
        danger
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          setConfirmAction(null);
          onRegenerate();
        }}
      />
      <ConfirmDialog
        open={confirmAction === "clear"}
        title="Clear generated writing?"
        message="This will remove the text from the editor. This can't be undone."
        confirmLabel="Clear"
        danger
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          setConfirmAction(null);
          onClear();
        }}
      />
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
