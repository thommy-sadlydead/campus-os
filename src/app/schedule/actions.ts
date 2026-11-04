"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { newCalendarLink } from "@/lib/calendar-feed-server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { meetingTimeProblem, minutesFromTimeField, parseMeetingDays } from "@/lib/meetings";

/** Makes the student's calendar link, or replaces it (the old link stops working). */
export async function newCalendarLinkAction() {
  const user = await requireUser();
  await newCalendarLink(user.id);
  revalidatePath("/schedule");
}

// ---------------------------------------------------------------------------
// Work and other commitments (src/lib/features.ts), and the latest time an
// exam prep session may be planned. Exam prep plans avoid both.
// ---------------------------------------------------------------------------

const commitmentSchema = z.object({
  label: z.string().trim().min(1, "Name it, like Work or Practice.").max(60),
  days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day."),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function addCommitmentAction(formData: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = commitmentSchema.safeParse({
    label: formData.get("label") ?? "",
    days: parseMeetingDays(formData.getAll("dayOfWeek")),
    start: formData.get("start"),
    end: formData.get("end"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.path[0] === "label" || issue?.path[0] === "days" ? issue.message : "Add a start and end time." };
  }
  const startMinute = minutesFromTimeField(parsed.data.start) as number;
  const endMinute = minutesFromTimeField(parsed.data.end) as number;
  const problem = meetingTimeProblem({ startMinute, endMinute, startsOn: null, endsOn: null });
  if (problem) return { error: problem };
  if ((await prisma.commitment.count({ where: { userId: user.id } })) + parsed.data.days.length > 60) {
    return { error: "That's a lot of commitments. Remove some first." };
  }
  await prisma.commitment.createMany({
    data: parsed.data.days.map((dayOfWeek) => ({ userId: user.id, label: parsed.data.label, dayOfWeek, startMinute, endMinute })),
  });
  revalidatePath("/schedule");
  return {};
}

export async function deleteCommitmentsAction(ids: string[]): Promise<void> {
  const user = await requireUser();
  const list = z.array(z.string()).min(1).max(7).parse(ids);
  await prisma.commitment.deleteMany({ where: { id: { in: list }, userId: user.id } });
  revalidatePath("/schedule");
}

/** The latest an exam prep session may end, in minutes after midnight; null for the default. */
export async function setStudyCutoffAction(minute: number | null): Promise<void> {
  const user = await requireUser();
  const value = minute === null ? null : Number(minute);
  if (value !== null && !(Number.isInteger(value) && value >= 18 * 60 && value <= 24 * 60)) return;
  await prisma.user.update({ where: { id: user.id }, data: { studyCutoffMinute: value } });
  revalidatePath("/schedule");
}
