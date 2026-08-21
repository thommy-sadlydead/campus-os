import { describe, it, expect } from "vitest";
import { decideChangeOutcome, normalizeForCompare, isAllowedField, ENTITY_FIELDS } from "../src/lib/change-rules";

describe("normalizeForCompare", () => {
  it("treats equivalent ISO date strings as equal even with different formatting", () => {
    expect(normalizeForCompare("examAt", "2026-09-03T14:00:00.000Z")).toBe(
      normalizeForCompare("examAt", "2026-09-03T14:00:00Z")
    );
  });

  it("treats equivalent numbers as equal even with different string formatting", () => {
    expect(normalizeForCompare("weight", "12")).toBe(normalizeForCompare("weight", "12.0"));
  });

  it("is case- and whitespace-insensitive for plain text fields", () => {
    expect(normalizeForCompare("location", "  Engineering Hall 210  ")).toBe(
      normalizeForCompare("location", "engineering hall 210")
    );
  });

  it("treats null as the empty string", () => {
    expect(normalizeForCompare("location", null)).toBe("");
  });
});

describe("decideChangeOutcome", () => {
  it("returns 'same' when the new value matches what's already on file", () => {
    expect(decideChangeOutcome("2026-09-03T14:00:00Z", "2026-09-03T14:00:00.000Z", "examAt")).toBe("same");
  });

  it("returns 'auto-apply' when there's nothing on file yet — unambiguous new info", () => {
    expect(decideChangeOutcome(null, "Engineering Hall 210", "location")).toBe("auto-apply");
    expect(decideChangeOutcome("", "Engineering Hall 210", "location")).toBe("auto-apply");
  });

  it("returns 'conflict' when the new value genuinely differs from an existing value", () => {
    // The canonical example from the spec: schedule says Tuesday, email says Wednesday.
    expect(decideChangeOutcome("2026-09-01T14:00:00Z", "2026-09-02T15:00:00Z", "examAt")).toBe("conflict");
  });

  it("never auto-applies over an existing value, even a short/likely one", () => {
    expect(decideChangeOutcome("A-", "A", "currentGrade")).toBe("conflict");
  });
});

describe("isAllowedField / ENTITY_FIELDS", () => {
  it("accepts every documented field for each entity type", () => {
    for (const [entityType, fields] of Object.entries(ENTITY_FIELDS)) {
      for (const field of fields) {
        expect(isAllowedField(entityType as any, field)).toBe(true);
      }
    }
  });

  it("rejects a field not in the allowlist — defense against a hallucinated field name", () => {
    expect(isAllowedField("Assignment", "userId")).toBe(false);
    expect(isAllowedField("Exam", "id")).toBe(false);
    expect(isAllowedField("Class", "passwordHash")).toBe(false);
  });
});
