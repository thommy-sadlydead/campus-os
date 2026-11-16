import { describe, expect, it } from "vitest";
import { asksForClassTimes } from "../src/lib/class-times";

describe("asksForClassTimes", () => {
  it("asks once classes have come in and none has a meeting time", () => {
    expect(asksForClassTimes({ classCount: 4, meetingCount: 0, dismissed: false })).toBe(true);
  });

  it("waits until there are classes", () => {
    expect(asksForClassTimes({ classCount: 0, meetingCount: 0, dismissed: false })).toBe(false);
  });

  it("stops once any meeting time exists", () => {
    expect(asksForClassTimes({ classCount: 4, meetingCount: 1, dismissed: false })).toBe(false);
  });

  it("stays away after \"Not now\"", () => {
    expect(asksForClassTimes({ classCount: 4, meetingCount: 0, dismissed: true })).toBe(false);
  });
});
