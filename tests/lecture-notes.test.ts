import { describe, it, expect } from "vitest";
import {
  isAllowedAudioType,
  isLectureInProgress,
  lectureStatusLabel,
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
});
