import type { LengthOption, ToneOption } from "./types";

export const APP_NAME = "Voicewrite";
export const APP_TAGLINE = "Write like you.";

export const STORAGE_KEYS = {
  styles: "voicewrite.styles.v1",
  selectedStyleId: "voicewrite.selectedStyleId.v1",
  installPromptDismissed: "voicewrite.installPromptDismissed.v1",
} as const;

export const MAX_SAMPLE_LENGTH = 20000;
export const MAX_PROMPT_LENGTH = 4000;
export const MAX_AUDIENCE_LENGTH = 200;
export const MAX_STYLE_NAME_LENGTH = 60;

export const TONE_OPTIONS: { value: ToneOption; label: string }[] = [
  { value: "natural", label: "Natural" },
  { value: "casual", label: "Casual" },
  { value: "professional", label: "Professional" },
  { value: "academic", label: "Academic" },
  { value: "friendly", label: "Friendly" },
  { value: "persuasive", label: "Persuasive" },
];

export const LENGTH_OPTIONS: {
  value: LengthOption;
  label: string;
  hint: string;
}[] = [
  { value: "short", label: "Short", hint: "~75-125 words" },
  { value: "medium", label: "Medium", hint: "~200-350 words" },
  { value: "long", label: "Long", hint: "~450-700 words" },
];

export const DEFAULT_AUDIENCE = "General audience";

export const AUDIENCE_SUGGESTIONS = [
  "General audience",
  "Teacher or professor",
  "Manager or employer",
  "Friends or family",
  "Clients or customers",
  "Social media followers",
];

export const SAMPLE_TEXTAREA_PLACEHOLDER =
  "Paste a paragraph or two of your own writing here. The more representative it is of how you normally write, the better.";

export const PROMPT_PLACEHOLDER = "Tell me what you want to write about…";
