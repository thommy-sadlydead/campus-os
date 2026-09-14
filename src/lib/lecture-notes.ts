// Pure helpers for the Lectures tab (audio upload -> AssemblyAI transcript ->
// Claude-generated notes). Kept free of "server-only" imports so these stay
// unit-testable the same way the rest of src/lib's pure logic is (see
// tests/lecture-notes.test.ts) — the actual AssemblyAI/Anthropic calls live
// in src/lib/assemblyai.ts and src/app/classes/[id]/lecture-actions.ts.

// String, not a Prisma enum — see the note above Assignment.status in
// schema.prisma. Mirrors Lecture.status.
export type LectureStatus = "UPLOADED" | "TRANSCRIBING" | "GENERATING_NOTES" | "READY" | "FAILED";

export const ALLOWED_AUDIO_CONTENT_TYPES = ["audio/*"];

// Generous cap for a long lecture recording (a 3-hour lecture at a typical
// voice-memo bitrate lands well under this) — not a real-world limit, just a
// backstop against something absurd being uploaded.
export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

export function isAllowedAudioType(contentType: string): boolean {
  return contentType.startsWith("audio/");
}

const STATUS_LABELS: Record<LectureStatus, string> = {
  UPLOADED: "Uploaded",
  TRANSCRIBING: "Transcribing…",
  GENERATING_NOTES: "Generating notes…",
  READY: "Ready",
  FAILED: "Failed",
};

export function lectureStatusLabel(status: string): string {
  return STATUS_LABELS[status as LectureStatus] ?? status;
}

// A lecture is still being worked on (transcription or note generation in
// flight) if it's in one of these statuses — the panel polls while any
// lecture is in one of them.
export function isLectureInProgress(status: string): boolean {
  return status === "UPLOADED" || status === "TRANSCRIBING" || status === "GENERATING_NOTES";
}

/**
 * Joins text blocks up to a combined character budget, including whole
 * items in order and stopping before the first one that would push the
 * total over — rather than joining everything and slicing the combined
 * string, which can cut the last included item off mid-sentence. Used
 * where every included item should be complete (e.g. the class
 * assistant's lecture notes / materials context), unlike
 * formatMaterialsForPrompt below, which deliberately allows a partial
 * tail so a single oversized item still contributes something instead of
 * being dropped entirely.
 */
export function joinWithBudget(items: string[], maxChars: number, separator = "\n\n"): string {
  const included: string[] = [];
  let total = 0;
  for (const item of items) {
    if (total + item.length > maxChars) break;
    included.push(item);
    total += item.length + separator.length;
  }
  return included.join(separator);
}

// String, not a Prisma enum — see the note above Assignment.status in
// schema.prisma. Mirrors ClassMaterial.type.
export type ClassMaterialType = "BOOK" | "SLIDES";

export const MAX_MATERIAL_TITLE_LENGTH = 160;
export const MAX_MATERIAL_CONTENT_LENGTH = 20_000;

const MATERIAL_TYPE_LABELS: Record<ClassMaterialType, string> = {
  BOOK: "Book",
  SLIDES: "Slides",
};

export function classMaterialTypeLabel(type: string): string {
  return MATERIAL_TYPE_LABELS[type as ClassMaterialType] ?? type;
}

export interface ClassMaterialInput {
  type: string;
  title: string;
  content: string;
}

// Comfortably covers a multi-hour lecture (~100k chars is roughly a 2.5-3
// hour transcript) while keeping a hard ceiling on the note-generation
// request. Trimmed from the end, not the start, since a lecture's opening
// (agenda, topic intro) tends to matter more for orienting notes than its
// closing minutes.
const MAX_TRANSCRIPT_CHARS = 100_000;

// Separate, smaller budget for combined class materials — these accumulate
// across every book/slide entry added to the class, not just one lecture,
// so the cap has to be tighter than the transcript's to keep the total
// prompt reasonable.
const MAX_MATERIALS_CHARS = 40_000;

function formatMaterialsForPrompt(materials: ClassMaterialInput[]): string | null {
  if (materials.length === 0) return null;

  const blocks = materials.map(
    (m) => `[${classMaterialTypeLabel(m.type)}: ${m.title}]\n${m.content}`
  );
  const joined = blocks.join("\n\n");
  return joined.length > MAX_MATERIALS_CHARS ? joined.slice(0, MAX_MATERIALS_CHARS) : joined;
}

export function buildLectureNotesPrompt(
  transcriptText: string,
  materials: ClassMaterialInput[] = []
): { system: string; prompt: string } {
  const truncated = transcriptText.length > MAX_TRANSCRIPT_CHARS;
  const text = truncated ? transcriptText.slice(0, MAX_TRANSCRIPT_CHARS) : transcriptText;
  const materialsText = formatMaterialsForPrompt(materials);

  const system = [
    "You turn raw lecture transcripts into clear, well-organized study notes for a student.",
    "Structure the notes with markdown headings for topics/sections in the order they came up, using bullet points for key facts, definitions, and examples. Bold key terms.",
    "Only include material that's actually in the transcript — never invent facts, dates, or examples that aren't there.",
    "Transcripts sometimes have misheard words or filler ('um', 'you know') — clean those up, but don't editorialize or add commentary of your own.",
    materialsText &&
      "Reference material for this class (textbook excerpts, slides) is also provided below. Use it only to inform terminology, structure, and depth, and to correct clear transcription errors (e.g. a misheard term the reference material spells correctly) — never to add content, examples, or claims the transcript doesn't actually cover.",
    "Respond with ONLY the markdown notes — no preamble like \"Here are your notes\".",
  ]
    .filter(Boolean)
    .join(" ");

  const promptParts = [
    truncated
      ? "The following is the first part of a lecture transcript (it was cut off for length):"
      : "The following is a full lecture transcript:",
    "",
    text,
  ];

  if (materialsText) {
    promptParts.push("", "---", "", "Reference material for this class:", "", materialsText);
  }

  return { system, prompt: promptParts.join("\n") };
}
