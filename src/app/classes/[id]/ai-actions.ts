"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadClassContext, classSystemPrompt } from "@/lib/class-context";
import { askClaude, getAnthropicClient } from "@/lib/anthropic";
import { AI_LIMIT_MESSAGE, allowAiRequest } from "@/lib/rate-limit";
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

  if (!(await allowAiRequest(user.id))) {
    return { answer: AI_LIMIT_MESSAGE, usedAi: false };
  }

  const ctx = await loadClassContext(classId, user.id, user.timezone);
  const aiAnswer = await askClaude({
    system: classSystemPrompt(ctx),
    prompt: question,
    // A real study guide or quiz over a data-rich class can easily need
    // several thousand words — 700 was cutting those off mid-sentence, and
    // even 4096 still did for a two-book-plus-seven-lectures request
    // (verified live: stopped at exactly 4096/4096 tokens, mid-heading).
    // This is a ceiling, not a target, so short answers aren't padded out.
    maxTokens: 8192,
  });

  if (aiAnswer) {
    return { answer: aiAnswer, usedAi: true };
  }

  // With a key configured, a null answer means the call failed (timeout,
  // overload): say so and suggest a retry. Never fabricate a summary or
  // quiz. Without a key (a local copy), hand back the real data on file
  // instead, so the feature still returns something true.
  if (getAnthropicClient()) {
    return { answer: "The assistant didn't answer just now. Try again in a moment.", usedAi: false };
  }
  if (!ctx.hasAnyContent) {
    return {
      answer:
        "The AI assistant isn't set up on this site, and this class doesn't have any notes, assignments, exams, lectures or materials on file yet.",
      usedAi: false,
    };
  }
  return {
    answer: [
      "The AI assistant isn't set up on this site, so here's what's on file for this class:",
      "",
      "Notes:",
      ctx.notesText,
      "",
      "Assignments:",
      ctx.assignmentsText,
      "",
      "Exams:",
      ctx.examsText,
      "",
      "Lecture notes:",
      ctx.lecturesText,
      "",
      "Books & slides:",
      ctx.materialsText,
    ].join("\n"),
    usedAi: false,
  };
}
