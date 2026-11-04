import { describe, expect, it } from "vitest";
import { campusHelpLinks, parseSyllabusHelp, professorEmailDraft, professorGreeting, schoolDomainFromEmail } from "../src/lib/get-help";

describe("professorGreeting", () => {
  it("keeps a title, adds Professor to a plain name, and copes with none", () => {
    expect(professorGreeting("Dr. Jane Smith")).toBe("Hello Dr. Jane Smith,");
    expect(professorGreeting("Jane Smith")).toBe("Hello Professor Smith,");
    expect(professorGreeting(null)).toBe("Hello Professor,");
  });
});

describe("professorEmailDraft", () => {
  const base = { className: "Microeconomics", classCode: "ECON-2330", professor: "Jane Smith", studentName: "Reece Broderick", officeHours: "Tue 2–3 PM" };

  it("writes a grade check-in that asks for office hours", () => {
    const { subject, body } = professorEmailDraft({ ...base, reason: "grade" });
    expect(subject).toBe("Checking in about my grade in ECON-2330 (Microeconomics)");
    expect(body).toContain("Hello Professor Smith,");
    expect(body).toContain("office hours (Tue 2–3 PM)");
    expect(body.endsWith("Thank you,\nReece Broderick")).toBe(true);
  });

  it("names the exam, and leaves blanks for the student without a name", () => {
    const { subject, body } = professorEmailDraft({ ...base, studentName: null, officeHours: null, reason: "exam", examName: "Midterm 2" });
    expect(subject).toContain("Midterm 2");
    expect(body).toContain("Could I come by your office hours");
    expect(body).toContain("[Your name]");
  });
});

describe("campus help", () => {
  it("only searches a school site, from a school email", () => {
    expect(schoolDomainFromEmail("rb@students.cedarville.edu")).toBe("cedarville.edu");
    expect(schoolDomainFromEmail("rb@gmail.com")).toBeNull();
    expect(campusHelpLinks("rb@gmail.com")).toEqual([]);
    expect(campusHelpLinks("rb@cedarville.edu")[0].url).toBe("https://www.google.com/search?q=site%3Acedarville.edu%20tutoring%20center");
  });
});

describe("parseSyllabusHelp", () => {
  it("keeps a real email and a one-line office hours", () => {
    expect(parseSyllabusHelp({ professorEmail: " jsmith@cedarville.edu ", officeHours: "Tue  2–3 PM,\nENS 210" })).toEqual({
      professorEmail: "jsmith@cedarville.edu",
      officeHours: "Tue 2–3 PM, ENS 210",
    });
  });

  it("drops anything that isn't", () => {
    expect(parseSyllabusHelp({ professorEmail: "ask in class", officeHours: 5 })).toEqual({ professorEmail: null, officeHours: null });
    expect(parseSyllabusHelp(null)).toEqual({ professorEmail: null, officeHours: null });
  });
});
