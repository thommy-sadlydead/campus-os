"use client";

import { useState } from "react";
import { Modal } from "@/components/voicewrite/ui/Modal";
import { Button } from "@/components/voicewrite/ui/Button";
import { ConfirmDialog } from "@/components/voicewrite/ui/ConfirmDialog";
import {
  MAX_SAMPLE_LENGTH,
  MAX_STYLE_NAME_LENGTH,
  SAMPLE_TEXTAREA_PLACEHOLDER,
} from "@/lib/voicewrite/constants";
import type { WritingStyle } from "@/lib/voicewrite/types";

interface StyleManagerModalProps {
  open: boolean;
  onClose: () => void;
  styles: WritingStyle[];
  selectedStyleId: string;
  onSelect: (id: string) => void;
  onAdd: (name: string, sample: string) => void;
  onUpdate: (id: string, name: string, sample: string) => void;
  onDelete: (id: string) => void;
}

type View = { mode: "list" } | { mode: "form"; editingId: string | null };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function preview(sample: string): string {
  const clean = sample.replace(/\s+/g, " ").trim();
  return clean.length > 130 ? `${clean.slice(0, 130)}…` : clean;
}

export function StyleManagerModal({
  open,
  onClose,
  styles,
  selectedStyleId,
  onSelect,
  onAdd,
  onUpdate,
  onDelete,
}: StyleManagerModalProps) {
  const [view, setView] = useState<View>({ mode: "list" });
  const [name, setName] = useState("");
  const [sample, setSample] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  function handleClose() {
    onClose();
    setView({ mode: "list" });
  }

  function startAdd() {
    setName("");
    setSample("");
    setView({ mode: "form", editingId: null });
  }

  function startEdit(style: WritingStyle) {
    setName(style.name);
    setSample(style.sample);
    setView({ mode: "form", editingId: style.id });
  }

  function handleSave() {
    const trimmedName = name.trim() || "Untitled style";
    const trimmedSample = sample.trim();
    if (!trimmedSample) return;

    if (view.mode === "form" && view.editingId) {
      onUpdate(view.editingId, trimmedName, trimmedSample);
    } else {
      onAdd(trimmedName, trimmedSample);
    }
    setView({ mode: "list" });
  }

  const sampleIsEmpty = sample.trim().length === 0;
  const styleToDelete = styles.find((s) => s.id === pendingDeleteId) ?? null;

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title="My Writing Styles"
        footer={
          view.mode === "list" ? (
            <Button variant="primary" onClick={startAdd}>
              <PlusIcon /> Add Writing Style
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setView({ mode: "list" })}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={sampleIsEmpty}>
                Save Style
              </Button>
            </>
          )
        }
      >
        {view.mode === "list" ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-ink-faint">
              Saved writing styles are stored locally on this device, not on
              our servers.
            </p>
            {styles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm text-ink-soft">
                  You haven&apos;t saved any writing styles yet. Add one, or
                  just use Default Natural Style — no setup required.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {styles.map((style) => (
                  <li
                    key={style.id}
                    className={`rounded-xl border px-4 py-3 ${
                      style.id === selectedStyleId
                        ? "border-accent bg-accent-soft"
                        : "border-border bg-surface"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-medium text-ink">
                            {style.name}
                          </h3>
                          {style.id === selectedStyleId && (
                            <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
                          {preview(style.sample)}
                        </p>
                        <p className="mt-1 text-xs text-ink-faint">
                          Updated {formatDate(style.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={style.id === selectedStyleId ? "secondary" : "primary"}
                        onClick={() => {
                          onSelect(style.id);
                          handleClose();
                        }}
                      >
                        {style.id === selectedStyleId ? "Selected" : "Select"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => startEdit(style)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setPendingDeleteId(style.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="style-name" className="mb-1.5 block text-sm font-medium">
                Style Name
              </label>
              <input
                id="style-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, MAX_STYLE_NAME_LENGTH))}
                placeholder="e.g. Casual, Professional, School Writing"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div>
              <label htmlFor="style-sample" className="mb-1.5 block text-sm font-medium">
                Writing Sample
              </label>
              <textarea
                id="style-sample"
                value={sample}
                onChange={(e) => setSample(e.target.value.slice(0, MAX_SAMPLE_LENGTH))}
                placeholder={SAMPLE_TEXTAREA_PLACEHOLDER}
                rows={12}
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-ink-faint">
                <span>
                  {sampleIsEmpty && "A writing sample is required to save a style."}
                </span>
                <span>
                  {sample.length}/{MAX_SAMPLE_LENGTH}
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!styleToDelete}
        title="Delete writing style?"
        message={
          styleToDelete
            ? `"${styleToDelete.name}" will be permanently removed from this device. This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) onDelete(pendingDeleteId);
          setPendingDeleteId(null);
        }}
      />
    </>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
