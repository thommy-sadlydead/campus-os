import { describe, it, expect } from "vitest";
import { cleanCourseName } from "../src/lib/lms/course-name";

describe("cleanCourseName", () => {
  it("drops the section and term a Canvas course name ends with", () => {
    expect(cleanCourseName("US History to 1877 (01) 2026FA")).toBe("US History to 1877");
    expect(cleanCourseName("US History to 1877 2026FA (01)")).toBe("US History to 1877");
    expect(cleanCourseName("Microeconomics (003) 2026FA")).toBe("Microeconomics");
    expect(cleanCourseName("Intro to Biology [2026FA]")).toBe("Intro to Biology");
    expect(cleanCourseName("Intro to Biology - Fall 2026")).toBe("Intro to Biology");
    expect(cleanCourseName("Organic Chemistry FA2026")).toBe("Organic Chemistry");
    expect(cleanCourseName("Organic Chemistry (Section 02)")).toBe("Organic Chemistry");
    expect(cleanCourseName("Organic Chemistry - Section 02")).toBe("Organic Chemistry");
    expect(cleanCourseName("Statistics (A)")).toBe("Statistics");
    expect(cleanCourseName("Statistics 202610")).toBe("Statistics");
  });

  it("drops a term at the front", () => {
    expect(cleanCourseName("2026FA Physics I")).toBe("Physics I");
    expect(cleanCourseName("[2026FA] Physics I")).toBe("Physics I");
    expect(cleanCourseName("Fall 2026 - Physics I")).toBe("Physics I");
  });

  it("keeps what is part of the name", () => {
    for (const name of [
      "US History to 1877",
      "Calculus II (Honors)",
      "Intro to Psychology (Online)",
      "Economics (101)",
      "Writing 1010",
      "Spanish for Health Professions",
      "Chem 101 Lab",
    ]) {
      expect(cleanCourseName(name), name).toBe(name);
    }
  });

  it("tidies spacing and trailing punctuation", () => {
    expect(cleanCourseName("  US History   to 1877 -  ")).toBe("US History to 1877");
    expect(cleanCourseName("US History to 1877 (01)  2026FA ")).toBe("US History to 1877");
  });

  it("gives the name back untouched when nothing would be left", () => {
    expect(cleanCourseName("2026FA")).toBe("2026FA");
    expect(cleanCourseName("(01) 2026FA")).toBe("(01) 2026FA");
    expect(cleanCourseName("")).toBe("");
  });

  it("is steady: cleaning a clean name changes nothing", () => {
    const once = cleanCourseName("US History to 1877 (01) 2026FA");
    expect(cleanCourseName(once)).toBe(once);
  });
});
