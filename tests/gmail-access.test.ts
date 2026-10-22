import { describe, it, expect } from "vitest";
import { gmailOpenTo } from "../src/lib/gmail-access";

describe("gmailOpenTo", () => {
  it("is open only to the listed testers, any case, until Gmail goes public", () => {
    const testers = " Reece@School.edu, friend@example.com ";
    expect(gmailOpenTo("reece@school.edu", testers, undefined)).toBe(true);
    expect(gmailOpenTo("FRIEND@example.com", testers, undefined)).toBe(true);
    expect(gmailOpenTo("student@school.edu", testers, undefined)).toBe(false);
    expect(gmailOpenTo("student@school.edu", "", undefined)).toBe(false);
    expect(gmailOpenTo("student@school.edu", undefined, undefined)).toBe(false);
  });

  it("is open to everyone once GMAIL_PUBLIC=1", () => {
    expect(gmailOpenTo("student@school.edu", undefined, "1")).toBe(true);
    expect(gmailOpenTo("student@school.edu", undefined, "0")).toBe(false);
  });
});
