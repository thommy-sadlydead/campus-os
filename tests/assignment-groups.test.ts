import { describe, expect, it } from "vitest";
import { groupAssignments, type GroupableAssignment } from "../src/lib/assignment-groups";

const now = new Date("2026-09-30T12:00:00Z");
const a = (name: string, dueAt: string | null, status: GroupableAssignment["status"] = "NOT_STARTED") => ({
  name,
  dueAt,
  status,
});

describe("groupAssignments", () => {
  const items = [
    a("old essay", "2026-09-01T23:59:00Z"),
    a("yesterday quiz", "2026-09-29T23:59:00Z"),
    a("next week paper", "2026-10-07T23:59:00Z"),
    a("tomorrow reading", "2026-10-01T23:59:00Z"),
    a("no date project", null),
    a("submitted lab", "2026-09-28T23:59:00Z", "SUBMITTED"),
    a("graded test", "2026-09-20T23:59:00Z", "GRADED"),
    a("undated done", null, "SUBMITTED"),
    a("in progress, overdue", "2026-09-25T23:59:00Z", "IN_PROGRESS"),
  ];
  const groups = groupAssignments(items, now);

  it("puts unfinished past-due work in overdue, most recent first", () => {
    expect(groups.overdue.map((x) => x.name)).toEqual(["yesterday quiz", "in progress, overdue", "old essay"]);
  });

  it("lists upcoming work soonest first with undated work last", () => {
    expect(groups.upcoming.map((x) => x.name)).toEqual(["tomorrow reading", "next week paper", "no date project"]);
  });

  it("collects submitted and graded work, most recent first, undated last", () => {
    expect(groups.done.map((x) => x.name)).toEqual(["submitted lab", "graded test", "undated done"]);
  });

  it("keeps every assignment exactly once", () => {
    expect(groups.overdue.length + groups.upcoming.length + groups.done.length).toBe(items.length);
  });
});
