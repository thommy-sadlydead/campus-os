import { describe, expect, it } from "vitest";
import {
  brightspaceReader,
  gradedItemIds,
  mapEnrollments,
  mapToc,
  mapWork,
  pickVersion,
  submissionFromEntities,
} from "../chrome-extension/src/lms/brightspace.js";
import { SessionError, makeLmsFetch } from "../chrome-extension/src/lms/common.js";

// Shapes from D2L's Valence API reference (enrollments, dropbox, quizzes,
// grades, content). The site is made up: nothing here is one school's.
const ORIGIN = "https://lms.example.edu";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("pickVersion", () => {
  it("takes the latest version the site lists for a product", () => {
    const versions = [
      { ProductCode: "lp", LatestVersion: "1.47", SupportedVersions: ["1.46", "1.47"] },
      { ProductCode: "le", LatestVersion: "1.74", SupportedVersions: ["1.74"] },
    ];
    expect(pickVersion(versions, "lp")).toBe("1.47");
    expect(pickVersion(versions, "le")).toBe("1.74");
    expect(pickVersion(versions, "bas")).toBeNull();
    expect(pickVersion(null, "lp")).toBeNull();
  });
});

describe("mapEnrollments", () => {
  const item = (id: number, code: string, typeId: number, extra: object = {}) => ({
    OrgUnit: { Id: id, Name: `Course ${id}`, Code: `C-${id}`, Type: { Id: typeId, Code: code } },
    Access: { IsActive: true, CanAccess: true },
    ...extra,
  });

  it("keeps course offerings the student can open", () => {
    const courses = mapEnrollments([
      item(101, "Course Offering", 3),
      item(102, "Semester", 5),
      item(103, "Course Offering", 3, { Access: { IsActive: true, CanAccess: false } }),
    ]);
    expect(courses).toEqual([{ id: "101", name: "Course 101", code: "C-101" }]);
  });

  it("falls back to anything that isn't clearly not a course on a site that renamed the type", () => {
    const courses = mapEnrollments([item(201, "Class", 41), item(202, "Department", 2)]);
    expect(courses.map((c: { id: string }) => c.id)).toEqual(["201"]);
  });
});

describe("work", () => {
  it("knows submitted from graded from not yet", () => {
    expect(submissionFromEntities([{ Status: 0, Submissions: [] }])).toBe("unsubmitted");
    expect(submissionFromEntities([{ Status: 1, Submissions: [{ Id: 1 }] }])).toBe("submitted");
    expect(submissionFromEntities([{ Status: 3, Submissions: [{ Id: 1 }] }])).toBe("graded");
    expect([...gradedItemIds([{ GradeObjectIdentifier: "55", PointsNumerator: 8 }, { GradeObjectIdentifier: "56", PointsNumerator: null }])]).toEqual(["55"]);
  });

  it("makes assignments from dropbox folders and quizzes, with links into Brightspace", () => {
    const work = mapWork({
      origin: ORIGIN,
      orgUnitId: "101",
      folders: [
        { Id: 7, Name: "Lab report 2", CustomInstructions: { Html: "<p>Write it up</p>", Text: "Write it up" }, DueDate: "2026-11-10T04:59:00.000Z", Assessment: { ScoreDenominator: 20 }, GradeItemId: 55 },
        { Id: 8, Name: "Hidden draft", IsHidden: true },
      ],
      quizzes: [{ QuizId: 3, Name: "Midterm Exam", DueDate: null, EndDate: "2026-11-12T20:00:00.000Z", GradeItemId: 99 }],
      graded: new Set(["55"]),
      submissions: new Map(),
    });
    expect(work).toHaveLength(2);
    expect(work[0]).toMatchObject({
      id: "dropbox:7",
      description: "<p>Write it up</p>",
      dueAt: "2026-11-10T04:59:00.000Z",
      pointsPossible: 20,
      submission: "graded",
      tracksSubmissions: true,
      url: `${ORIGIN}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=7&ou=101`,
    });
    expect(work[1]).toMatchObject({ id: "quiz:3", dueAt: "2026-11-12T20:00:00.000Z", isExam: true, submission: null, tracksSubmissions: false });
  });
});

