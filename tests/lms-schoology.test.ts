import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeSchoologyDomain,
  parseSchoologyDate,
  schoologyAuthHeader,
  SchoologyClient,
  fetchSchoologyMe,
} from "../src/lib/lms/schoology";
import { schoologyClassNames, syncSchoologyForUser } from "../src/lib/lms/schoology-sync";
import { createFakePrisma } from "./helpers/fake-prisma";

const API = "https://api.schoology.com/v1";
const DOMAIN = "https://app.schoology.com";
const NOW = new Date("2026-10-05T16:00:00Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("schoologyAuthHeader", () => {
  it("matches Schoology's own two-legged PLAINTEXT example", () => {
    expect(schoologyAuthHeader("dpf43f3p2l4k3l03", "kd94hf93k423kf44", "kllo9940pd9333jh", 1200376800)).toBe(
      'OAuth realm="Schoology API", oauth_consumer_key="dpf43f3p2l4k3l03", oauth_token="", oauth_nonce="kllo9940pd9333jh", ' +
        'oauth_timestamp="1200376800", oauth_signature_method="PLAINTEXT", oauth_version="1.0", oauth_signature="kd94hf93k423kf44%26"'
    );
  });

  it("percent-encodes a secret with reserved characters, twice as OAuth requires", () => {
    expect(schoologyAuthHeader("key", "a&b c", "n", 1)).toContain('oauth_signature="a%2526b%2520c%26"');
  });
});

describe("parseSchoologyDate", () => {
  it("reads Schoology's local times in the account's time zone", () => {
    expect(parseSchoologyDate("2026-10-08 23:59:00", "America/New_York")?.toISOString()).toBe("2026-10-09T03:59:00.000Z");
    expect(parseSchoologyDate("2026-10-08 23:59:00", "America/Los_Angeles")?.toISOString()).toBe("2026-10-09T06:59:00.000Z");
  });

  it("treats empty and zero dates as no date, and a bare date as the end of that day", () => {
    expect(parseSchoologyDate("", "America/New_York")).toBeNull();
    expect(parseSchoologyDate("0000-00-00 00:00:00", "America/New_York")).toBeNull();
    expect(parseSchoologyDate("2026-10-08", "America/New_York")?.toISOString()).toBe("2026-10-09T03:59:00.000Z");
  });
});

describe("normalizeSchoologyDomain", () => {
  it("keeps just the school's address", () => {
    expect(normalizeSchoologyDomain("lms.district.org/home")).toBe("https://lms.district.org");
    expect(normalizeSchoologyDomain("https://App.Schoology.com/api")).toBe("https://app.schoology.com");
    expect(normalizeSchoologyDomain("schoology")).toBeNull();
    expect(normalizeSchoologyDomain("")).toBeNull();
  });
});

