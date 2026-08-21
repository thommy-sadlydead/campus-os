"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadWorkItemsForUser, getAvailableMinutesToday } from "@/lib/workload";
import { findBestFitForMinutes, whatShouldIDoRightNow } from "@/lib/priority-engine";
import { askClaude } from "@/lib/anthropic";
import { startOfTzDay } from "@/lib/time";

/**
 * Toggle a work item's completion.
 *
 * Note on `kind: "assignment"`: a bare assignment (no subtasks) has no
 * dedicated "done" state in the schema distinct from Canvas's own
 * SUBMITTED/GRADED — rather than add a parallel, possibly-conflicting
 * notion of "done," checking it off here sets status to SUBMITTED. That
 * means "no longer actionable," same as Canvas reporting it submitted; the
 * Canvas sync script never downgrades a manually-set status, so this
 * sticks until Canvas itself confirms grading. Tasks (subtasks) have
 * their own `completed` boolean and don't share this ambiguity.
 */
export async function toggleWorkItemAction(kind: "assignment" | "task", id: string) {
  const user = await requireUser();

  if (kind === "task") {
    const task = await prisma.task.findUnique({
      where: { id },
      include: { assignment: { include: { class: true } } },
    });
    if (!task || task.assignment.class.userId !== user.id) throw new Error("Not found.");
    await prisma.task.update({
      where: { id },
      data: { completed: !task.completed, completedAt: !task.completed ? new Date() : null },
    });
  } else {
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { class: true },
    });
    if (!assignment || assignment.class.userId !== user.id) throw new Error("Not found.");
    const nowDone = assignment.status === "SUBMITTED" || assignment.status === "GRADED";
    await prisma.assignment.update({
      where: { id },
      data: { status: nowDone ? "NOT_STARTED" : "SUBMITTED" },
    });
  }

  revalidatePath("/dashboard");
}

const minutesSchema = z.coerce.number().int().positive().max(600);

export interface MinutesModeResult {
  fits: boolean;
  title?: string;
  className?: string;
  reason?: string;
  message?: string;
}

export async function findTaskForMinutesAction(minutes: number): Promise<MinutesModeResult> {
  const user = await requireUser();
  const parsed = minutesSchema.safeParse(minutes);
  if (!parsed.success) {
    return { fits: false, message: "Enter a number of minutes between 1 and 600." };
  }

  const items = await loadWorkItemsForUser(user.id);
  const result = findBestFitForMinutes(items, new Date(), user.timezone, parsed.data);

  if (result.fits) {
    return {
      fits: true,
      title: result.result.item.title,
      className: result.result.item.className,
      reason: result.result.reason,
    };
  }
  return { fits: false, message: result.message };
}

export interface WhatNowResult {
  found: boolean;
  title?: string;
  className?: string;
  reason?: string;
  aiMessage?: string | null;
}

export async function whatShouldIDoRightNowAction(): Promise<WhatNowResult> {
  const user = await requireUser();
  const now = new Date();
  const items = await loadWorkItemsForUser(user.id);
  const top = whatShouldIDoRightNow(items, now, user.timezone);

  if (!top) {
    return { found: false };
  }

  const availableMinutes = await getAvailableMinutesToday(user.id, now, user.timezone);

  // AI narrative is a polish layer over the deterministic pick — the pick
  // itself never depends on the model being available or working.
  const aiMessage = await askClaude({
    system:
      "You are a calm, direct academic productivity assistant. Given one recommended task and light context, write 1-2 sentences telling the student what to do right now and why. No fluff, no emoji, no bullet points — plain sentences. Never invent facts (deadlines, minutes, class names) beyond what's given.",
    prompt: `Recommended task: "${top.item.title}" for ${top.item.className}.\nUrgency: ${top.bucket}.\nDeterministic reason: ${top.reason}.\nEstimated time: ${top.item.estimatedMinutes ?? "unknown"} minutes.\n${availableMinutes != null ? `Student has ${availableMinutes} minutes of free time logged today.` : "No free-time data logged today."}`,
    maxTokens: 150,
  });

  return {
    found: true,
    title: top.item.title,
    className: top.item.className,
    reason: top.reason,
    aiMessage,
  };
}

const timeString = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM.");
const availabilitySchema = z.object({
  start: timeString,
  end: timeString,
  label: z.string().max(60).optional(),
});

function timeStringToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function addAvailabilityBlockAction(formData: FormData) {
  const user = await requireUser();
  const parsed = availabilitySchema.safeParse({
    start: formData.get("start"),
    end: formData.get("end"),
    label: formData.get("label") || undefined,
  });
  if (!parsed.success) {
    throw new Error("Enter a valid start and end time.");
  }
  const startMinute = timeStringToMinutes(parsed.data.start);
  const endMinute = timeStringToMinutes(parsed.data.end);
  if (endMinute <= startMinute) {
    throw new Error("End time must be after start time.");
  }

  const today = startOfTzDay(new Date(), user.timezone);
  await prisma.availabilityBlock.create({
    data: {
      userId: user.id,
      date: today,
      startMinute,
      endMinute,
      label: parsed.data.label,
    },
  });

  revalidatePath("/dashboard");
}

export async function removeAvailabilityBlockAction(id: string) {
  const user = await requireUser();
  const block = await prisma.availabilityBlock.findUnique({ where: { id } });
  if (!block || block.userId !== user.id) throw new Error("Not found.");
  await prisma.availabilityBlock.delete({ where: { id } });
  revalidatePath("/dashboard");
}
