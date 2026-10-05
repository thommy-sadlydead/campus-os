// Turns a Brightspace or Blackboard calendar feed into classes and their
// deadlines and exams. Pure, tested in tests/lms-feed.test.ts.
//
// A feed is a flat list of calendar items, and LMSs don't agree on where
// an item says which course it's from, so several signals are tried, most
// reliable first:
//   1. the course's id in the item's link (Brightspace's org unit,
//      Blackboard's _123_1 course id),
//   2. its CATEGORIES,
//   3. a course code in its title ("[BIO 1000] Lab 3", "Lab 3 - BIO 1000 - Due"),
//   4. its LOCATION, when that names a course rather than a room,
// and a name seen alongside an id joins that id's course. Items with none
// of these stay together as the feed's own class (a one-course feed). The
// student sees the courses found before anything is saved, and can rename
// or leave out any of them (FeedCourseSettings); that's what makes a feed
// laid out differently from these rules still usable.
//
// What an item is: a deadline ("Essay 1 - Due", "Quiz 2 - Availability
// Ends", or any item that starts and ends at the same moment) becomes an
// assignment; a "starts"/"opens" marker is skipped; anything else with a
// duration is a calendar event, kept only when it's an exam.

import crypto from "node:crypto";
import type { IcsCalendar, IcsEvent } from "@/lib/lms/ics";
import { isExamLikeName } from "@/lib/lms/exams";
import { LMS_PROVIDER_INFO, type FeedProvider } from "@/lib/lms/providers";

export interface FeedCourse {
  key: string;
  name: string;
}

export interface FeedItem {
  /** Stable across fetches: the item's UID when it has one. */
  id: string;
  courseKey: string;
  kind: "assignment" | "exam";
  title: string;
  description: string | null;
  url: string | null;
  /** When it's due, or when the exam starts. */
  at: Date | null;
  location: string | null;
  /** An assignment that's also an exam. */
  isExam: boolean;
}

export interface FeedAnalysis {
  courses: FeedCourse[];
  items: FeedItem[];
  /** Items skipped as not work: "available from" markers and ordinary events. */
  ignored: number;
}

/** The student's choices from the preview, saved on the connection (LmsConnection.settings). */
export interface FeedCourseSettings {
  courses: Record<string, { name?: string; skip?: boolean }>;
}

export interface FeedInput {
  /** Stable per feed link (see feedKey). */
  key: string;
  calendar: IcsCalendar;
}

/** A short, stable id for a feed link, without keeping the link (it holds an access token). */
export function feedKey(url: string): string {
  return crypto.createHash("sha256").update(url.trim()).digest("hex").slice(0, 12);
}

const DEADLINE_SUFFIX = /\s*[-–—:]\s*(due|due date|availability ends|end date|ends|closes|deadline)\s*$/i;
const DEADLINE_PREFIX = /^\s*(due|deadline)\s*[:\-–—]\s*/i;
const START_SUFFIX = /\s*[-–—:]\s*(availability starts|start date|starts|opens|available|available from|unlocks|unlock starts|unlock ends)\s*$/i;
// A course code: BIO 1000, ENGR 13300, CS-180, MATH1210A, HIST 1100-02.
const COURSE_CODE = /\b[A-Z]{2,6}[ -]?\d{3,5}[A-Z]?(?:[ -]\d{1,3}[A-Z]?)?\b/;
const ROOM_LIKE = /\b(room|rm\.?|hall|bldg|building|lab|library|online|zoom|teams|virtual|tba|tbd|campus|center|auditorium)\b|^\s*[A-Z]?\d{1,4}[A-Z]?\s*$/i;
// Kinds of item, which some calendars put in CATEGORIES, rather than courses.
const ITEM_TYPE = /^(assignments?|due dates?|deadlines?|events?|tests?|quiz(zes)?|exams?|calendar|courses?|tasks?|to-?dos?|discussions?|personal|institution|other|general)$/i;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalize(text: string): string {
  return clean(text).toLowerCase();
}

