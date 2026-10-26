import { describe, expect, it } from "vitest";
import {
  buildFlashcardPrompt,
  chatgptStudyPrompts,
  chatgptUrl,
  parseFlashcards,
  quizletImportText,
  sourcesWithinBudget,
} from "../src/lib/flashcards";

describe("parseFlashcards", () => {
  it("reads {cards: [...]} and cleans up whitespace", () => {
    const cards = parseFlashcards({ cards: [{ front: "  Mitosis ", back: "Cell division that makes\ntwo identical cells." }] }, 10);
    expect(cards).toEqual([{ front: "Mitosis", back: "Cell division that makes two identical cells." }]);
  });

  it("also takes a bare array", () => {
    expect(parseFlashcards([{ front: "a", back: "b" }], 10)).toHaveLength(1);
  });

  it("drops empty, malformed and duplicate cards, and stops at the limit", () => {
    const json = {
      cards: [
        { front: "Enzyme", back: "A protein that speeds up a reaction." },
        { front: "enzyme", back: "Same front, different case." },
        { front: "", back: "No front" },
        { front: "No back" },
        "not a card",
        { front: 42, back: "Wrong type" },
        { front: "Substrate", back: "What an enzyme acts on." },
        { front: "Active site", back: "Where the substrate binds." },
      ],
    };
    expect(parseFlashcards(json, 2).map((c) => c.front)).toEqual(["Enzyme", "Substrate"]);
  });

  it("returns nothing for something that isn't cards", () => {
    expect(parseFlashcards(null, 10)).toEqual([]);
    expect(parseFlashcards({ cards: "nope" }, 10)).toEqual([]);
    expect(parseFlashcards("text", 10)).toEqual([]);
  });

  it("caps very long fronts and backs", () => {
    const [card] = parseFlashcards([{ front: "x".repeat(500), back: "y".repeat(2000) }], 1);
    expect(card.front).toHaveLength(200);
    expect(card.back).toHaveLength(600);
  });
});

describe("quizletImportText", () => {
  it("puts a tab between term and definition and one card per line", () => {
    expect(quizletImportText([{ front: "f(x)", back: "a function" }, { front: "f'(x)", back: "its derivative" }])).toBe(
      "f(x)\ta function\nf'(x)\tits derivative"
    );
  });

  it("turns tabs and line breaks inside a card into spaces so cards don't split", () => {
    expect(quizletImportText([{ front: "Term\twith tab", back: "Line one\nline two\r\nthree" }])).toBe("Term with tab\tLine one line two three");
  });
});

describe("sourcesWithinBudget", () => {
  it("keeps whole sources in order while they fit", () => {
    const kept = sourcesWithinBudget(
      [
        { label: "a", text: "x".repeat(40) },
        { label: "b", text: "y".repeat(40) },
        { label: "c", text: "z".repeat(40) },
      ],
      100
    );
    expect(kept.map((s) => s.label)).toEqual(["a", "b"]);
  });

  it("cuts a first source that's bigger than the whole budget, and skips empty ones", () => {
    const kept = sourcesWithinBudget([{ label: "empty", text: "   " }, { label: "big", text: "x".repeat(500) }], 100);
    expect(kept).toEqual([{ label: "big", text: "x".repeat(100) }]);
  });
});

describe("buildFlashcardPrompt", () => {
  it("asks for the count, the focus, and only what's in the material", () => {
    const { system, prompt } = buildFlashcardPrompt({
      className: "Calculus I",
      sources: [{ label: "Note: The chain rule", text: "d/dx f(g(x)) = f'(g(x)) g'(x)" }],
      count: 20,
      focus: "Exam 2",
    });
    expect(system).toContain("exactly 20 flashcards");
    expect(system).toContain("Only use what's in the material");
    expect(prompt).toContain("Class: Calculus I");
    expect(prompt).toContain("Focus the cards on: Exam 2");
    expect(prompt).toContain("### Note: The chain rule\nd/dx f(g(x))");
  });

  it("leaves the focus line out when there isn't one", () => {
    expect(buildFlashcardPrompt({ className: "Bio", sources: [], count: 10 }).prompt).not.toContain("Focus");
  });
});

describe("Study with ChatGPT", () => {
  it("builds a chatgpt.com link with the request typed in", () => {
    expect(chatgptUrl("Quiz me & go")).toBe("https://chatgpt.com/?q=Quiz%20me%20%26%20go");
  });

  it("names Campus OS and the class in every request, and keeps them short", () => {
    const prompts = chatgptStudyPrompts({ className: "Calculus I", nextExam: "Exam 2", latestLecture: "The chain rule" });
    expect(prompts.map((p) => p.label)).toEqual(["Quiz me", "Study guide for Exam 2", "Explain my latest lecture"]);
    for (const p of prompts) {
      expect(p.prompt).toContain("Campus OS");
      expect(p.prompt).toContain("Calculus I");
      expect(chatgptUrl(p.prompt).length).toBeLessThan(2000);
    }
  });

  it("offers a general study guide and no lecture button when there's no exam or lecture", () => {
    expect(chatgptStudyPrompts({ className: "Bio" }).map((p) => p.label)).toEqual(["Quiz me", "Make a study guide"]);
  });
});
