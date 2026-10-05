"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getLmsConnection, readCredentials, readSettings, runLmsSync, saveLmsConnection } from "@/lib/lms/connections";
import { analyzeFeeds, type FeedCourseSettings } from "@/lib/lms/feed-courses";
import { FeedError, loadFeeds, MAX_FEEDS, previewCourses, type FeedCoursePreview, type FeedCredentials } from "@/lib/lms/feed-sync";
import { isFeedProvider, LMS_PROVIDER_INFO, type FeedProvider } from "@/lib/lms/providers";
import { summarizeReport } from "@/lib/lms/report";
import { normalizeFeedUrl, SafeFetchError } from "@/lib/lms/safe-fetch";

// Brightspace and Blackboard connect through the student's calendar feed:
// paste the link, see the classes it found (rename or leave any out), then
// connect. Every export here is a public endpoint: the provider, links and
// choices are all checked, never trusted.

export interface FeedPreviewResult {
  error?: string;
  courses?: FeedCoursePreview[];
  /** Links that couldn't be read, by position. */
  problems?: { index: number; message: string }[];
  /** Items that weren't work ("opens" markers, ordinary events). */
  ignored?: number;
  /** The student's saved choices, when editing an existing connection. */
  choices?: FeedCourseSettings["courses"];
}

type CourseChoices = FeedCourseSettings["courses"];

function cleanUrls(urls: unknown): string[] | string {
  if (!Array.isArray(urls)) return "Paste your calendar link.";
  const cleaned = [
    ...new Set(urls.filter((u): u is string => typeof u === "string" && u.trim() !== "").map((u) => normalizeFeedUrl(u))),
  ];
  if (cleaned.length === 0) return "Paste your calendar link.";
  if (cleaned.some((u) => u === null)) return "One of those isn't a web link. Copy the whole link from your calendar's settings.";
  if (cleaned.length > MAX_FEEDS) return `You can add up to ${MAX_FEEDS} calendar links.`;
  return cleaned as string[];
}

/** Only known course keys, short names, and a skip flag. */
function cleanChoices(choices: unknown): CourseChoices {
  const result: CourseChoices = {};
  if (!choices || typeof choices !== "object") return result;
  for (const [key, value] of Object.entries(choices as Record<string, unknown>).slice(0, 200)) {
    if (key.length > 300 || !value || typeof value !== "object") continue;
    const { name, skip } = value as { name?: unknown; skip?: unknown };
    const entry: { name?: string; skip?: boolean } = {};
    if (typeof name === "string" && name.trim()) entry.name = name.trim().slice(0, 120);
    if (skip === true) entry.skip = true;
    if (entry.name || entry.skip) result[key] = entry;
  }
  return result;
}

function describe(err: unknown): string {
  if (err instanceof FeedError || err instanceof SafeFetchError) return err.message;
  console.error("Calendar feed preview failed:", err);
  return "Couldn't read that calendar. Check the link and try again.";
}

async function preview(provider: FeedProvider, urls: string[], timeZone: string): Promise<FeedPreviewResult> {
  const loaded = await loadFeeds(urls, timeZone);
  const analysis = analyzeFeeds(provider, loaded.feeds);
  if (analysis.items.length === 0) {
    return {
      error: `That calendar doesn't have any due dates in it yet. Check that it's your ${LMS_PROVIDER_INFO[provider].name} calendar for all your courses.`,
    };
  }
  return { courses: previewCourses(analysis), problems: loaded.problems, ignored: analysis.ignored };
}

/** Step one: read the links and show what's in them. Nothing is saved. */
export async function previewFeedAction(provider: string, urls: unknown): Promise<FeedPreviewResult> {
  const user = await requireUser();
  if (!isFeedProvider(provider)) return { error: "Unknown connection." };
  const cleaned = cleanUrls(urls);
  if (typeof cleaned === "string") return { error: cleaned };
  if (!(await consumeRateLimit(`lms-connect:${user.id}`, RATE_LIMITS.lmsConnect))) {
    return { error: "That's a lot of tries in a short time. Wait a bit and try again." };
  }
  try {
    return await preview(provider, cleaned, user.timezone);
  } catch (err) {
    return { error: describe(err) };
  }
}

/** Step two: save the links and the student's choices, then sync. */
export async function connectFeedAction(provider: string, urls: unknown, choices: unknown): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!isFeedProvider(provider)) return { error: "Unknown connection." };
  const cleaned = cleanUrls(urls);
  if (typeof cleaned === "string") return { error: cleaned };
  if (!(await consumeRateLimit(`lms-connect:${user.id}`, RATE_LIMITS.lmsConnect))) {
    return { error: "That's a lot of tries in a short time. Wait a bit and try again." };
  }
  try {
    await loadFeeds(cleaned, user.timezone);
  } catch (err) {
    return { error: describe(err) };
  }

  const credentials: FeedCredentials = { feedUrls: cleaned };
  const settings: FeedCourseSettings = { courses: cleanChoices(choices) };
  await saveLmsConnection(user.id, provider, { baseUrl: new URL(cleaned[0]).origin, credentials, settings });
  await runLmsSync(user.id, provider, user.timezone);
  // The navigation names the connected LMS, so every page changes.
  revalidatePath("/", "layout");
  return {};
}

/** For "Edit classes": what the saved links have now, with the choices already made. */
export async function previewSavedFeedAction(provider: string): Promise<FeedPreviewResult> {
  const user = await requireUser();
  if (!isFeedProvider(provider)) return { error: "Unknown connection." };
  const connection = await getLmsConnection(user.id, provider);
  if (!connection) return { error: `${LMS_PROVIDER_INFO[provider].name} isn't connected.` };
  try {
    const { feedUrls } = readCredentials<FeedCredentials>(connection.credentialsEnc);
    const result = await preview(provider, feedUrls, user.timezone);
    return { ...result, choices: readSettings<FeedCourseSettings>(connection.settings, { courses: {} }).courses };
  } catch (err) {
    return { error: describe(err) };
  }
}

/**
 * Saves new names and choices, then syncs. A class left out now is hidden
 * (archived) rather than deleted, with everything in it, and comes back if
 * it's included again.
 */
export async function saveFeedCoursesAction(provider: string, choices: unknown): Promise<{ error?: string; message?: string }> {
  const user = await requireUser();
  if (!isFeedProvider(provider)) return { error: "Unknown connection." };
  const connection = await getLmsConnection(user.id, provider);
  if (!connection) return { error: `${LMS_PROVIDER_INFO[provider].name} isn't connected.` };
  const courses = cleanChoices(choices);
  await prisma.lmsConnection.update({
    where: { id: connection.id },
    data: { settings: JSON.stringify({ courses } satisfies FeedCourseSettings) },
  });
  const skipped = Object.keys(courses).filter((key) => courses[key].skip);
  await prisma.class.updateMany({
    where: { userId: user.id, lmsProvider: provider, lmsCourseId: { in: skipped } },
    data: { archived: true },
  });
  await prisma.class.updateMany({
    where: { userId: user.id, lmsProvider: provider, archived: true, lmsCourseId: { notIn: skipped } },
    data: { archived: false },
  });
  const report = await runLmsSync(user.id, provider, user.timezone);
  revalidatePath("/", "layout");
  return report.error ? { error: report.error } : { message: summarizeReport(report) };
}
