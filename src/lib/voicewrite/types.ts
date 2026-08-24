export type ToneOption =
  | "natural"
  | "casual"
  | "professional"
  | "academic"
  | "friendly"
  | "persuasive";

export type LengthOption = "short" | "medium" | "long";

export interface WritingStyle {
  id: string;
  name: string;
  sample: string;
  createdAt: string;
  updatedAt: string;
}

/** The special, always-available style that needs no saved sample. */
export const DEFAULT_STYLE_ID = "default" as const;
export type SelectedStyleId = typeof DEFAULT_STYLE_ID | string;

export interface GenerateRequestBody {
  prompt: string;
  tone: ToneOption;
  length: LengthOption;
  audience: string;
  styleSample?: string;
}

export interface GenerateResponseBody {
  text: string;
}

export interface ApiErrorBody {
  error: string;
}
