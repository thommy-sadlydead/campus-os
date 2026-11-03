import "server-only";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { requestOrigin } from "@/lib/billing-server";
import { randomToken } from "@/lib/oauth/oauth";
import { buildCalendarFeed } from "@/lib/calendar-feed";

// The secret calendar link behind Schedule → Add to your calendar (the
// CalendarFeed model), and the feed it serves (calendar-feed.ts).

export interface CalendarLinks {
  /** For copying into Outlook or any other calendar. */
  https: string;
  /** Opens Apple Calendar's subscribe sheet (on a Mac, iPhone or iPad). */
  webcal: string;
  /** Google Calendar's "add this calendar" page for the link. */
  google: string;
}

function linksFor(origin: string, token: string): CalendarLinks {
  const https = `${origin}/calendar/${token}.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return { https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

/** The student's calendar links, or null if they haven't made one. */
export async function calendarLinksFor(userId: string): Promise<CalendarLinks | null> {
  const feed = await prisma.calendarFeed.findUnique({ where: { userId } });
  if (!feed) return null;
  return linksFor(await requestOrigin(), decryptSecret(feed.tokenEnc));
}

/** Makes the student's calendar link, or a new one in place of the old (which then stops working). */
export async function newCalendarLink(userId: string): Promise<void> {
  const token = randomToken();
  const data = { tokenHash: hashToken(token), tokenEnc: encryptSecret(token) };
  await prisma.calendarFeed.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

/** The .ics text for a calendar link's token, or null when no link has it. */
export async function calendarFeedFor(token: string): Promise<{ userId: string; ics: string } | null> {
  const feed = await prisma.calendarFeed.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, timezone: true } } },
  });
  if (!feed) return null;

  const [events, origin] = await Promise.all([
    prisma.scheduleEvent.findMany({
      where: { class: { userId: feed.userId, archived: false } },
      include: { class: { select: { id: true, name: true, code: true, room: true } } },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
    requestOrigin(),
  ]);

  const ics = buildCalendarFeed({
    tz: feed.user.timezone,
    now: new Date(),
    meetings: events.map((e) => ({
      id: e.id,
      className: e.class.name,
      classCode: e.class.code || null,
      classUrl: `${origin}/classes/${e.class.id}`,
      dayOfWeek: e.dayOfWeek,
      startMinute: e.startMinute,
      endMinute: e.endMinute,
      location: e.location ?? e.class.room,
      label: e.label,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      createdAt: e.createdAt,
    })),
  });
  return { userId: feed.userId, ics };
}
