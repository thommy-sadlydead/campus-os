"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MATERIALS_WITH_TEXT, loadClassContext, classSystemPrompt } from "@/lib/class-context";
import { askClaude, askClaudeForJson, getAnthropicClient } from "@/lib/anthropic";
import { AI_LIMIT_MESSAGE, allowAiRequest } from "@/lib/rate-limit";
import { AI_CONSENT_MESSAGE, hasAiConsent } from "@/lib/ai-consent";
import { formatDueLabel } from "@/lib/time";
import { featuresFor } from "@/lib/features-server";
import { revalidatePath } from "next/cache";
import { SYLLABUS_HELP_SYSTEM, parseSyllabusHelp } from "@/lib/get-help";

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

  if (!hasAiConsent(user)) {
    return { answer: AI_CONSENT_MESSAGE, usedAi: false };
  }
  if (!(await allowAiRequest(user.id))) {
    return { answer: AI_LIMIT_MESSAGE, usedAi: false };
  }

  const [ctx, features] = await Promise.all([loadClassContext(classId, user.id, user.timezone), featuresFor(user)]);
  const aiAnswer = await askClaude({
    system: classSystemPrompt(ctx, { tutorMode: features.has("tutor-mode") }),
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

export type SyllabusHelpResult = { error?: string; found?: { professorEmail: string | null; officeHours: string | null } };

/**
 * Getting help: reads the class's syllabus for the professor's email and
 * office hours, and fills in whichever of the two isn't set yet.
 */
export async function findHelpInSyllabusAction(classId: string): Promise<SyllabusHelpResult> {
  const user = await requireUser();
  const cls = await requireOwnedClass(classId, user.id);
  if (!hasAiConsent(user)) return { error: AI_CONSENT_MESSAGE };

  const syllabi = await prisma.classMaterial.findMany({
    where: { classId, type: "SYLLABUS", ...MATERIALS_WITH_TEXT },
    orderBy: { createdAt: "desc" },
    take: 2,
  });
  const text = syllabi.map((m) => m.content).join("\n\n").slice(0, 30_000);
  if (!text.trim()) {
    return { error: "There's no syllabus on file for this class. Add it under Resources, or type these in." };
  }
  if (!(await allowAiRequest(user.id))) return { error: AI_LIMIT_MESSAGE };

  const json = await askClaudeForJson<unknown>({ system: SYLLABUS_HELP_SYSTEM, prompt: `Syllabus for ${cls.name}:\n\n${text}`, maxTokens: 300 });
  if (json === null) return { error: "Couldn't read the syllabus just now. Try again in a moment." };
  const found = parseSyllabusHelp(json);
  await prisma.class.update({
    where: { id: classId },
    data: {
      ...(found.professorEmail && !cls.professorEmail ? { professorEmail: found.professorEmail } : {}),
      ...(found.officeHours && !cls.officeHours ? { officeHours: found.officeHours } : {}),
    },
  });
  revalidatePath(`/classes/${classId}`);
  return { found };
}
