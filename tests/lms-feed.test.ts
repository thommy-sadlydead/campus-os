import { describe, it, expect } from "vitest";
import { analyzeFeeds, courseIdFromUrl, feedKey, splitTitle } from "../src/lib/lms/feed-courses";
import { feedCourseInputs, previewCourses } from "../src/lib/lms/feed-sync";
import { parseIcs } from "../src/lib/lms/ics";
import { isPublicAddress, normalizeFeedUrl } from "../src/lib/lms/safe-fetch";

const TZ = "America/New_York";

// Feeds built for these tests in the shapes Brightspace and Blackboard
// can use. They aren't copies of a real school's feed.
function ics(events: string[][], name?: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...(name ? [`X-WR-CALNAME:${name}`] : []),
    ...events.flatMap((lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");
}

const D2L = "https://school.brightspace.com/d2l/le/calendar";

describe("splitTitle", () => {
  it("separates Brightspace's status words", () => {
    expect(splitTitle("Essay 1 - Due")).toMatchObject({ title: "Essay 1", marker: "deadline", deadlineWord: "due" });
    expect(splitTitle("Quiz 2 - Availability Ends")).toMatchObject({ title: "Quiz 2", marker: "deadline", deadlineWord: "ends" });
    expect(splitTitle("Quiz 2 - Availability Starts")).toMatchObject({ title: "Quiz 2", marker: "start" });
    expect(splitTitle("Due: Lab 4")).toMatchObject({ title: "Lab 4", marker: "deadline" });
    expect(splitTitle("Field trip")).toMatchObject({ title: "Field trip", marker: null, course: null });
  });

  it("finds a course code before or after the title", () => {
    expect(splitTitle("[CS 18000] Project 2")).toMatchObject({ title: "Project 2", course: "CS 18000" });
    expect(splitTitle("ENGR 13300: Homework 5")).toMatchObject({ title: "Homework 5", course: "ENGR 13300" });
    expect(splitTitle("Homework 5 - ENGR 13300 - Due")).toMatchObject({ title: "Homework 5", course: "ENGR 13300", marker: "deadline" });
  });

  it("doesn't mistake an ordinary dash for a course", () => {
    expect(splitTitle("Chapter 4 - Reading")).toMatchObject({ title: "Chapter 4 - Reading", course: null });
  });
});

describe("courseIdFromUrl", () => {
  it("reads Brightspace org units and Blackboard course ids", () => {
    expect(courseIdFromUrl(`${D2L}/123456/event/9/detailsview#9`, "brightspace")).toBe("123456");
    expect(courseIdFromUrl("https://school.brightspace.com/d2l/lms/dropbox/user/folder_submit_files.d2l?db=5&ou=654321", "brightspace")).toBe("654321");
    expect(courseIdFromUrl("https://learn.school.edu/ultra/courses/_12345_1/outline", "blackboard")).toBe("_12345_1");
    expect(courseIdFromUrl("https://learn.school.edu/webapps/blackboard/execute/launcher?type=Course&course_id=_777_1", "blackboard")).toBe("_777_1");
    expect(courseIdFromUrl("https://example.com/whatever", "brightspace")).toBeNull();
  });
});

describe("analyzeFeeds", () => {
  it("groups a Brightspace feed by the course in each link, named by its location", () => {
    const feed = parseIcs(
      ics([
        ["UID:1", "SUMMARY:Essay 1 - Due", "DTSTART:20261015T035900Z", "DTEND:20261015T035900Z", `URL:${D2L}/111/event/1/detailsview`, "LOCATION:ENG 1400 - Composition"],
        ["UID:2", "SUMMARY:Quiz 2 - Availability Starts", "DTSTART:20261010T120000Z", "DTEND:20261010T120000Z", `URL:${D2L}/111/event/2/detailsview`, "LOCATION:ENG 1400 - Composition"],
        ["UID:3", "SUMMARY:Quiz 2 - Availability Ends", "DTSTART:20261017T035900Z", "DTEND:20261017T035900Z", `URL:${D2L}/111/event/3/detailsview`, "LOCATION:ENG 1400 - Composition"],
        ["UID:4", "SUMMARY:Lab 3 - Due", "DTSTART:20261016T035900Z", `URL:${D2L}/222/event/4/detailsview`, "LOCATION:BIO 1000 - Biology"],
        // An instructor's event with a room as its location, in the same course.
        ["UID:5", "SUMMARY:Midterm Exam", "DTSTART:20261020T140000Z", "DTEND:20261020T153000Z", `URL:${D2L}/222/event/5/detailsview`, "LOCATION:Room 210"],
        ["UID:6", "SUMMARY:Office hours", "DTSTART:20261020T160000Z", "DTEND:20261020T170000Z", `URL:${D2L}/222/event/6/detailsview`],
      ]),
      TZ
    );

    const analysis = analyzeFeeds("brightspace", [{ key: "f1", calendar: feed }]);

    expect(analysis.courses).toEqual([
      { key: "id:222", name: "BIO 1000 - Biology" },
      { key: "id:111", name: "ENG 1400 - Composition" },
    ]);
    expect(analysis.items.map((i) => [i.courseKey, i.kind, i.title, i.isExam])).toEqual([
      ["id:111", "assignment", "Essay 1", false],
      ["id:111", "assignment", "Quiz 2", false],
      ["id:222", "assignment", "Lab 3", false],
      ["id:222", "exam", "Midterm Exam", true],
    ]);
    expect(analysis.items.find((i) => i.kind === "exam")).toMatchObject({ id: "event:5", location: "Room 210" });
    // The "starts" marker and office hours aren't work.
    expect(analysis.ignored).toBe(2);
  });

  it("keeps a quiz's Due date over its Availability Ends, but keeps weekly items with the same name", () => {
    const feed = parseIcs(
      ics([
        ["UID:a", "SUMMARY:[HIST 1100] Quiz 1 - Availability Ends", "DTSTART:20261018T035900Z"],
        ["UID:b", "SUMMARY:[HIST 1100] Quiz 1 - Due", "DTSTART:20261017T035900Z"],
        ["UID:c", "SUMMARY:[HIST 1100] Discussion post - Due", "DTSTART:20261010T035900Z"],
        ["UID:d", "SUMMARY:[HIST 1100] Discussion post - Due", "DTSTART:20261017T035900Z"],
      ]),
      TZ
    );

    const { courses, items } = analyzeFeeds("brightspace", [{ key: "f1", calendar: feed }]);

    expect(courses).toEqual([{ key: "name:hist 1100", name: "HIST 1100" }]);
    expect(items.map((i) => [i.id, i.title, i.at?.toISOString()])).toEqual([
      ["b", "Quiz 1", "2026-10-17T03:59:00.000Z"],
      ["c", "Discussion post", "2026-10-10T03:59:00.000Z"],
      ["d", "Discussion post", "2026-10-17T03:59:00.000Z"],
    ]);
  });

  it("treats Blackboard deadlines as items that start and end at once, and skips class meetings", () => {
    const feed = parseIcs(
      ics([
        ["UID:x1", "SUMMARY:Homework 3", "DTSTART:20261015T035900Z", "DTEND:20261015T035900Z", "URL:https://learn.school.edu/ultra/courses/_55_1/outline"],
        ["UID:x2", "SUMMARY:Class meeting", "DTSTART:20261015T140000Z", "DTEND:20261015T145000Z", "URL:https://learn.school.edu/ultra/courses/_55_1/outline"],
        ["UID:x3", "SUMMARY:Fall break", "DTSTART;VALUE=DATE:20261016", "URL:https://learn.school.edu/ultra/courses/_55_1/outline"],
      ]),
      TZ
    );

    const analysis = analyzeFeeds("blackboard", [{ key: "f1", calendar: feed }]);

    expect(analysis.courses).toEqual([{ key: "id:_55_1", name: "Blackboard course _55_1" }]);
    expect(analysis.items.map((i) => i.title)).toEqual(["Homework 3"]);
    expect(analysis.ignored).toBe(2);
  });

  it("keeps a feed with no course information together as one class, named after the calendar", () => {
    const one = parseIcs(ics([["UID:1", "SUMMARY:Essay - Due", "DTSTART:20261015T035900Z"]], "PSYC 2000 Calendar"), TZ);
    const two = parseIcs(ics([["UID:2", "SUMMARY:Lab - Due", "DTSTART:20261015T035900Z"]]), TZ);

    const analysis = analyzeFeeds("brightspace", [
      { key: "one", calendar: one },
      { key: "two", calendar: two },
    ]);

    expect(analysis.courses).toEqual([
      { key: "feed:two", name: "Brightspace calendar" },
      { key: "feed:one", name: "PSYC 2000 Calendar" },
    ]);
  });

  it("joins items that only name the course to the course their name was seen with", () => {
    const feed = parseIcs(
      ics([
        ["UID:1", "SUMMARY:Essay - Due", "DTSTART:20261015T035900Z", `URL:${D2L}/111/event/1/x`, "CATEGORIES:ENG 1400"],
        ["UID:2", "SUMMARY:Reading - Due", "DTSTART:20261016T035900Z", "CATEGORIES:ENG 1400"],
      ]),
      TZ
    );
    const analysis = analyzeFeeds("brightspace", [{ key: "f", calendar: feed }]);
    expect(analysis.courses).toEqual([{ key: "id:111", name: "ENG 1400" }]);
    expect(analysis.items.every((i) => i.courseKey === "id:111")).toBe(true);
  });

  it("gives an item without a UID a stable id", () => {
    const feed = () => parseIcs(ics([["SUMMARY:Essay - Due", "DTSTART:20261015T035900Z"]]), TZ);
    const first = analyzeFeeds("brightspace", [{ key: "f", calendar: feed() }]).items[0].id;
    const second = analyzeFeeds("brightspace", [{ key: "f", calendar: feed() }]).items[0].id;
    expect(first).toBe(second);
  });
});

describe("feedCourseInputs and previewCourses", () => {
  const feed = parseIcs(
    ics([
      ["UID:1", "SUMMARY:[BIO 1000] Lab 1 - Due", "DTSTART:20261015T035900Z", "URL:javascript:alert(1)"],
      ["UID:2", "SUMMARY:[BIO 1000] Exam 1 - Due", "DTSTART:20261020T035900Z", `URL:${D2L}/5/event/2/x`],
      ["UID:3", "SUMMARY:[CHEM 1100] Problem set - Due", "DTSTART:20261015T035900Z"],
    ]),
    TZ
  );
  const analysis = analyzeFeeds("brightspace", [{ key: "f", calendar: feed }]);

  it("shows each course with counts and a few items", () => {
    expect(previewCourses(analysis)).toEqual([
      { key: "id:5", name: "BIO 1000", assignments: 2, exams: 1, samples: ["Lab 1", "Exam 1"] },
      { key: "name:chem 1100", name: "CHEM 1100", assignments: 1, exams: 0, samples: ["Problem set"] },
    ]);
  });

  it("applies the student's names and skips, and drops links that aren't http(s)", () => {
    const inputs = feedCourseInputs("brightspace", analysis, {
      courses: { "id:5": { name: "Biology" }, "name:chem 1100": { skip: true } },
    });
    expect(inputs.map((c) => c.name)).toEqual(["Biology"]);
    expect(inputs[0].assignments?.map((a) => [a.name, a.url, a.isExam, a.submission])).toEqual([
      ["Lab 1", null, false, null],
      ["Exam 1", `${D2L}/5/event/2/x`, true, null],
    ]);
  });
});

describe("feed links", () => {
  it("cleans up a pasted link", () => {
    expect(normalizeFeedUrl("webcal://school.brightspace.com/d2l/le/calendar/feed/user/feed.ics?token=abc")).toBe(
      "https://school.brightspace.com/d2l/le/calendar/feed/user/feed.ics?token=abc"
    );
    expect(normalizeFeedUrl("http://learn.school.edu/webapps/calendar/calendarFeed/abc/learn.ics")).toBe(
      "https://learn.school.edu/webapps/calendar/calendarFeed/abc/learn.ics"
    );
    expect(normalizeFeedUrl("  ")).toBeNull();
    expect(normalizeFeedUrl("ftp://example.com/feed.ics")).toBeNull();
    expect(normalizeFeedUrl("https://user:pass@example.com/feed.ics")).toBeNull();
  });

  it("identifies a feed without keeping its link", () => {
    expect(feedKey("https://a.test/feed.ics?token=1")).toMatch(/^[0-9a-f]{12}$/);
    expect(feedKey("https://a.test/feed.ics?token=1")).not.toBe(feedKey("https://a.test/feed.ics?token=2"));
  });

  it("only fetches public addresses", () => {
    for (const ip of ["8.8.8.8", "104.16.1.1", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not an ip"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe("analyzeFeeds with item types in CATEGORIES", () => {
  it("doesn't name courses after a category every course shares", () => {
    const feed = parseIcs(
      ics([
        ["UID:1", "SUMMARY:Homework 1", "DTSTART:20261015T035900Z", "URL:https://learn.school.edu/ultra/courses/_1_1/outline", "CATEGORIES:Assignment"],
        ["UID:2", "SUMMARY:Homework 2", "DTSTART:20261016T035900Z", "URL:https://learn.school.edu/ultra/courses/_1_1/outline", "CATEGORIES:Assignment", "LOCATION:MATH 2500"],
        ["UID:3", "SUMMARY:Essay", "DTSTART:20261017T035900Z", "URL:https://learn.school.edu/ultra/courses/_2_1/outline", "CATEGORIES:Assignment"],
        ["UID:4", "SUMMARY:Reading", "DTSTART:20261018T035900Z", "CATEGORIES:Online"],
        ["UID:5", "SUMMARY:Lab", "DTSTART:20261018T035900Z", "URL:https://learn.school.edu/ultra/courses/_2_1/outline", "CATEGORIES:Online"],
        ["UID:6", "SUMMARY:Quiz", "DTSTART:20261019T035900Z", "URL:https://learn.school.edu/ultra/courses/_1_1/outline", "CATEGORIES:Online"],
      ]),
      TZ
    );

    const { courses } = analyzeFeeds("blackboard", [{ key: "f", calendar: feed }]);

    expect(courses.map((c) => c.name)).not.toContain("Assignment");
    expect(courses.map((c) => c.name)).not.toContain("Online");
    expect(courses).toContainEqual({ key: "id:_1_1", name: "MATH 2500" });
  });
});
