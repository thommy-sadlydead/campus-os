"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { runLmsSync, saveLmsConnection } from "@/lib/lms/connections";
import { describeSchoologyConnectError, fetchSchoologyMe, normalizeSchoologyDomain, SchoologyClient } from "@/lib/lms/schoology";
import type { SchoologySettings } from "@/lib/lms/schoology-sync";
import { queueCourseMaterialSync } from "@/lib/materials-sync";

// What the student typed (never the secret) is echoed back so the form
// keeps it after an error: React 19 resets a form once its action finishes.
export type ConnectSchoologyState = { error?: string; domain?: string; consumerKey?: string } | undefined;

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function connectSchoologyAction(
  _prev: ConnectSchoologyState,
  formData: FormData
): Promise<ConnectSchoologyState> {
  const user = await requireUser();
  const domainInput = String(formData.get("domain") ?? "").trim();
  const consumerKey = String(formData.get("consumerKey") ?? "").trim();
  const consumerSecret = String(formData.get("consumerSecret") ?? "").trim();

  const domain = normalizeSchoologyDomain(domainInput);
  if (!domain) {
    return { error: "Enter your school's Schoology address, like app.schoology.com or lms.yourdistrict.org.", domain: domainInput, consumerKey };
  }
  if (!consumerKey || !consumerSecret) {
    return { error: "Paste both the consumer key and the consumer secret from your Schoology API page.", domain, consumerKey };
  }
  if (consumerKey.length > 200 || consumerSecret.length > 200 || /\s/.test(consumerKey + consumerSecret)) {
    return { error: "That key or secret doesn't look right. Copy them again, without spaces.", domain, consumerKey };
  }
  if (!(await consumeRateLimit(`lms-connect:${user.id}`, RATE_LIMITS.lmsConnect))) {
    return { error: "That's a lot of tries in a short time. Wait a bit and try again.", domain, consumerKey };
  }

  // Check the key before saving anything, and learn the account's own id
  // and time zone (Schoology's times are in it).
  const client = new SchoologyClient({ consumerKey, consumerSecret, domain });
  let settings: SchoologySettings;
  try {
    const me = await fetchSchoologyMe(client);
    settings = {
      userId: String(me.uid ?? me.id),
      timezone: me.tz_name && isTimeZone(me.tz_name) ? me.tz_name : user.timezone,
    };
  } catch (err) {
    console.error("Schoology connect check failed:", err);
    return { error: describeSchoologyConnectError(err, domain), domain, consumerKey };
  }

  await saveLmsConnection(user.id, "schoology", { baseUrl: domain, credentials: { consumerKey, consumerSecret }, settings });

  // The first sync runs now, so connecting leaves real data behind. A
  // failure doesn't undo the connection: its report says what went wrong.
  const report = await runLmsSync(user.id, "schoology", user.timezone);
  if (!report.error) {
    // Queues each class for a materials scan; the Schoology page's panel
    // starts working through it as soon as it loads.
    await queueCourseMaterialSync(prisma, user.id, "schoology").catch((err) =>
      console.error("Schoology materials couldn't be queued:", err)
    );
  }

  // The navigation names the connected LMS, so every page changes.
  revalidatePath("/", "layout");
  return undefined;
}