describe("schoologyClassNames", () => {
  it("uses the course title, and adds the section only when one course has two", () => {
    const names = schoologyClassNames([
      { id: 1, course_title: "Biology", course_code: "BIO1", section_title: "Period 2" },
      { id: 2, course_title: "Art", section_code: "ART-3", section_title: "Period 4" },
      { id: 3, course_title: "Art", section_title: "Period 6" },
    ]);
    expect([...names.values()]).toEqual([
      { name: "Biology", code: "BIO1" },
      { name: "Art (Period 4)", code: "ART-3" },
      { name: "Art (Period 6)", code: "" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// A fake Schoology API, routed by path. Each consumer key is one student.
// ---------------------------------------------------------------------------

type Handler = (url: URL, key: string | null) => Response | Promise<Response>;

function stubSchoology(handler: Handler) {
  const calls: { url: string; auth: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      calls.push({ url: url.toString(), auth });
      const key = auth?.match(/oauth_consumer_key="([^"]+)"/)?.[1] ?? null;
      return handler(url, key);
    })
  );
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("SchoologyClient", () => {
  it("follows /users/me's redirect with a fresh signature, and never sends the key elsewhere", async () => {
    const calls = stubSchoology((url) => {
      if (url.pathname === "/v1/users/me") return new Response(null, { status: 303, headers: { location: `${API}/users/42` } });
      if (url.pathname === "/v1/users/42") return json({ id: 42, uid: "42", tz_name: "America/Chicago" });
      if (url.pathname === "/v1/attachment/9/source/a.pdf") return new Response(null, { status: 302, headers: { location: "https://files.example.com/a.pdf?sig=1" } });
      if (url.hostname === "files.example.com") return new Response("PDFDATA");
      return json({}, 404);
    });
    const client = new SchoologyClient({ consumerKey: "k", consumerSecret: "s", domain: DOMAIN });

    expect(await fetchSchoologyMe(client)).toMatchObject({ id: 42, tz_name: "America/Chicago" });
    const res = await client.get(`${API}/attachment/9/source/a.pdf`);
    expect(await res.text()).toBe("PDFDATA");

    expect(calls.map((c) => [new URL(c.url).hostname + new URL(c.url).pathname, c.auth !== null])).toEqual([
      ["api.schoology.com/v1/users/me", true],
      ["api.schoology.com/v1/users/42", true],
      ["api.schoology.com/v1/attachment/9/source/a.pdf", true],
      ["files.example.com/a.pdf", false],
    ]);
    const nonces = calls.filter((c) => c.auth).map((c) => c.auth!.match(/oauth_nonce="([^"]+)"/)![1]);
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it("waits out a 429 and follows list pages", async () => {
    let first = true;
    stubSchoology((url) => {
      if (first) {
        first = false;
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      if (url.searchParams.get("start") === "0") return json({ section: [{ id: 1 }], links: { next: `${API}/users/7/sections?start=200&limit=200` } });
      return json({ section: [{ id: 2 }], links: {} });
    });
    const client = new SchoologyClient({ consumerKey: "k", consumerSecret: "s", domain: DOMAIN });
    expect(await client.getList("/users/7/sections", "section")).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe("syncSchoologyForUser", () => {
  function student(overrides: { gradeItems?: Record<string, unknown>[]; failSection?: string; submittedIds?: string[]; grades?: unknown[] }) {
    return (url: URL): Response => {
      const path = url.pathname.replace(/^\/v1/, "");
      if (path === "/users/7/sections") {
        return json({ section: [{ id: 100, course_title: "Biology", course_code: "BIO1" }, { id: 200, course_title: "Art" }] });
      }
      if (path === `/sections/${overrides.failSection}/grade_items`) return json({}, 403);
      if (path === `/sections/${overrides.failSection}/assignments`) return json({}, 403);
      if (path === "/sections/100/grade_items") return json({ assignment: overrides.gradeItems ?? [] });
      if (path === "/sections/200/grade_items") return json({ assignment: [{ id: 9, title: "Sketch", due: "2026-10-09 23:59:00", type: "assignment" }] });
      if (path === "/users/7/grades") {
        return json({ section: [{ section_id: url.searchParams.get("section_id"), period: [{ assignment: overrides.grades ?? [] }] }] });
      }
      const submission = path.match(/^\/sections\/\d+\/submissions\/(\d+)\/7$/);
      if (submission) {
        return overrides.submittedIds?.includes(submission[1]) ? json({ revision: [{ revision_id: 1, draft: 0 }] }) : json({}, 404);
      }
      if (path === "/sections/100/events") {
        return json({ event: [{ id: 55, title: "Unit 2 Exam", start: "2026-10-20 09:00:00", type: "event" }, { id: 56, title: "Lab 1", type: "assignment" }] });
      }
      if (path.endsWith("/events")) return json({ event: [] });
      return json({}, 404);
    };
  }

  const settings = { userId: "7", timezone: "America/New_York" };
  const client = () => new SchoologyClient({ consumerKey: "k", consumerSecret: "s", domain: DOMAIN });

  it("brings in every section with its work, grades and exams", async () => {
    stubSchoology(
      student({
        gradeItems: [
          { id: 1, title: "Lab 1", due: "2026-10-07 23:59:00", max_points: "10", allow_dropbox: "1", type: "assignment" },
          { id: 2, title: "Lab 2", due: "2026-10-12 23:59:00", max_points: "10", allow_dropbox: "1", type: "assignment" },
          { id: 3, title: "Quiz 1", due: "2026-10-01 10:00:00", type: "assessment" },
          { id: 4, title: "Semester 1 Final", due: "2026-12-15 08:00:00", is_final: "1", type: "assessment" },
          { id: 5, title: "Hidden draft", published: 0 },
        ],
        grades: [{ assignment_id: 3, grade: 9 }],
        submittedIds: ["1"],
      })
    );
    const { prisma, db } = createFakePrisma();

    const report = await syncSchoologyForUser(prisma, "me", client(), settings, NOW);

    expect(report.classes.map((c) => [c.name, c.assignments, c.exams])).toEqual([
      ["Biology", 4, 2],
      ["Art", 1, 0],
    ]);
    const bio = db.class.find((c) => c.name === "Biology")!;
    expect(bio).toMatchObject({ lmsProvider: "schoology", lmsCourseId: "100", code: "BIO1" });
    const byName = Object.fromEntries(db.assignment.filter((a) => a.classId === bio.id).map((a) => [a.name, a]));
    expect(byName["Lab 1"]).toMatchObject({ status: "SUBMITTED", lmsSubmission: "submitted", lmsUrl: `${DOMAIN}/assignment/1`, pointsPossible: 10 });
    expect(byName["Lab 2"]).toMatchObject({ status: "NOT_STARTED", lmsSubmission: "unsubmitted" });
    expect(byName["Quiz 1"]).toMatchObject({ status: "GRADED", lmsSubmission: "graded" });
    expect((byName["Lab 1"].dueAt as Date).toISOString()).toBe("2026-10-08T03:59:00.000Z");
    expect(byName["Hidden draft"]).toBeUndefined();
    expect(db.exam.map((e) => [e.name, e.lmsItemId])).toEqual([
      ["Semester 1 Final", "4"],
      ["Unit 2 Exam", "event:55"],
    ]);
  });

  it("still brings in the class when its assignments can't be read, and says why", async () => {
    stubSchoology(student({ failSection: "100" }));
    const { prisma, db } = createFakePrisma();

    const report = await syncSchoologyForUser(prisma, "me", client(), settings, NOW);

    expect(db.class.map((c) => c.name)).toEqual(["Biology", "Art"]);
    expect(report.classes[0]).toMatchObject({ name: "Biology", problem: expect.stringMatching(/isn't letting this key/) });
    expect(report.classes[1]).toMatchObject({ name: "Art", assignments: 1 });
  });

  it("stops with an error only when Schoology won't list the sections", async () => {
    stubSchoology(() => json({}, 401));
    const { prisma } = createFakePrisma();
    await expect(syncSchoologyForUser(prisma, "me", client(), settings, NOW)).rejects.toMatchObject({ status: 401 });
  });
});
