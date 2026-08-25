"use server";

import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getAssemblyAIClient } from "@/lib/assemblyai";
import { getAnthropicClient, MODEL } from "@/lib/anthropic";
import { buildLectureNotesPrompt } from "@/lib/lecture-notes";

async function requireOwnedClass(classId: string, userId: string) {
  const cls = await prisma.class.findUnique({ where: { id: classId } });
  if (!cls || cls.userId !== userId) throw new Error("Not found.");
  return cls;
}

async function requireOwnedLecture(lectureId: string, userId: string) {
  const lecture = await prisma.lecture.findUnique({ where: { id: lectureId }, include: { class: true } });
  if (!lecture || lecture.class.userId !== userId) throw new Error("Not found.");
  return lecture;
}

const NOT_CONFIGURED = {
  assemblyai: "Transcription isn't configured yet. Add an ASSEMBLYAI_API_KEY to enable it.",
  anthropic: "Note generation isn't configured yet. Add an ANTHROPIC_API_KEY to enable it.",
};

/**
 * Runs the note-generation step and saves the result. Like Voicewrite's
 * /api/voicewrite-generate, this calls the Anthropic SDK directly rather than
 * through askClaude() — askClaude() collapses every failure into a silent
 * null for features that have a deterministic fallback, but note generation
 * IS the feature here, so failures need to surface as a real FAILED status
 * with a real message instead.
 */
async function generateNotes(lectureId: string, transcriptText: string) {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "FAILED", errorMessage: NOT_CONFIGURED.anthropic },
    });
    return;
  }

  const { system, prompt } = buildLectureNotesPrompt(transcriptText);
  try {
    const message = await anthropic.messages.create(
      { model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: prompt }] },
      { timeout: 60_000 }
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
  } catch (err) {
    console.error("Lecture note generation failed:", err);
    await prisma.lecture.update({
      where: { id: lectureId },
      data: { status: "FAILED", errorMessage: "Note generation failed. Please try again." },
    });
  }
}

const createLectureSchema = z.object({
  title: z.string().min(1).max(160),
  audioUrl: z.string().url(),
});

/**
 * Called by the client right after its direct-to-Blob upload resolves (see
 * src/app/api/lecture-audio/upload/route.ts) — NOT from Vercel Blob's
 * onUploadCompleted webhook, which needs a publicly reachable callback URL
 * that `next dev` doesn't have. Creates the row, then submits the
 * transcription job immediately so the panel can start polling right away.
 */
export async function createLectureAction(classId: string, input: { title: string; audioUrl: string }) {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);
  const parsed = createLectureSchema.parse(input);

  const lecture = await prisma.lecture.create({
    data: { classId, title: parsed.title, audioUrl: parsed.audioUrl, status: "UPLOADED" },
  });

  const assemblyai = getAssemblyAIClient();
  if (!assemblyai) {
    await prisma.lecture.update({
      where: { id: lecture.id },
      data: { status: "FAILED", errorMessage: NOT_CONFIGURED.assemblyai },
    });
  } else {
    try {
      const transcript = await assemblyai.transcripts.submit({ audio_url: parsed.audioUrl });
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "TRANSCRIBING", assemblyaiId: transcript.id },
      });
    } catch (err) {
      console.error("Lecture transcription submit failed:", err);
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "FAILED", errorMessage: "Couldn't submit the audio for transcription. Please try again." },
      });
    }
  }

  revalidatePath(`/classes/${classId}`);
}

/**
 * Advances one lecture by one step: checks AssemblyAI if a transcript is in
 * flight, and kicks off note generation the moment it completes. The client
 * calls this on an interval for every non-terminal lecture (see
 * LecturesPanel) — there's no background worker, so polling IS how state
 * advances, same as the "async submit/poll" architecture AssemblyAI expects.
 */
export async function pollLectureStatusAction(lectureId: string) {
  const user = await requireUser();
  const lecture = await requireOwnedLecture(lectureId, user.id);

  if (lecture.status === "TRANSCRIBING" && lecture.assemblyaiId) {
    const assemblyai = getAssemblyAIClient();
    if (!assemblyai) {
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "FAILED", errorMessage: NOT_CONFIGURED.assemblyai },
      });
      revalidatePath(`/classes/${lecture.classId}`);
      return;
    }

    let transcript;
    try {
      transcript = await assemblyai.transcripts.get(lecture.assemblyaiId);
    } catch (err) {
      // Transient (network blip, rate limit) — leave status alone and let
      // the next poll tick try again instead of failing the lecture outright.
      console.error("Lecture transcript poll failed:", err);
      revalidatePath(`/classes/${lecture.classId}`);
      return;
    }

    if (transcript.status === "error") {
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "FAILED", errorMessage: transcript.error || "Transcription failed." },
      });
    } else if (transcript.status === "completed") {
      const transcriptText = transcript.text || "";
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "GENERATING_NOTES", transcriptText },
      });
      await generateNotes(lecture.id, transcriptText);
    }
    // "queued" / "processing": no-op, poll again later.
  } else if (lecture.status === "GENERATING_NOTES") {
    // A previous poll started note generation but the row never advanced
    // (e.g. the serverless function was killed mid-request) — retry from
    // the transcript already saved on the row.
    await generateNotes(lecture.id, lecture.transcriptText || "");
  }

  revalidatePath(`/classes/${lecture.classId}`);
}

export async function retryLectureAction(lectureId: string) {
  const user = await requireUser();
  const lecture = await requireOwnedLecture(lectureId, user.id);
  if (lecture.status !== "FAILED") return;

  if (lecture.transcriptText) {
    // Already have a transcript — the failure was in note generation, retry just that.
    await prisma.lecture.update({ where: { id: lecture.id }, data: { status: "GENERATING_NOTES", errorMessage: null } });
    await generateNotes(lecture.id, lecture.transcriptText);
  } else {
    const assemblyai = getAssemblyAIClient();
    if (!assemblyai) {
      await prisma.lecture.update({ where: { id: lecture.id }, data: { errorMessage: NOT_CONFIGURED.assemblyai } });
      revalidatePath(`/classes/${lecture.classId}`);
      return;
    }
    try {
      const transcript = await assemblyai.transcripts.submit({ audio_url: lecture.audioUrl });
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { status: "TRANSCRIBING", assemblyaiId: transcript.id, errorMessage: null },
      });
    } catch (err) {
      console.error("Lecture retry submit failed:", err);
      await prisma.lecture.update({
        where: { id: lecture.id },
        data: { errorMessage: "Couldn't submit the audio for transcription. Please try again." },
      });
    }
  }
  revalidatePath(`/classes/${lecture.classId}`);
}

export async function deleteLectureAction(lectureId: string) {
  const user = await requireUser();
  const lecture = await requireOwnedLecture(lectureId, user.id);

  try {
    await del(lecture.audioUrl);
  } catch (err) {
    // Best-effort — don't block deleting the record if Blob cleanup fails.
    console.error("Lecture audio blob delete failed:", err);
  }

  await prisma.lecture.delete({ where: { id: lecture.id } });
  revalidatePath(`/classes/${lecture.classId}`);
}
