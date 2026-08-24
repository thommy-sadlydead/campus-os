import { STORAGE_KEYS } from "./constants";
import { createLocalStorageStore } from "./external-store";
import { DEFAULT_STYLE_ID } from "./types";
import type { WritingStyle } from "./types";

export interface StorageResult {
  ok: boolean;
  error?: string;
}

function isWritingStyle(value: unknown): value is WritingStyle {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.sample === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

function parseStyles(raw: string | null): WritingStyle[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isWritingStyle) : [];
  } catch {
    return [];
  }
}

export const stylesStore = createLocalStorageStore<WritingStyle[]>(
  STORAGE_KEYS.styles,
  parseStyles,
  (styles) => JSON.stringify(styles),
  []
);

export const selectedStyleIdStore = createLocalStorageStore<string>(
  STORAGE_KEYS.selectedStyleId,
  (raw) => raw ?? DEFAULT_STYLE_ID,
  (id) => id,
  DEFAULT_STYLE_ID
);

export const installPromptDismissedStore = createLocalStorageStore<boolean>(
  STORAGE_KEYS.installPromptDismissed,
  (raw) => raw === "1",
  (dismissed) => (dismissed ? "1" : "0"),
  false
);

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `style-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createStyle(
  existing: WritingStyle[],
  name: string,
  sample: string
): { styles: WritingStyle[]; style: WritingStyle } {
  const now = new Date().toISOString();
  const style: WritingStyle = {
    id: newId(),
    name: name.trim(),
    sample: sample.trim(),
    createdAt: now,
    updatedAt: now,
  };
  return { styles: [...existing, style], style };
}

export function updateStyle(
  existing: WritingStyle[],
  id: string,
  name: string,
  sample: string
): WritingStyle[] {
  const now = new Date().toISOString();
  return existing.map((s) =>
    s.id === id
      ? { ...s, name: name.trim(), sample: sample.trim(), updatedAt: now }
      : s
  );
}

export function removeStyle(existing: WritingStyle[], id: string): WritingStyle[] {
  return existing.filter((s) => s.id !== id);
}
