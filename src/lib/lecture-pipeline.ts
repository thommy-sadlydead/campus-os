import "server-only";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { deleteAssemblyAITranscripts, getAssemblyAIClient } from "@/lib/assemblyai";
import { getAnthropicClient, askClaudeForJson, MODEL } from "@/lib/anthropic";
import { MATERIALS_WITH_TEXT } from "@/lib/class-context";
import { addLectureToNotes } from "@/lib/lecture-notes-sync";
import { buildLectureNotesPrompt, MAX_MATERIALS_CHARS, type ClassMaterialInput } from "@/lib/lecture-notes";

// The lecture pipeline (UPLOADED -> TRANSCRIBING -> GENERATING_NOTES ->
// READY/FAILED), shared by the Lectures tab's Server Actions and the
// AssemblyAI webhook. Lives outside the "use server" file on purpose:
// every export there is a public endpoint, and nothing here checks who's
// asking.
//
// Two things can move a lecture forward: AssemblyAI calling
// /api/lecture-audio/transcribed when a transcript finishes (production,
// so notes get written even with the app closed), and the Lectures tab
// polling while it's open. Both go through advanceLecture, which claims
// each step with a conditional update so the notes are only written once.

// Shown on the lecture. The missing keys are ASSEMBLYAI_API_KEY and
// ANTHROPIC_API_KEY (see .env.example); students don't need those names.
export const NOT_CONFIGURED = {
  assemblyai: "Transcription isn't set up on this site yet.",
  anthropic: "Note writing isn't set up on this site yet.",
};

// Note generation times out after 4 minutes and runs inside a function
// capped at 5, so a lecture stuck in GENERATING_NOTES longer than this lost
// its run (the function was killed) and it's safe to start another.
const STALE_GENERATION_MS = 6 * 60 * 1000;

const WEBHOOK_HEADER = "x-campus-os-webhook";

function webhookSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return crypto.createHmac("sha256", secret).update("assemblyai-transcript-webhook").digest("hex");
}

/**
 * Only production has a public URL AssemblyAI can reach (preview
 * deployments sit behind Vercel's login, and `next dev` isn't reachable at
 * all). Everywhere else the Lectures tab's polling does the work.
 */
function transcriptionWebhook(): { webhook_url: string; webhook_auth_header_name: string; webhook_auth_header_value: string } | null {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV !== "production" || !host) return null;
  return {
    webhook_url: `https://${host}/api/lecture-audio/transcribed`,
    webhook_auth_header_name: WEBHOOK_HEADER,
    webhook_auth_header_value: webhookSecret(),
  };
}

export function isAuthorizedTranscriptionWebhook(headers: Headers): boolean {
  const sent = headers.get(WEBHOOK_HEADER) ?? "";
  const expected = webhookSecret();
  return sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
}

/** Sends a lecture's audio to AssemblyAI and marks it TRANSCRIBING (or FAILED with a reason). */
export async function submitTranscription(lectureId: string, audioUrl: string): Promise<void> {
  const assemblyai = getAssemblyAIClient();
  if (!assemblyai) {
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "FAILED", errorMessage: NOT_CONFIGURED.assemblyai },
    });
    return;
  }
  try {
    const transcript = await assemblyai.transcripts.submit({ audio_url: audioUrl, ...transcriptionWebhook() });
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "TRANSCRIBING", assemblyaiId: transcript.id, errorMessage: null },
    });
  } catch (err) {
    console.error("Lecture transcription submit failed:", err);
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "FAILED", errorMessage: "Couldn't send the audio for transcription. Please try again." },
    });
  }
}

/**
 * Moves one lecture forward by one step, if it can go anywhere. Safe to call
 * repeatedly and from several places at once.
 */
export async function advanceLecture(lectureId: string): Promise<void> {
  const lecture = await prisma.lecture.findUnique({ where: { id: lectureId } });
  if (!lecture) return;

  if (lecture.status === "TRANSCRIBING" && lecture.assemblyaiId) {
    const assemblyai = getAssemblyAIClient();
    if (!assemblyai) {
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "FAILED", errorMessage: NOT_CONFIGURED.assemblyai },
      });
      return;
    }

    let transcript;
    try {
      transcript = await assemblyai.transcripts.get(lecture.assemblyaiId);
    } catch (err) {
      // Transient (network blip, rate limit): try again on the next call.
      console.error("Lecture transcript check failed:", err);
      return;
    }

    if (transcript.status === "error") {
      await prisma.lecture.updateMany({
        where: { id: lecture.id, status: "TRANSCRIBING" },
        data: { status: "FAILED", errorMessage: transcript.error || "Transcription failed." },
      });
    } else if (transcript.status === "completed") {
      const transcriptText = transcript.text || "";
      const claimed = await prisma.lecture.updateMany({
        where: { id: lecture.id, status: "TRANSCRIBING" },
        data: { status: "GENERATING_NOTES", transcriptText, updatedAt: new Date() },
      });
      if (claimed.count === 0) return; // the webhook or another poll got here first
      // The row now holds the transcript, which is all note generation and
      // retries ever read, so AssemblyAI's copy can go.
      await deleteAssemblyAITranscripts([lecture.assemblyaiId]);
      await generateNotes(lecture.id, transcriptText, lecture.classId);
    }
    // "queued" / "processing": nothing to do yet.
    return;
  }

  if (lecture.status === "GENERATING_NOTES") {
    const claimed = await prisma.lecture.updateMany({
      where: { id: lecture.id, status: "GENERATING_NOTES", updatedAt: { lt: new Date(Date.now() - STALE_GENERATION_MS) } },
      data: { updatedAt: new Date() },
    });
    if (claimed.count === 0) return; // still being written by the run that started it
    await generateNotes(lecture.id, lecture.transcriptText || "", lecture.classId);
  }
}

