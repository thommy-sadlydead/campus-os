import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GmailMessageSummary } from "@/lib/gmail";
import type { ClassLite } from "@/lib/email-classify-heuristic";

const { askClaudeForJson } = vi.hoisted(() => ({ askClaudeForJson: vi.fn() }));
vi.mock("@/lib/anthropic", () => ({ askClaudeForJson }));

import { classifyWithAi } from "@/lib/email-intelligence";

const CLASSES: ClassLite[] = [
  { id: "econ", code: "ECON-2330-03", name: "Microeconomics", professor: "Jane Smith" },
  { id: "eng", code: "ENG-1400-06", name: "Composition", professor: null },
];

function email(overrides: Partial<GmailMessageSummary>): GmailMessageSummary {
  return {
    id: "m1",
    fromAddress: "someone@example.edu",
    fromName: null,
    subject: "Hello",
    snippet: "",
    bodyText: "",
    receivedAt: new Date("2026-09-30T12:00:00Z"),
    isBulk: false,
    ...overrides,
  };
}

const EXAM_FACT = {
  entityType: "Exam",
  targetHint: "Exam 2",
  field: "examAt",
  newValue: "2026-10-09T10:00:00",
  isNewRecord: false,
  newRecordName: null,
};

beforeEach(() => askClaudeForJson.mockReset());

describe("classifyWithAi", () => {
  it("keeps the model's answer for an email about one class", async () => {
    askClaudeForJson.mockResolvedValue({
      relevant: true,
      classCode: "ECON-2330-03",
      category: "EXAM",
      summary: "Exam 2 moved to Friday.",
      confidence: 0.9,
      facts: [EXAM_FACT],
    });
    const result = await classifyWithAi(email({ subject: "Exam 2 moved", fromName: "Jane Smith" }), CLASSES);
    expect(result).toMatchObject({ relevant: true, classId: "econ", category: "EXAM" });
    expect(result?.facts).toHaveLength(1);
  });

  it("makes a newsletter the model called an assignment an announcement, with no class or facts", async () => {
    askClaudeForJson.mockResolvedValue({
      relevant: true,
      classCode: "ENG-1400-06",
      category: "ASSIGNMENT",
      summary: "Campus events this week.",
      confidence: 0.7,
      facts: [EXAM_FACT],
    });
    const result = await classifyWithAi(
      email({ subject: "Western Wednesday and Annual Bonfire", fromName: "The Daily Buzz", isBulk: true }),
      CLASSES
    );
    expect(result).toMatchObject({ category: "ANNOUNCEMENT", classId: null, facts: [] });
  });

  it("falls back to a real category when the model makes one up", async () => {
    askClaudeForJson.mockResolvedValue({ relevant: false, classCode: null, category: "Newsletter", summary: "", confidence: 0.6, facts: [] });
    expect((await classifyWithAi(email({}), CLASSES))?.category).toBe("IRRELEVANT");

    askClaudeForJson.mockResolvedValue({ relevant: true, classCode: null, category: "Grades", summary: "", confidence: 0.6, facts: [] });
    expect((await classifyWithAi(email({}), CLASSES))?.category).toBe("OTHER_ACADEMIC");
  });

  it("doesn't tag a class from one class-name word when the model names none", async () => {
    askClaudeForJson.mockResolvedValue({ relevant: true, classCode: null, category: "OTHER_ACADEMIC", summary: "", confidence: 0.6, facts: [] });
    const result = await classifyWithAi(email({ subject: "Composition contest", bodyText: "Enter the composition contest." }), CLASSES);
    expect(result?.classId).toBeNull();
  });

  it("tells the model the reply format, the categories and whether the email went to a mailing list", async () => {
    askClaudeForJson.mockResolvedValue(null);
    await classifyWithAi(email({ isBulk: true }), CLASSES);
    const { system, prompt } = askClaudeForJson.mock.calls[0][0];
    expect(system).toContain('"category"');
    expect(system).toContain('"SCHEDULE_CHANGE"');
    expect(system).toMatch(/Newsletters, digests/);
    expect(prompt).toContain("Sent to a mailing list: yes");
  });
});
