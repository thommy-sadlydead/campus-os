import { describe, it, expect } from "vitest";
import { formatPastMoment } from "@/lib/time";

const TZ = "America/New_York";
const NOW = new Date("2026-09-30T22:00:00-04:00"); // Wednesday, 10pm ET (Thursday 2am UTC)

describe("formatPastMoment", () => {
  it("uses the student's timezone, not the server's", () => {
    // 9:41pm ET is already Thursday in UTC; it's still today in New York.
    expect(formatPastMoment(new Date("2026-10-01T01:41:00Z"), NOW, TZ)).toBe("today at 9:41 PM");
  });

  it("says yesterday for the day before", () => {
    expect(formatPastMoment(new Date("2026-09-29T08:05:00-04:00"), NOW, TZ)).toBe("yesterday at 8:05 AM");
  });

  it("gives the date for anything older, and the year only when it differs", () => {
    expect(formatPastMoment(new Date("2026-09-20T13:00:00-04:00"), NOW, TZ)).toBe("Sep 20 at 1:00 PM");
    expect(formatPastMoment(new Date("2025-12-01T13:00:00-05:00"), NOW, TZ)).toBe("Dec 1, 2025 at 1:00 PM");
  });
});
