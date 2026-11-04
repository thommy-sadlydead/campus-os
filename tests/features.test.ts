import { describe, expect, it } from "vitest";
import {
  FEATURES,
  FEATURE_IDS,
  LEGACY_FEATURES,
  enabledFeatures,
  normalizeFeatures,
  toggleFeature,
} from "../src/lib/features";

describe("the feature list", () => {
  it("lists every id once, and every requirement is a real feature", () => {
    expect(FEATURES.map((f) => f.id)).toEqual([...FEATURE_IDS]);
    for (const f of FEATURES) for (const r of f.requires ?? []) expect(FEATURE_IDS).toContain(r);
  });

  it("keeps everything from before the picker as the legacy set, and nothing new", () => {
    expect(LEGACY_FEATURES).toEqual(["lectures", "flashcards", "assistant", "breakdown", "risk", "free-time", "email"]);
  });
});

describe("normalizeFeatures", () => {
  it("keeps known ids once each, in list order", () => {
    expect(normalizeFeatures(["risk", "lectures", "risk", "nope", 3, null])).toEqual(["lectures", "risk"]);
  });

  it("drops a feature whose requirement is off", () => {
    expect(normalizeFeatures(["smart-review", "tutor-mode"])).toEqual([]);
    expect(normalizeFeatures(["smart-review", "flashcards"])).toEqual(["flashcards", "smart-review"]);
  });

  it("leaves out what the account can't have", () => {
    expect(normalizeFeatures(["email", "grades"], (id) => id !== "email")).toEqual(["grades"]);
  });
});

describe("toggleFeature", () => {
  it("turns on what a feature needs", () => {
    expect(toggleFeature([], "exam-prep", true)).toEqual(["flashcards", "exam-prep"]);
  });

  it("turns off what needs a feature", () => {
    expect(toggleFeature(["flashcards", "smart-review", "exam-prep", "grades"], "flashcards", false)).toEqual(["grades"]);
  });

  it("leaves the requirement on when a dependent goes", () => {
    expect(toggleFeature(["assistant", "tutor-mode"], "tutor-mode", false)).toEqual(["assistant"]);
  });
});

describe("enabledFeatures", () => {
  it("gives an account that hasn't picked what it had before", () => {
    expect([...enabledFeatures({ features: [], featuresChosenAt: null })]).toEqual(LEGACY_FEATURES);
  });

  it("gives the review account everything until it picks", () => {
    expect(enabledFeatures({ features: [], featuresChosenAt: null }, { demo: true }).size).toBe(FEATURE_IDS.length);
  });

  it("uses what was picked once there's a choice, even nothing", () => {
    const chosen = new Date("2026-11-04T12:00:00Z");
    expect([...enabledFeatures({ features: ["grades", "tutor-mode"], featuresChosenAt: chosen })]).toEqual(["grades"]);
    expect(enabledFeatures({ features: [], featuresChosenAt: chosen }).size).toBe(0);
  });
});
