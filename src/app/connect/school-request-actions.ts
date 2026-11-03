"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLmsConnection } from "@/lib/lms/connections";
import { isFeedProvider } from "@/lib/lms/providers";
import { isEmailAddress, schoolHost } from "@/lib/lms/school-request";

/**
 * Counts that the student asked their school to turn on Campus OS in
 * Brightspace or Blackboard, and where they sent it. Called as they open
 * the email; the email itself goes from their own mail app.
 */
export async function recordSchoolRequestAction(provider: string, contactEmail: string) {
  const user = await requireUser();
  if (!isFeedProvider(provider)) throw new Error("Not found.");
  const email = String(contactEmail).trim().toLowerCase();
  if (!isEmailAddress(email)) throw new Error("That doesn't look like an email address.");
  const connection = await getLmsConnection(user.id, provider);
  const host = connection ? schoolHost(connection.baseUrl) : null;
  if (!host) throw new Error("Connect first.");

  await prisma.schoolAccessRequest.upsert({
    where: { userId_provider: { userId: user.id, provider } },
    create: { userId: user.id, provider, schoolHost: host, contactEmail: email },
    update: { schoolHost: host, contactEmail: email },
  });
  revalidatePath(`/connect/${provider}`);
}
