"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { newCalendarLink } from "@/lib/calendar-feed-server";

/** Makes the student's calendar link, or replaces it (the old link stops working). */
export async function newCalendarLinkAction() {
  const user = await requireUser();
  await newCalendarLink(user.id);
  revalidatePath("/schedule");
}
