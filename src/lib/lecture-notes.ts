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

// Comfortably covers a multi-hour lecture (~100k chars is roughly a 2.5-3
// hour transcript) while keeping a hard ceiling on the note-generation
// request. Trimmed from the end, not the start, since a lecture's opening
// (agenda, topic intro) tends to matter more for orienting notes than its
// closing minutes.
const MAX_TRANSCRIPT_CHARS = 100_000;

export function buildLectureNotesPrompt(transcriptText: string): { system: string; prompt: string } {
  const truncated = transcriptText.length > MAX_TRANSCRIPT_CHARS;
  const text = truncated ? transcriptText.slice(0, MAX_TRANSCRIPT_CHARS) : transcriptText;

  const system = [
    "You turn raw lecture transcripts into clear, well-organized study notes for a student.",
    "Structure the notes with markdown headings for topics/sections in the order they came up, using bullet points for key facts, definitions, and examples. Bold key terms.",
    "Only include material that's actually in the transcript — never invent facts, dates, or examples that aren't there.",
    "Transcripts sometimes have misheard words or filler ('um', 'you know') — clean those up, but don't editorialize or add commentary of your own.",
    "Respond with ONLY the markdown notes — no preamble like \"Here are your notes\".",
  ].join(" ");

  const prompt = [
    truncated
      ? "The following is the first part of a lecture transcript (it was cut off for length):"
      : "The following is a full lecture transcript:",
    "",
    text,
  ].join("\n");

  return { system, prompt };
}
