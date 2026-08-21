import { describe, it, expect } from "vitest";
import { matchClassId, classifyHeuristic, type ClassLite } from "../src/lib/email-classify-heuristic";

const CLASSES: ClassLite[] = [
  { id: "econ", code: "ECON-2330-03", name: "Microeconomics", professor: "Jane Smith" },
  { id: "eng", code: "ENG-1400-06", name: "Composition", professor: null },
  { id: "acct", code: "ACCT-3110-01", name: "Intermediate Financial Accounting I", professor: "Bob Lee" },
];

describe("matchClassId", () => {
  it("matches on a compact course code variant in the subject", () => {
    expect(matchClassId("Reminder: ECON 2330 exam moved", CLASSES)).toBe("econ");
  });

  it("matches on the hyphenated course code exactly as Canvas stores it", () => {
    expect(matchClassId("Update for ECON-2330-03", CLASSES)).toBe("econ");
  });

  it("matches on the professor's last name when the code isn't present", () => {
    expect(matchClassId("Office hours moved this week — Prof. Smith", CLASSES)).toBe("econ");
  });

  it("matches on a distinctive class name word", () => {
    expect(matchClassId("Your Microeconomics homework is graded", CLASSES)).toBe("econ");
  });

  it("returns null when nothing in the text matches any class", () => {
    expect(matchClassId("Your Amazon order has shipped", CLASSES)).toBeNull();
  });

  it("picks the higher-scoring class when text weakly overlaps more than one", () => {
    // Only ECON's code appears; ACCT's professor doesn't, so ECON should win outright.
    const text = "ECON-2330-03 syllabus update from Prof. Smith";
    expect(matchClassId(text, CLASSES)).toBe("econ");
  });
});

describe("classifyHeuristic", () => {
  it("categorizes an exam-related email and flags it relevant", () => {
    const result = classifyHeuristic(
      { subject: "ECON 2330 Midterm moved to Wednesday", snippet: "Your midterm exam has moved.", bodyText: "" },
      CLASSES
    );
    expect(result.relevant).toBe(true);
    expect(result.category).toBe("EXAM");
    expect(result.classId).toBe("econ");
  });

  it("categorizes a schedule-change email correctly", () => {
    const result = classifyHeuristic(
      { subject: "Room change for tomorrow's lecture", snippet: "We've relocated to a new room.", bodyText: "" },
      CLASSES
    );
    expect(result.category).toBe("SCHEDULE_CHANGE");
    expect(result.relevant).toBe(true);
  });

  it("marks an unrelated promotional email as irrelevant", () => {
    const result = classifyHeuristic(
      { subject: "50% off your next order!", snippet: "Limited time sale, shop now.", bodyText: "" },
      CLASSES
    );
    expect(result.relevant).toBe(false);
    expect(result.category).toBe("IRRELEVANT");
  });

  it("never returns extracted facts — the heuristic path only classifies, never fabricates specifics", () => {
    const result = classifyHeuristic(
      { subject: "ECON 2330 exam moved to Thursday at 3pm", snippet: "", bodyText: "" },
      CLASSES
    );
    expect(result).not.toHaveProperty("facts");
    expect(result.confidence).toBeLessThan(0.5); // heuristic guesses stay low-confidence
  });

  it("still tags OTHER_ACADEMIC when a class is matched but no keyword category fires", () => {
    const result = classifyHeuristic(
      { subject: "A note about Microeconomics", snippet: "Just checking in.", bodyText: "" },
      CLASSES
    );
    expect(result.classId).toBe("econ");
    expect(result.category).toBe("OTHER_ACADEMIC");
    expect(result.relevant).toBe(true);
  });
});
