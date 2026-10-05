// A small iCalendar (RFC 5545) reader for LMS calendar feeds: the events
// and to-dos in a VCALENDAR, with their dates as instants. Pure (no network,
// no Prisma), tested in tests/lms-ics.test.ts. Handles line folding,
// escaped text, parameters (quoted or not), UTC/TZID/floating times and
// all-day dates; skips nested components (alarms) and time zone
// definitions, relying on TZID being an IANA name, which LMS feeds use.

import { fromZonedTime } from "date-fns-tz";

export interface IcsDate {
  date: Date;
  /** A date with no time (VALUE=DATE). `date` is then the end of that day, in the fallback time zone. */
  allDay: boolean;
}

export interface IcsEvent {
  kind: "event" | "todo";
  uid: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  categories: string[];
  start: IcsDate | null;
  end: IcsDate | null;
  /** A to-do's due date. */
  due: IcsDate | null;
  /** Every property, by upper-case name, first value only: for LMS-specific X- fields. */
  props: Record<string, string>;
}

export interface IcsCalendar {
  /** X-WR-CALNAME: the calendar's own name, when it has one. */
  name: string | null;
  events: IcsEvent[];
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Joins folded lines: a line starting with a space or tab continues the one before. */
function unfold(text: string): string[] {
  return text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): ContentLine | null {
  // The value starts after the first colon that isn't inside a quoted
  // parameter value.
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let current = "";
  inQuotes = false;
  for (const c of head) {
    if (c === '"') inQuotes = !inQuotes;
    if (c === ";" && !inQuotes) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  parts.push(current);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value };
}

/** TEXT values: \\ \; \, and \n are escapes. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * A DATE or DATE-TIME value as an instant. UTC ("…Z") is exact; a TZID
 * that's an IANA zone is honored; anything else (a floating time, a
 * Windows zone name) is read in `fallbackTz`, the student's own zone. A
 * date with no time is a whole day: it becomes 11:59 PM that day, which
 * is how a due date reads.
 */
export function parseIcsDate(value: string, params: Record<string, string>, fallbackTz: string): IcsDate | null {
  const v = value.trim();
  const dateOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly || params.VALUE === "DATE") {
    const m = dateOnly ?? v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    const date = fromZonedTime(`${m[1]}-${m[2]}-${m[3]}T23:59:00`, fallbackTz);
    return Number.isNaN(date.getTime()) ? null : { date, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}`;
  let date: Date;
  if (m[7]) date = new Date(`${local}Z`);
  else {
    const tz = params.TZID && isTimeZone(params.TZID) ? params.TZID : fallbackTz;
    date = fromZonedTime(local, tz);
  }
  return Number.isNaN(date.getTime()) ? null : { date, allDay: false };
}

/** The events and to-dos in an iCalendar file. Malformed lines and components are skipped, never thrown. */
export function parseIcs(text: string, fallbackTz: string): IcsCalendar {
  const calendar: IcsCalendar = { name: null, events: [] };
  let current: { kind: "event" | "todo"; lines: ContentLine[] } | null = null;
  let depth = 0; // nesting inside the current event (VALARM)

  for (const raw of unfold(text)) {
    if (!raw.trim()) continue;
    const line = parseLine(raw);
    if (!line) continue;

    if (line.name === "BEGIN") {
      const type = line.value.trim().toUpperCase();
      if (!current && (type === "VEVENT" || type === "VTODO")) {
        current = { kind: type === "VEVENT" ? "event" : "todo", lines: [] };
        depth = 0;
      } else if (current) depth += 1;
      continue;
    }
    if (line.name === "END") {
      const type = line.value.trim().toUpperCase();
      if (current && depth > 0) depth -= 1;
      else if (current && (type === "VEVENT" || type === "VTODO")) {
        const event = toEvent(current.kind, current.lines, fallbackTz);
        if (event) calendar.events.push(event);
        current = null;
      }
      continue;
    }
    if (current) {
      if (depth === 0) current.lines.push(line);
    } else if (line.name === "X-WR-CALNAME" && !calendar.name) {
      calendar.name = unescapeText(line.value).trim() || null;
    }
  }
  return calendar;
}

function toEvent(kind: "event" | "todo", lines: ContentLine[], fallbackTz: string): IcsEvent | null {
  const first = (name: string) => lines.find((l) => l.name === name);
  const text = (name: string) => {
    const line = first(name);
    const value = line ? unescapeText(line.value).trim() : "";
    return value || null;
  };
  const date = (name: string) => {
    const line = first(name);
    return line ? parseIcsDate(line.value, line.params, fallbackTz) : null;
  };

  const summary = text("SUMMARY");
  if (!summary) return null;
  const props: Record<string, string> = {};
  for (const l of lines) if (!(l.name in props)) props[l.name] = unescapeText(l.value);

  return {
    kind,
    uid: text("UID"),
    summary,
    description: text("DESCRIPTION"),
    location: text("LOCATION"),
    url: first("URL")?.value.trim() || null,
    categories: lines
      .filter((l) => l.name === "CATEGORIES")
      .flatMap((l) => l.value.split(/(?<!\\),/).map((c) => unescapeText(c).trim()))
      .filter(Boolean),
    start: date("DTSTART"),
    end: date("DTEND"),
    due: date("DUE"),
    props,
  };
}
