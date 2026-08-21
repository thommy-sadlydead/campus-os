"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { askClaudeForJson } from "@/lib/anthropic";
import { heuristicBreakdown } from "@/lib/breakdown-heuristics";

export interface BreakdownResult {
  ok: boolean;
  message: string;
  stepCount: number;
  usedAi: boolean;
}

interface AiBreakdownJson {
  steps: Array<{ title: string; estimatedMinutes: number }>;
}

/**
 * Automatic Assignment Breakdown. AI estimates workload and splits an
 * assignment into concrete steps, using its description when Canvas
 * provided one; without an API key, falls back to
 * heuristicBreakdown (src/lib/breakdown-heuristics.ts) — same
 * AI-optional pattern as the rest of the app. Refuses to run on an
 * assignment that already has subtasks, so it never duplicates or
 * clobbers a breakdown (or manual edits) that already exist.
 */
export async function breakdownAssignmentAction(assignmentId: string): Promise<BreakdownResult> {
  const user = await requireUser();
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { class: true, tasks: true },
  });
  if (!assignment || assignment.class.userId !== user.id) throw new Error("Not found.");
  if (assignment.tasks.length > 0) {
    return { ok: false, message: "This assignment is already broken into steps.", stepCount: 0, usedAi: false };
  }

  const system = `You help a college student scope out an assignment by splitting it into a short sequence of concrete, actionable steps.

Rules:
- Use the assignment's description when given — don't assume every assignment needs the same workflow (a reading response needs a different shape than a research paper).
- If there's no description, infer reasonable *process* steps from the assignment's name and type alone — general steps like "outline" or "draft" are fine to infer, but never invent specific facts (topics, requirements, page counts) that weren't given.
- Return between 1 and 5 steps. If the assignment is small enough (rule of thumb: realistically under ~25-30 minutes total) that breaking it down wouldn't actually help, return an EMPTY steps array instead of padding with filler steps.
- Each step needs a short, concrete title (a verb phrase, e.g. "Draft the introduction," not "Step 1") and a realistic estimatedMinutes (a positive integer).
- The steps' estimated minutes should sum to roughly how long the whole assignment realistically takes — don't inflate the total just to make steps look substantial.`;

  const prompt = [
    `Assignment: ${assignment.name}`,
    assignment.pointsPossible != null ? `Points possible: ${assignment.pointsPossible}` : null,
    assignment.dueAt ? `Due: ${assignment.dueAt.toDateString()}` : "Due: not set",
    assignment.description ? `Description:\n${assignment.description.slice(0, 3000)}` : "Description: (none provided)",
  ]
    .filter(Boolean)
    .join("\n");

  const ai = await askClaudeForJson<AiBreakdownJson>({ system, prompt, maxTokens: 500 });

  let steps = (ai?.steps ?? [])
    .filter((s) => s.title && typeof s.estimatedMinutes === "number" && s.estimatedMinutes > 0)
    .slice(0, 5)
    .map((s) => ({ title: s.title.slice(0, 120), estimatedMinutes: Math.round(s.estimatedMinutes) }));
  let usedAi = !!ai;

  if (!ai) {
    steps = heuristicBreakdown({ name: assignment.name, baseEstimateMinutes: assignment.estimatedMinutes ?? 0 });
    usedAi = false;
  }

  if (steps.length === 0) {
    return {
      ok: true,
      message: "This is quick enough that breaking it into steps wouldn't help — no changes made.",
      stepCount: 0,
      usedAi,
    };
  }

  const totalMinutes = steps.reduce((sum, s) => sum + s.estimatedMinutes, 0);

  await prisma.$transaction([
    ...steps.map((s, i) =>
      prisma.task.create({ data: { assignmentId, title: s.title, estimatedMinutes: s.estimatedMinutes, order: i } })
    ),
    prisma.assignment.update({ where: { id: assignmentId }, data: { estimatedMinutes: totalMinutes } }),
  ]);

  revalidatePath("/assignments");
  revalidatePath(`/classes/${assignment.classId}`);
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: `Broken into ${steps.length} step${steps.length === 1 ? "" : "s"}${usedAi ? "" : " (heuristic — no API key configured)"}.`,
    stepCount: steps.length,
    usedAi,
  };
}
