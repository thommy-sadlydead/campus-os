import { z } from "zod";

// Form validation for the login, sign-up and Account pages. Kept out of the
// "use server" action files, which may only export async functions, so the
// rules can be unit tested directly.

export const MIN_PASSWORD_LENGTH = 8;

const password = z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const registerSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address."),
    password,
    confirmPassword: z.string(),
    inviteCode: z.string().trim().min(1, "Enter your invite code."),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "The two new passwords don't match.",
    path: ["confirmPassword"],
  });

// Typed out in full on the Account page so account deletion can't happen by
// a stray click.
export const DELETE_CONFIRMATION_WORD = "DELETE";