/** The course's own id from an item's link, when the LMS puts one there. */
export function courseIdFromUrl(url: string | null, provider: FeedProvider): string | null {
  if (!url) return null;
  if (provider === "brightspace") {
    const m =
      url.match(/\/d2l\/le\/calendar\/(\d+)\//) ??
      url.match(/[?&]ou=(\d+)/) ??
      url.match(/\/d2l\/(?:le|lms|lp|home)\/(?:[a-z]+\/)*?(\d{4,})(?:[/?#]|$)/i);
    return m ? m[1] : null;
  }
  const m = url.match(/[?&]course_id=(_\d+_\d+)/) ?? url.match(/\/courses\/(_\d+_\d+)/);
  return m ? m[1] : null;
}

interface TitleParts {
  title: string;
  course: string | null;
  marker: "deadline" | "start" | null;
  /** Which deadline word: "Due" and "Availability Ends" can both be listed for one quiz. */
  deadlineWord: "due" | "ends" | null;
}

/** Splits "[BIO 1000] Lab 3 - Due" into the title, the course in it, and the status word. */
export function splitTitle(summary: string): TitleParts {
  let title = clean(summary);
  let marker: TitleParts["marker"] = null;
  let deadlineWord: TitleParts["deadlineWord"] = null;
  const deadline = title.match(DEADLINE_SUFFIX);
  if (START_SUFFIX.test(title)) {
    marker = "start";
    title = title.replace(START_SUFFIX, "");
  } else if (deadline) {
    marker = "deadline";
    deadlineWord = /due|deadline/i.test(deadline[1]) ? "due" : "ends";
    title = title.replace(DEADLINE_SUFFIX, "");
  } else if (DEADLINE_PREFIX.test(title)) {
    marker = "deadline";
    deadlineWord = "due";
    title = title.replace(DEADLINE_PREFIX, "");
  }

  let course: string | null = null;
  const bracket = title.match(/^\[([^\]]{2,80})\]\s*(.+)$/);
  if (bracket) {
    course = clean(bracket[1]);
    title = bracket[2];
  } else {
    const prefix = title.match(/^([A-Z]{2,6}[ -]?\d{3,5}[A-Z]?(?:[ -]\d{1,3}[A-Z]?)?)\s*[:\-–—]\s+(.+)$/);
    if (prefix) {
      course = clean(prefix[1]);
      title = prefix[2];
    } else {
      // "Lab 3 - BIO 1000": the last " - " part, when it's a course code.
      const parts = title.split(/\s+[-–—]\s+/);
      if (parts.length > 1 && COURSE_CODE.test(parts[parts.length - 1]) && parts[parts.length - 1].length <= 80) {
        course = clean(parts.pop() as string);
        title = parts.join(" - ");
      }
    }
  }
  return { title: clean(title) || clean(summary), course, marker, deadlineWord };
}

function itemTime(event: IcsEvent): Date | null {
  return (event.due ?? event.end ?? event.start)?.date ?? null;
}

/**
 * Whether a calendar item is a deadline rather than something that takes
 * time: a to-do, or a timed event that ends when it starts. An all-day
 * event ("No class: Fall break") isn't.
 */
function isInstant(event: IcsEvent): boolean {
  if (event.kind === "todo") return true;
  if (!event.start || event.start.allDay) return false;
  if (!event.end) return true;
  return Math.abs(event.end.date.getTime() - event.start.date.getTime()) <= 60_000;
}

interface Located {
  event: IcsEvent;
  feed: string;
  parts: TitleParts;
  lmsId: string | null;
  /** A course name this item gives, and how sure we are of it (higher is better). */
  names: { name: string; weight: number }[];
}

export function analyzeFeeds(provider: FeedProvider, feeds: FeedInput[]): FeedAnalysis {
  const located: Located[] = [];
  for (const feed of feeds) {
    for (const event of feed.calendar.events) {
      const parts = splitTitle(event.summary);
      const names: Located["names"] = [];
      if (event.categories[0]) names.push({ name: clean(event.categories[0]), weight: 3 });
      if (parts.course) names.push({ name: parts.course, weight: 2 });
      located.push({ event, feed: feed.key, parts, lmsId: courseIdFromUrl(event.url, provider), names });
    }
  }

  // A location names the course when it's on several items and isn't a
  // room, or it has a course code in it.
  const locationCounts = new Map<string, number>();
  for (const l of located) {
    const loc = l.event.location ? clean(l.event.location) : "";
    if (loc) locationCounts.set(normalize(loc), (locationCounts.get(normalize(loc)) ?? 0) + 1);
  }
  for (const l of located) {
    const loc = l.event.location ? clean(l.event.location) : "";
    if (!loc || loc.length > 120) continue;
    const repeated = (locationCounts.get(normalize(loc)) ?? 0) >= 2 && !ROOM_LIKE.test(loc);
    if (repeated || COURSE_CODE.test(loc)) l.names.push({ name: loc, weight: 1 });
  }

  // Names seen with exactly one LMS id stand for that id's course. A name
  // seen with several ("Assignment" as a category, "Online" as a location)
  // isn't a course's name at all, and neither is an item type.
  const idsByName = new Map<string, Set<string>>();
  for (const l of located) {
    if (!l.lmsId) continue;
    for (const n of l.names) {
      const set = idsByName.get(normalize(n.name)) ?? new Set<string>();
      set.add(l.lmsId);
      idsByName.set(normalize(n.name), set);
    }
  }
  for (const l of located) {
    l.names = l.names.filter((n) => !ITEM_TYPE.test(n.name) && (idsByName.get(normalize(n.name))?.size ?? 0) <= 1);
  }

  const providerName = LMS_PROVIDER_INFO[provider].name;
  const votes = new Map<string, Map<string, { name: string; score: number }>>();
  const feedNames = new Map(feeds.map((f) => [f.key, f.calendar.name]));
  const courseOf = (l: Located): string => {
    if (l.lmsId) return `id:${l.lmsId}`;
    for (const n of [...l.names].sort((a, b) => b.weight - a.weight)) {
      const ids = idsByName.get(normalize(n.name));
      if (ids && ids.size === 1) return `id:${[...ids][0]}`;
    }
    const best = [...l.names].sort((a, b) => b.weight - a.weight)[0];
    if (best) return `name:${normalize(best.name)}`;
    return `feed:${l.feed}`;
  };

  const items: FeedItem[] = [];
  let ignored = 0;
  // Deadlines by course and title, to pair a quiz's "Due" with its
  // "Availability Ends" (see below).
  const byTitle = new Map<string, { item: FeedItem; word: TitleParts["deadlineWord"] }[]>();
  for (const l of located) {
    const courseKey = courseOf(l);
    const tally = votes.get(courseKey) ?? new Map<string, { name: string; score: number }>();
    for (const n of l.names) {
      const entry = tally.get(normalize(n.name)) ?? { name: n.name, score: 0 };
      entry.score += n.weight;
      tally.set(normalize(n.name), entry);
    }
    votes.set(courseKey, tally);

    if (l.parts.marker === "start") {
      ignored += 1;
      continue;
    }
    const deadline = l.parts.marker === "deadline" || isInstant(l.event);
    const exam = isExamLikeName(l.parts.title);
    if (!deadline && !exam) {
      ignored += 1;
      continue;
    }

    const id = l.event.uid ?? `gen:${feedKey(`${courseKey}|${l.event.summary}|${l.event.start?.date.toISOString() ?? ""}`)}`;
    const item: FeedItem = {
      id: deadline ? id : `event:${id}`,
      courseKey,
      kind: deadline ? "assignment" : "exam",
      title: l.parts.title,
      description: l.event.description,
      url: l.event.url,
      at: deadline ? itemTime(l.event) : (l.event.start?.date ?? null),
      location: deadline ? null : l.event.location,
      isExam: exam,
    };
    // Brightspace can list one quiz twice, "Quiz 2 - Due" and "Quiz 2 -
    // Availability Ends": a deadline with the same title and the other word,
    // within a week, is the same item, and the "Due" one is kept. Items
    // that share a title and a word ("Discussion post - Due" every week)
    // are different items.
    const word = l.parts.deadlineWord;
    const titleKey = `${courseKey}|${normalize(item.title)}`;
    if (item.kind === "assignment" && word) {
      const siblings = byTitle.get(titleKey) ?? [];
      const pair = siblings.find(
        (s) =>
          s.word && s.word !== word && s.item.at && item.at && Math.abs(s.item.at.getTime() - item.at.getTime()) <= 7 * 24 * 60 * 60 * 1000
      );
      if (pair) {
        if (word === "due") {
          pair.item.id = item.id;
          pair.item.at = item.at;
          pair.word = "due";
        }
        continue;
      }
      siblings.push({ item, word });
      byTitle.set(titleKey, siblings);
    }
    items.push(item);
  }

  const courses: FeedCourse[] = [...votes.keys()].map((key) => {
    const best = [...(votes.get(key)?.values() ?? [])].sort((a, b) => b.score - a.score)[0];
    let name: string | null = best?.name ?? null;
    if (!name && key.startsWith("feed:")) name = feedNames.get(key.slice(5)) ?? null;
    if (!name && key.startsWith("id:")) name = `${providerName} course ${key.slice(3)}`;
    return { key, name: name || `${providerName} calendar` };
  });
  // Only courses that have something in them.
  const used = new Set(items.map((i) => i.courseKey));
  return {
    courses: courses.filter((c) => used.has(c.key)).sort((a, b) => a.name.localeCompare(b.name)),
    items,
    ignored,
  };
}