const MATERIAL_MATCH_SYSTEM = [
  "You match a class lecture to the reference materials (textbook slides/excerpts) that actually cover its specific topic.",
  "A class can have many materials covering many different chapters/topics — most are irrelevant to any single lecture.",
  "Return ONLY a JSON array of exact material titles (copied verbatim from the list) that are directly relevant to THIS lecture's specific topic.",
  "Prefer precision over recall: only include a title if you're confident it covers the same chapter/topic as the lecture. Return an empty array if nothing clearly matches — that's a normal, correct answer when the class doesn't have material for this lecture's topic yet.",
].join(" ");

// How much of the transcript to show the matching step. Lectures usually
// establish their topic well before this point, and this is a
// classification-style call (small output either way) so it doesn't need
// the full transcript — keeping it well under MAX_TRANSCRIPT_CHARS keeps
// this extra step fast and cheap.
const MATERIAL_MATCH_TRANSCRIPT_CHARS = 30_000;

/**
 * When a class has more material than fits in one prompt (see
 * MAX_MATERIALS_CHARS), formatMaterialsForPrompt's combined-budget slice
 * ends up using whichever materials were added earliest, in full, for
 * every lecture in the class regardless of topic — e.g. a class with a
 * full semester of slides would show every lecture the same first couple
 * of chapters. Below the budget, nothing needs to change: every material
 * already reaches every lecture's prompt as-is. Above it, ask the model
 * which materials actually match this lecture's topic and use only those,
 * so a lecture on chapter 9 gets chapter 9's slides instead of chapter 1's
 * because chapter 1 happened to be added first. Falls back to the full
 * list (and its existing slice-based truncation) if matching itself fails
 * for any reason — this is a refinement, not something that should ever
 * block note generation.
 */
async function selectRelevantMaterials(
  transcriptText: string,
  materials: ClassMaterialInput[]
): Promise<ClassMaterialInput[]> {
  if (materials.length === 0) return materials;
  const combinedLength = materials.reduce((sum, m) => sum + m.content.length, 0);
  if (combinedLength <= MAX_MATERIALS_CHARS) return materials;

  const titleList = materials.map((m) => m.title).join("\n");
  const prompt = [
    `Lecture transcript (excerpt):\n${transcriptText.slice(0, MATERIAL_MATCH_TRANSCRIPT_CHARS)}`,
    `Available material titles:\n${titleList}`,
    "Which titles are directly relevant to this lecture's specific topic?",
  ].join("\n\n");

  const matchedTitles = await askClaudeForJson<string[]>({
    system: MATERIAL_MATCH_SYSTEM,
    prompt,
    maxTokens: 1024,
  });

  if (!Array.isArray(matchedTitles)) return materials; // matching failed — fall back to the existing behavior

  return materials.filter((m) => matchedTitles.includes(m.title));
}

/**
 * Runs the note-generation step and saves the result. Like Voicewrite's
 * /api/voicewrite-generate, this calls the Anthropic SDK directly rather than
 * through askClaude() — askClaude() collapses every failure into a silent
 * null for features that have a deterministic fallback, but note generation
 * IS the feature here, so failures need to surface as a real FAILED status
 * with a real message instead.
 *
 * Pulls in the class's materials (books/slides — see ClassMaterial) as
 * extra context every time, so they inform every lecture in the class
 * without needing to be re-attached per lecture.
 */
export async function generateNotes(lectureId: string, transcriptText: string, classId: string) {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "FAILED", errorMessage: NOT_CONFIGURED.anthropic },
    });
    return;
  }

  const allMaterials = await prisma.classMaterial.findMany({
    where: { classId, ...MATERIALS_WITH_TEXT },
    orderBy: { createdAt: "asc" },
  });
  const materials = await selectRelevantMaterials(transcriptText, allMaterials);
  const { system, prompt } = buildLectureNotesPrompt(transcriptText, materials);
  try {
    // 2000 was cutting notes off partway through anything longer than a
    // few minutes of real lecture content (verified: real lecture notes
    // were landing suspiciously uniformly around ~2000 tokens' worth,
    // regardless of transcript length — a tell that generation was
    // hitting the ceiling, not finishing naturally). 8192 matches the
    // budget proven to let a comparably-sized request complete on its own
    // (see askClassAssistantAction). The timeout is raised to match — more
    // output tokens means generation can legitimately take longer, and
    // this needs to stay under the route's maxDuration (see page.tsx).
    const message = await anthropic.messages.create(
      { model: MODEL, max_tokens: 8192, system, messages: [{ role: "user", content: prompt }] },
      { timeout: 240_000 }
    );
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      await prisma.lecture.update({
        where: { id: lectureId },
        data: { status: "FAILED", errorMessage: "Note generation returned an empty response. Please try again." },
      });
      return;
    }
    await prisma.lecture.update({ where: { id: lectureId }, data: { status: "READY", notesMarkdown: text } });
    // Same notes, also in the Notes tab (see src/lib/lecture-notes-sync.ts).
    // A failure here doesn't fail the lecture: the notes are saved above,
    // and the class page adds any missing Notes-tab copy when it loads.
    try {
      await addLectureToNotes(lectureId);
    } catch (err) {
      console.error("Copying lecture notes into the Notes tab failed:", err);
    }
  } catch (err) {
    console.error("Lecture note generation failed:", err);
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "FAILED", errorMessage: "Note generation failed. Please try again." },
    });
  }
}