describe("mapToc", () => {
  const toc = {
    Modules: [
      {
        ModuleId: 1,
        Title: "Week 1",
        Topics: [
          { TopicId: 11, Title: "Lecture 1 slides", TypeIdentifier: "File", Url: "/content/enforced/101-C/Lecture%201.pptx", LastModifiedDate: "2026-09-01T12:00:00.000Z" },
          { TopicId: 12, Title: "Reading guide", TypeIdentifier: "File", Url: "/content/enforced/101-C/guide.html" },
          { TopicId: 13, Title: "Publisher site", TypeIdentifier: "Link", Url: "https://publisher.example.com/book" },
          { TopicId: 14, Title: "Quiz 1", TypeIdentifier: "Link", Url: "/d2l/lms/quizzing/user/quiz_summary.d2l?qi=3" },
          { TopicId: 15, Title: "Locked", TypeIdentifier: "File", Url: "/content/x.pdf", IsLocked: true },
        ],
        Modules: [{ ModuleId: 2, Title: "Extra", Topics: [{ TopicId: 21, Title: "Notes", TypeIdentifier: "File", Url: "/content/enforced/101-C/notes.pdf" }] }],
      },
    ],
  };

  it("lists files and pages to read, links to record, and leaves out tool links and locked topics", () => {
    const { resources, downloads } = mapToc(toc, { origin: ORIGIN, orgUnitId: "101", le: "1.74" });
    expect(resources.map((r: { resourceId: string; resourceType: string }) => [r.resourceId, r.resourceType])).toEqual([
      ["topic:11", "file"],
      ["topic:12", "page"],
      ["topic:13", "external"],
      ["topic:21", "file"],
    ]);
    expect(resources[0]).toMatchObject({ filename: "Lecture 1.pptx", updatedAt: "2026-09-01T12:00:00.000Z" });
    expect(downloads.get("topic:11")).toBe("/d2l/api/le/1.74/101/content/topics/11/file");
    expect(downloads.has("topic:13")).toBe(false);
  });
});

describe("brightspaceReader", () => {
  function site(routes: Record<string, unknown>, seen: string[] = []) {
    return async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const key = url.pathname + url.search;
      seen.push(key);
      const body = routes[key] ?? routes[url.pathname];
      if (body === undefined) return json({ Message: "Not Found" }, 404);
      if (typeof body === "number") return json({}, body);
      return json(body);
    };
  }
  const versions = [
    { ProductCode: "lp", LatestVersion: "1.47" },
    { ProductCode: "le", LatestVersion: "1.74" },
  ];

  it("uses the site's own API versions and follows enrollment bookmarks", async () => {
    const seen: string[] = [];
    const fetchImpl = site(
      {
        "/d2l/api/versions/": versions,
        "/d2l/api/lp/1.47/users/whoami": { FirstName: "Sam", LastName: "Student" },
        "/d2l/api/lp/1.47/enrollments/myenrollments/?isActive=true&canAccess=true": {
          Items: [{ OrgUnit: { Id: 1, Name: "Biology", Code: "BIO", Type: { Id: 3, Code: "Course Offering" } }, Access: { CanAccess: true } }],
          PagingInfo: { Bookmark: "b1", HasMoreItems: true },
        },
        "/d2l/api/lp/1.47/enrollments/myenrollments/?isActive=true&canAccess=true&bookmark=b1": {
          Items: [{ OrgUnit: { Id: 2, Name: "Chemistry", Code: "CHEM", Type: { Id: 3, Code: "Course Offering" } }, Access: { CanAccess: true } }],
          PagingInfo: { HasMoreItems: false },
        },
      },
      seen
    );
    const reader = brightspaceReader(makeLmsFetch(ORIGIN, fetchImpl, { baseDelayMs: 1 }));
    expect(await reader.connect()).toEqual({ userName: "Sam Student" });
    expect((await reader.listCourses()).map((c: { name: string }) => c.name)).toEqual(["Biology", "Chemistry"]);
  });

  it("says signed out when Brightspace won't say who the student is", async () => {
    const reader = brightspaceReader(makeLmsFetch(ORIGIN, site({ "/d2l/api/versions/": versions, "/d2l/api/lp/1.47/users/whoami": 401 }), { baseDelayMs: 1 }));
    await expect(reader.connect()).rejects.toBeInstanceOf(SessionError);
  });

  it("reports a course whose tools are off instead of failing the sync", async () => {
    const reader = brightspaceReader(
      makeLmsFetch(
        ORIGIN,
        site({
          "/d2l/api/versions/": versions,
          "/d2l/api/lp/1.47/users/whoami": { UniqueName: "sam" },
          "/d2l/api/le/1.74/9/dropbox/folders/": 403,
          "/d2l/api/le/1.74/9/quizzes/": 403,
          "/d2l/api/le/1.74/9/content/toc": 403,
        }),
        { baseDelayMs: 1 }
      )
    );
    await reader.connect();
    const work = await reader.courseWork({ id: "9", name: "Locked course", code: "" });
    expect(work.assignments).toBeNull();
    expect(work.problem).toMatch(/didn't let/);
    const materials = await reader.courseMaterials({ id: "9", name: "Locked course", code: "" });
    expect(materials).toMatchObject({ resources: [], complete: false });
  });
});
