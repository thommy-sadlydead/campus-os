import { describe, expect, it } from "vitest";
import { parseJsonLoose } from "../src/lib/json-text";

describe("parseJsonLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoose('["Chapter 6 slides"]')).toEqual(["Chapter 6 slides"]);
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips a code fence", () => {
    expect(parseJsonLoose('```json\n["A", "B"]\n```')).toEqual(["A", "B"]);
  });

  it("ignores a sentence after the JSON", () => {
    // What the logs showed: "Unexpected non-whitespace character after JSON".
    expect(parseJsonLoose("[]\n\nNone of these materials cover this lecture's topic.")).toEqual([]);
  });

  it("ignores a sentence before the JSON", () => {
    expect(parseJsonLoose('Based on the transcript, these match:\n["Week 3 notes"]')).toEqual(["Week 3 notes"]);
  });

  it("keeps brackets and quotes inside strings", () => {
    expect(parseJsonLoose('Here: ["Ch. 2 [draft]", "He said \\"hi\\" ]"] done')).toEqual(["Ch. 2 [draft]", 'He said "hi" ]']);
  });

  it("skips bracketed prose that isn't JSON", () => {
    expect(parseJsonLoose('[see below]\n{"ok": true}')).toEqual({ ok: true });
  });

  it("throws when there's no JSON at all", () => {
    expect(() => parseJsonLoose("Based on the transcript, nothing matches.")).toThrow();
    expect(() => parseJsonLoose('["never closed"')).toThrow();
  });
});
