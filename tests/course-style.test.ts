import { describe, expect, it } from "vitest";
import { courseInitials } from "@/lib/course-style";

describe("courseInitials", () => {
  it("skips Canvas section and term codes", () => {
    expect(courseInitials("Composition (06) 2026FA")).toBe("CO");
    expect(courseInitials("Microeconomics (03) 2026FA")).toBe("MI");
    expect(courseInitials("Interm Fin Acct I (01) 2026FA")).toBe("IF");
  });

  it("uses the first two meaningful words", () => {
    expect(courseInitials("Composition Workshop (02) 2026FA")).toBe("CW");
    expect(courseInitials("Statistics for Business (01) 2026FA")).toBe("SB");
    expect(courseInitials("Old Testament Literature")).toBe("OT");
  });

  it("falls back to the first two characters when no word qualifies", () => {
    expect(courseInitials("2026FA")).toBe("20");
  });
});
