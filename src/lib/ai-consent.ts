// Whether a student has allowed AI features (User.aiConsentAt). Every
// feature that sends their data to Anthropic or AssemblyAI checks this
// first, on the server: class and dashboard answers, assignment breakdowns,
// Voicewrite, email sorting, lecture transcripts and notes, and reading
// scanned PDFs. Without it those features either fall back to the non-AI
// version (email sorting, breakdowns) or say how to turn AI on.

/** Set by "Not now" on the dashboard's ask, so it stays away for a month. */
export const AI_NOT_NOW_COOKIE = "campusos_ai_not_now";

export const AI_CONSENT_MESSAGE = "This uses AI, which is turned off. Turn on AI features in Account to use it.";

export function hasAiConsent(user: { aiConsentAt: Date | null }): boolean {
  return user.aiConsentAt != null;
}
