import { describe, it, expect } from "vitest";
import {
  isAllowedAudioType,
  isLectureInProgress,
  lectureStatusLabel,
  classMaterialTypeLabel,
  buildLectureNotesPrompt,
} from "../src/lib/lecture-notes";

describe("isAllowedAudioType", () => {
  it("accepts common audio content types", () => {
    expect(isAllowedAudioType("audio/mpeg")).toBe(true);
    expect(isAllowedAudioType("audio/mp4")).toBe(true);
    expect(isAllowedAudioType("audio/wav")).toBe(true);
  });

  it("rejects non-audio content types", () => {
    expect(isAllowedAudioType("video/mp4")).toBe(false);
    expect(isAllowedAudioType("image/png")).toBe(false);
    expect(isAllowedAudioType("")).toBe(false);
  });
});

describe("isLectureInProgress", () => {
  it("treats UPLOADED, TRANSCRIBING, and GENERATING_NOTES as in progress", () => {
    expect(isLectureInProgress("UPLOADED")).toBe(true);
    expect(isLectureInProgress("TRANSCRIBING")).toBe(true);
    expect(isLectureInProgress("GENERATING_NOTES")).toBe(true);
  });

  it("treats READY and FAILED as terminal", () => {
    expect(isLectureInProgress("READY")).toBe(false);
    expect(isLectureInProgress("FAILED")).toBe(false);
  });
});

describe("lectureStatusLabel", () => {
  it("returns a human label for each known status", () => {
    expect(lectureStatusLabel("TRANSCRIBING")).toBe("Transcribing…");
    expect(lectureStatusLabel("READY")).toBe("Ready");
  });

  it("falls back to the raw value for an unknown status", () => {
    expect(lectureStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("buildLectureNotesPrompt", () => {
  it("embeds the full transcript when it's under the length cap", () => {
    const { prompt } = buildLectureNotesPrompt("Today we covered supply and demand.");
    expect(prompt).toContain("Today we covered supply and demand.");
    expect(prompt).toContain("full lecture transcript");
  });

  it("truncates a transcript over the length cap and says so", () => {
    const huge = "word ".repeat(30_000); // ~150k chars
    const { prompt } = buildLectureNotesPrompt(huge);
    expect(prompt.length).toBeLessThan(huge.length);
    expect(prompt).toContain("cut off for length");
  });

  it("tells the model not to fabricate content", () => {
    const { system } = buildLectureNotesPrompt("some transcript text");
    expect(system.toLowerCase()).toContain("never invent");
  });

  it("says nothing about reference material when there are no materials", () => {
    const { system, prompt } = buildLectureNotesPrompt("some transcript text");
    expect(system.toLowerCase()).not.toContain("reference material");
    expect(prompt).not.toContain("Reference material for this class");
  });

  it("includes book and slide content in the prompt, labeled by type and title", () => {
    const { prompt } = buildLectureNotesPrompt("Today: supply and demand.", [
      { type: "BOOK", title: "Principles of Economics", content: "Chapter 4 covers price elasticity." },
      { type: "SLIDES", title: "Week 3 slides", content: "Slide 12: equilibrium price graph." },
    ]);
    expect(prompt).toContain("[Book: Principles of Economics]");
    expect(prompt).toContain("Chapter 4 covers price elasticity.");
    expect(prompt).toContain("[Slides: Week 3 slides]");
    expect(prompt).toContain("Slide 12: equilibrium price graph.");
  });

  it("tells the model materials only inform, never add content, when materials are present", () => {
    const { system } = buildLectureNotesPrompt("transcript", [{ type: "BOOK", title: "Text", content: "content" }]);
    expect(system.toLowerCase()).toContain("never to add content");
  });

  it("truncates combined materials that exceed the budget", () => {
    const huge = "word ".repeat(20_000); // ~100k chars, over the 40k materials budget
    const { prompt } = buildLectureNotesPrompt("transcript", [{ type: "BOOK", title: "Big Book", content: huge }]);
    expect(prompt.length).toBeLessThan(huge.length);
  });
});

describe("classMaterialTypeLabel", () => {
  it("labels known types", () => {
    expect(classMaterialTypeLabel("BOOK")).toBe("Book");
    expect(classMaterialTypeLabel("SLIDES")).toBe("Slides");
  });

  it("falls back to the raw value for an unknown type", () => {
    expect(classMaterialTypeLabel("SOMETHING_ELSE")).toBe("SOMETHING_ELSE");
  });
});
