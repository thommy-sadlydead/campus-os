import { afterEach, describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema, registerSchema } from "../src/lib/account-forms";
import { inviteCodeMatches, isSignupOpen } from "../src/lib/signup";

const validRegistration = {
  email: "student@school.edu",
  password: "correct horse",
  confirmPassword: "correct horse",
  inviteCode: "abc123",
};

describe("registerSchema", () => {
  it("accepts a complete, matching registration and trims the email", () => {
    const parsed = registerSchema.safeParse({ ...validRegistration, email: "  student@school.edu " });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.email).toBe("student@school.edu");
  });

  it("rejects mismatched passwords with a message about the mismatch", () => {
    const parsed = registerSchema.safeParse({ ...validRegistration, confirmPassword: "correct horsf" });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0]?.message).toBe("The two passwords don't match.");
  });

  it("rejects passwords under 8 characters", () => {
    const parsed = registerSchema.safeParse({ ...validRegistration, password: "short", confirmPassword: "short" });
    expect(parsed.success).toBe(false);
  });

  it("requires an invite code", () => {
    const parsed = registerSchema.safeParse({ ...validRegistration, inviteCode: "   " });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0]?.message).toBe("Enter your invite code.");
  });
});

describe("loginSchema", () => {
  it("doesn't apply sign-up password rules at login", () => {
    expect(loginSchema.safeParse({ email: "a@b.edu", password: "x" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.edu", password: "" }).success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("requires the two new passwords to match", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "old password",
      newPassword: "new password 1",
      confirmPassword: "new password 2",
    });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0]?.message).toBe("The two new passwords don't match.");
  });

  it("accepts a valid change", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "old password",
      newPassword: "new password 1",
      confirmPassword: "new password 1",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("invite codes", () => {
  const original = process.env.SIGNUP_INVITE_CODE;
  afterEach(() => {
    if (original === undefined) delete process.env.SIGNUP_INVITE_CODE;
    else process.env.SIGNUP_INVITE_CODE = original;
  });

  it("closes sign-up when no code is configured", () => {
    delete process.env.SIGNUP_INVITE_CODE;
    expect(isSignupOpen()).toBe(false);
    expect(inviteCodeMatches("anything")).toBe(false);
    expect(inviteCodeMatches("")).toBe(false);
  });

  it("treats a whitespace-only code as not configured", () => {
    process.env.SIGNUP_INVITE_CODE = "   ";
    expect(isSignupOpen()).toBe(false);
    expect(inviteCodeMatches("")).toBe(false);
  });

  it("matches the configured code exactly, ignoring surrounding spaces", () => {
    process.env.SIGNUP_INVITE_CODE = "cedarville-2026";
    expect(isSignupOpen()).toBe(true);
    expect(inviteCodeMatches("cedarville-2026")).toBe(true);
    expect(inviteCodeMatches("  cedarville-2026  ")).toBe(true);
    expect(inviteCodeMatches("Cedarville-2026")).toBe(false);
    expect(inviteCodeMatches("cedarville-202")).toBe(false);
    expect(inviteCodeMatches("")).toBe(false);
  });
});
