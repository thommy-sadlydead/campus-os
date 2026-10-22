import { describe, it, expect } from "vitest";
import {
  RESET_LINK_TTL_MINUTES,
  isResetLinkUsable,
  resetEmail,
  resetLinkExpiry,
  resetLinkUrl,
} from "../src/lib/password-reset";
import { forgotPasswordSchema, resetPasswordSchema } from "../src/lib/account-forms";

describe("password reset links", () => {
  const now = new Date("2026-10-21T20:00:00Z");

  it("expire an hour after they're made", () => {
    expect(RESET_LINK_TTL_MINUTES).toBe(60);
    expect(resetLinkExpiry(now).toISOString()).toBe("2026-10-21T21:00:00.000Z");
  });

  it("work once, and only before they expire", () => {
    const expiresAt = resetLinkExpiry(now);
    expect(isResetLinkUsable({ expiresAt, usedAt: null }, now)).toBe(true);
    expect(isResetLinkUsable({ expiresAt, usedAt: now }, now)).toBe(false);
    expect(isResetLinkUsable({ expiresAt, usedAt: null }, expiresAt)).toBe(false);
    expect(isResetLinkUsable({ expiresAt, usedAt: null }, new Date(expiresAt.getTime() + 1))).toBe(false);
  });

  it("point to the reset page on the configured site", () => {
    expect(resetLinkUrl("https://campus.example/", "ab12")).toBe("https://campus.example/reset-password?token=ab12");
  });
});

describe("resetEmail", () => {
  it("includes the link in both versions and escapes the HTML", () => {
    const link = "https://campus.example/reset-password?token=ab12&x=1";
    const email = resetEmail('student"<b>@school.edu', link);
    expect(email.subject).toBe("Reset your Campus OS password");
    expect(email.text).toContain(link);
    expect(email.html).toContain("token=ab12&amp;x=1");
    expect(email.html).not.toContain("<b>@");
    expect(email.html).toContain("student&quot;&lt;b&gt;@school.edu");
  });
});

describe("reset forms", () => {
  it("need a valid email to send a link", () => {
    expect(forgotPasswordSchema.safeParse({ email: "  student@school.edu " }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("need a long enough new password, typed the same twice", () => {
    expect(resetPasswordSchema.safeParse({ newPassword: "longenough1", confirmPassword: "longenough1" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ newPassword: "short", confirmPassword: "short" }).success).toBe(false);
    const mismatch = resetPasswordSchema.safeParse({ newPassword: "longenough1", confirmPassword: "longenough2" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.message).toBe("The two passwords don't match.");
  });
});
