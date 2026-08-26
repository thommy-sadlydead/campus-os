"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadClassContext, classSystemPrompt } from "@/lib/class-context";
import { askClaude } from "@/lib/anthropic";
import { formatDueLabel } from "@/lib/time";

export interface ClassAssistantResult {
  answer: string;
  usedAi: boolean;
}

const QUICK_PROMPTS: Record<string, string> = {
  "summarize-notes": "Summarize my notes for this class in a few short paragraphs, organized by topic.",
  "study-guide": "Make a study guide from my notes and assignments for this class, organized by topic with the most important points first.",
  "quiz-me": "Quiz me on this class's material. Ask 5 questions one at a time based only on my notes, starting with the first one now.",
  "whats-missing": "Based on my notes, assignments, and exams, what am I likely missing or should double check? Be specific and only point out real gaps you can see in the data — don't guess at things not shown here.",
  "whats-due-next": "What is due next for this class?",
  "prepare-exam": "Help me prepare for my next exam in this class — what should I focus on, based on my notes and any exam info on file?",
};

async function requireOwnedClass(classId: string, userId: string) {
  const cls = await prisma.class.findUnique({ where: { id: classId } });
  if (!cls || cls.userId !== userId) throw new Error("Not found.");
  return cls;
}

/**
 * Deterministic answer for "what's due next" — doesn't need AI, and giving
 * it a real answer even without an API key matters (per the "AI features
 * are optional, never block the app" pattern used everywhere else).
 */
async function whatsDueNextDeterministic(classId: string, tz: string): Promise<string> {
  const now = new Date();
  const [nextAssignment, nextExam] = await Promise.all([
    prisma.assignment.findFirst({
      where: { classId, dueAt: { gte: now }, status: { notIn: ["SUBMITTED", "GRADED"] } },
      orderBy: { dueAt: "asc" },
    }),
    prisma.exam.findFirst({ where: { classId, examAt: { gte: now } }, orderBy: { examAt: "asc" } }),
  ]);

  const parts: string[] = [];
  parts.push(
    nextAssignment
      ? `Next assignment: "${nextAssignment.name}" — ${formatDueLabel(nextAssignment.dueAt, now, tz)}.`
      : "No upcoming assignments on file."
  );
  parts.push(
    nextExam ? `Next exam: "${nextExam.name}" — ${formatDueLabel(nextExam.examAt, now, tz)}.` : "No upcoming exams on file."
  );
  return parts.join(" ");
}

export async function askClassAssistantAction(
  classId: string,
  input: { quickAction?: string; question?: string }
): Promise<ClassAssistantResult> {
  const user = await requireUser();
  await requireOwnedClass(classId, user.id);

  const question = input.quickAction ? QUICK_PROMPTS[input.quickAction] : input.question?.trim();
  if (!question) {
    return { answer: "Ask a question or pick one of the quick actions.", usedAi: false };
  }

  // "What's due next?" is fully answerable from real data alone — always
  // compute it deterministically first so it's correct even without an
  // API key, then let the AI phrase it nicely if available.
  if (input.quickAction === "whats-due-next") {
    const deterministic = await whatsDueNextDeterministic(classId, user.timezone);
    return { answer: deterministic, usedAi: false };
  }

  const ctx = await loadClassContext(classId, user.id, user.timezone);
  const aiAnswer = await askClaude({
    system: classSystemPrompt(ctx),
    prompt: question,
    maxTokens: 700,
  });

  if (aiAnswer) {
    return { answer: aiAnswer, usedAi: true };
  }

  // No AI key configured (or the call failed) — never fabricate a summary
  // or quiz. Be honest, and hand back the real underlying data instead of
  // nothing, so the feature still returns something true and useful.
  if (!ctx.hasAnyContent) {
    return {
      answer:
        "AI features need an ANTHROPIC_API_KEY (see .env.example), and this class doesn't have any notes, assignments, exams, or resources on file yet to summarize even without one.",
      usedAi: false,
    };
  }
  return {
    answer: [
      "AI features need an ANTHROPIC_API_KEY to answer this directly — here's the raw data for this class instead:",
      "",
      "Notes:",
      ctx.notesText,
      "",
      "Assignments:",
      ctx.assignmentsText,
      "",
      "Exams:",
      ctx.examsText,
    ].join("\n"),
    usedAi: false,
  };
}
