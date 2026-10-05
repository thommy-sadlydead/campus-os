// Brightspace and Blackboard sync, through the student's calendar feed:
// fetch each feed link, read it (ics.ts), sort its items into courses
// (feed-courses.ts), apply the student's choices from the preview, and write
// it all with applyLmsCourses like every other LMS.
//
// A feed has due dates and exams, not directions, submissions or files,
// so those parts of Campus OS are filled in by the student here.

import type { PrismaClient } from "@prisma/client";
import { applyLmsCourses, type LmsCourseInput } from "@/lib/lms/apply";
import { analyzeFeeds, feedKey, type FeedAnalysis, type FeedCourseSettings, type FeedInput } from "@/lib/lms/feed-courses";
import { parseIcs } from "@/lib/lms/ics";
import { lmsLink, type FeedProvider } from "@/lib/lms/providers";
import { emptyReport, type SyncReport } from "@/lib/lms/report";
import { fetchPublicText, SafeFetchError } from "@/lib/lms/safe-fetch";

/** Stored encrypted on the connection (LmsConnection.credentialsEnc): the links carry their own access token. */
export interface FeedCredentials {
  feedUrls: string[];
}

export const MAX_FEEDS = 12;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const FEED_TIMEOUT_MS = 20_000;

export class FeedError extends Error {}

export interface LoadedFeeds {
  feeds: FeedInput[];
  /** Links that couldn't be read, by position, and why. */
  problems: { index: number; message: string }[];
}

/** Fetches and reads each feed link. Throws only when none of them could be read. */
export async function loadFeeds(urls: string[], timeZone: string): Promise<LoadedFeeds> {
  const result: LoadedFeeds = { feeds: [], problems: [] };
  for (const [index, url] of urls.entries()) {
    try {
      const text = await fetchPublicText(url, {
        maxBytes: MAX_FEED_BYTES,
        timeoutMs: FEED_TIMEOUT_MS,
        accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
        userAgent: "CampusOS/1.0 (calendar sync)",
      });
      if (!/BEGIN:VCALENDAR/i.test(text)) {
        throw new FeedError("That link isn't a calendar feed. Copy the subscribe link from your calendar's settings.");
      }
      result.feeds.push({ key: feedKey(url), calendar: parseIcs(text, timeZone) });
    } catch (err) {
      let message = "Couldn't read that calendar.";
      if (err instanceof SafeFetchError && (err.status === 401 || err.status === 403 || err.status === 404)) {
        message = "That calendar link doesn't work anymore. Make a new one and paste it again.";
      } else if (err instanceof FeedError || err instanceof SafeFetchError) {
        message = err.message;
      } else {
        console.error("Calendar feed failed:", err);
      }
      result.problems.push({ index, message });
    }
  }
  if (result.feeds.length === 0) throw new FeedError(result.problems[0]?.message ?? "Couldn't read that calendar.");
  return result;
}

/** One row of the preview the student sees before connecting. */
export interface FeedCoursePreview {
  key: string;
  name: string;
  assignments: number;
  exams: number;
  /** A few of its items, so the student can tell which class it is. */
  samples: string[];
  /**
   * Nothing due in the last month or later: most likely a past term's
   * course (Blackboard's feed reaches back a year), so the preview leaves
   * it out unless the student ticks it.
   */
  ended: boolean;
}

const ENDED_AFTER_DAYS = 30;

export function previewCourses(analysis: FeedAnalysis, now: Date = new Date()): FeedCoursePreview[] {
  const endedBefore = now.getTime() - ENDED_AFTER_DAYS * 24 * 60 * 60 * 1000;
  return analysis.courses.map((course) => {
    const items = analysis.items.filter((i) => i.courseKey === course.key);
    const latest = Math.max(...items.map((i) => i.at?.getTime() ?? Number.NEGATIVE_INFINITY));
    return {
      key: course.key,
      name: course.name,
      assignments: items.filter((i) => i.kind === "assignment").length,
      exams: items.filter((i) => i.kind === "exam" || i.isExam).length,
      samples: items.slice(0, 3).map((i) => i.title),
      ended: Number.isFinite(latest) && latest < endedBefore,
    };
  });
}

/** The analysis as the courses to write: renamed and skipped as the student chose. New courses come in under their own name. */
export function feedCourseInputs(provider: FeedProvider, analysis: FeedAnalysis, settings: FeedCourseSettings): LmsCourseInput[] {
  const inputs: LmsCourseInput[] = [];
  for (const course of analysis.courses) {
    const choice = settings.courses[course.key];
    if (choice?.skip) continue;
    const items = analysis.items.filter((i) => i.courseKey === course.key);
    inputs.push({
      id: course.key,
      name: choice?.name?.trim() || course.name,
      code: "",
      assignments: items
        .filter((i) => i.kind === "assignment")
        .map((i) => ({
          id: i.id,
          name: i.title,
          description: i.description,
          dueAt: i.at,
          pointsPossible: null,
          url: lmsLink(i.url, provider)?.url ?? null,
          submission: null,
          tracksSubmissions: false,
          isExam: i.isExam,
        })),
      exams: items
        .filter((i) => i.kind === "exam")
        .map((i) => ({ id: i.id, name: i.title, examAt: i.at, location: i.location, url: lmsLink(i.url, provider)?.url ?? null })),
      problem: null,
    });
  }
  return inputs;
}

export async function syncFeedForUser(
  prisma: PrismaClient,
  userId: string,
  provider: FeedProvider,
  credentials: FeedCredentials,
  settings: FeedCourseSettings,
  timeZone: string,
  now: Date = new Date()
): Promise<SyncReport> {
  const report = emptyReport(provider, now);
  const loaded = await loadFeeds(credentials.feedUrls, timeZone);
  for (const problem of loaded.problems) {
    report.skipped.push({ name: `Calendar link ${problem.index + 1}`, reason: problem.message });
  }
  const analysis = analyzeFeeds(provider, loaded.feeds);
  const applied = await applyLmsCourses(prisma, userId, provider, feedCourseInputs(provider, analysis, settings), now);
  report.classes = applied.classes;
  report.reopened = applied.reopened;
  if (applied.checkedOff > 0) report.checkedOff = applied.checkedOff;
  report.finishedAt = new Date().toISOString();
  return report;
}
