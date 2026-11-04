"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { featuresFor } from "@/lib/features-server";
import { hasAiConsent } from "@/lib/ai-consent";
import { dayKey } from "@/lib/time";
import { planExamPrep, rescheduleMissed } from "@/lib/exam-prep";
import { planContextFor } from "@/lib/exam-prep-server";
import { generateFlashcardsAction } from "./study-actions";

// Exam prep plans (src/lib/exam-prep.ts). Every action checks the exam or
// session belongs to the signed-in student: like every server action,
// these can be called with any arguments.

export type ExamPrepResult = { error?: string; notice?: string } | undefined;

const PREP_DECK_CARDS = 20;

function refresh(classId: string) {
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/dashboard");
  revalidatePath("/schedule");
}

/**
 * Plans short self-quiz sessions before an exam and, when AI is allowed
 * and the class has notes or files, makes a flashcard deck to quiz on.
 */
export async function createExamPrepPlanAction(examId: string): Promise<ExamPrepResult> {
  const user = await requireUser();
  const features = await featuresFor(user);
  if (!features.has("exam-prep")) return { error: "Turn on Exam prep plans under Account → Features first." };
  const exam = await prisma.exam.findFirst({ where: { id: String(examId), class: { userId: user.id } }, include: { class: true } });
  if (!exam) return { error: "That exam wasn't found." };
  if (!exam.examAt || exam.examAt <= new Date()) return { error: "This exam needs a date in the future to plan for." };
  if (await prisma.studySession.count({ where: { examId: exam.id, status: { not: "SKIPPED" } } })) {
    return { error: "This exam already has a plan." };
  }

  const ctx = await planContextFor(user, features);
  const plan = planExamPrep(exam.examAt, ctx);
  if (plan.length === 0) {
    return {
      error:
        dayKey(exam.examAt, user.timezone) === dayKey(ctx.now, user.timezone)
          ? "This exam is today, so there are no days left to plan."
          : "There's no free time before this exam to fit a session in.",
    };
  }

  // The deck to quiz on. Without it the sessions still happen, with the
  // class assistant's "Quiz me" or the student's own notes.
  let deckId: string | null = null;
  let notice: string | undefined;
  if (hasAiConsent(user)) {
    const made = await generateFlashcardsAction(exam.classId, { source: "all", count: PREP_DECK_CARDS });
    if (made?.deckId) {
      deckId = made.deckId;
      await prisma.flashcardDeck.update({ where: { id: deckId }, data: { title: `Prep: ${exam.name}`.slice(0, 120) } });
    } else {
      notice = `The sessions are planned, but no flashcards were made: ${made?.error ?? "try making some on the Study tab."}`;
    }
  } else {
    notice = "The sessions are planned. Allow AI features to get a flashcard deck for them too.";
  }

  await prisma.studySession.createMany({
    data: plan.map((s) => ({ userId: user.id, classId: exam.classId, examId: exam.id, deckId, startsAt: s.startsAt, minutes: s.minutes })),
  });
  refresh(exam.classId);
  return notice ? { notice } : undefined;
}

async function ownedSession(sessionId: string, userId: string) {
  return prisma.studySession.findFirst({ where: { id: String(sessionId), userId }, include: { exam: true } });
}

export async function setStudySessionStatusAction(sessionId: string, status: "DONE" | "SKIPPED" | "PLANNED"): Promise<void> {
  const user = await requireUser();
  if (!["DONE", "SKIPPED", "PLANNED"].includes(status)) return;
  const session = await ownedSession(sessionId, user.id);
  if (!session) return;
  await prisma.studySession.update({
    where: { id: session.id },
    data: { status, completedAt: status === "DONE" ? new Date() : null },
  });
  refresh(session.classId);
}

/** A missed session, moved to the next free time before the exam. */
export async function rescheduleStudySessionAction(sessionId: string): Promise<ExamPrepResult> {
  const user = await requireUser();
  const session = await ownedSession(sessionId, user.id);
  if (!session?.exam.examAt) return { error: "That session wasn't found." };
  const features = await featuresFor(user);
  const others = await prisma.studySession.findMany({
    where: { examId: session.examId, id: { not: session.id }, status: { not: "SKIPPED" } },
    select: { startsAt: true },
  });
  const ctx = await planContextFor(user, features);
  const at = rescheduleMissed(
    session.exam.examAt,
    others.map((s) => dayKey(s.startsAt, user.timezone)),
    { ...ctx, taken: ctx.taken.filter((t) => t.startsAt.getTime() !== session.startsAt.getTime()) }
  );
  if (!at) {
    await prisma.studySession.update({ where: { id: session.id }, data: { status: "SKIPPED" } });
    refresh(session.classId);
    return { error: "There's no free time left before the exam, so this one is skipped." };
  }
  await prisma.studySession.update({ where: { id: session.id }, data: { startsAt: at, status: "PLANNED" } });
  refresh(session.classId);
  return undefined;
}

/** Removes an exam's plan. Its flashcard deck stays on the Study tab. */
export async function deleteExamPrepPlanAction(examId: string): Promise<void> {
  const user = await requireUser();
  const exam = await prisma.exam.findFirst({ where: { id: String(examId), class: { userId: user.id } }, select: { id: true, classId: true } });
  if (!exam) return;
  await prisma.studySession.deleteMany({ where: { examId: exam.id, userId: user.id } });
  refresh(exam.classId);
}
