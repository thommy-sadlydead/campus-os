import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

// Sliding-window limits stored in Postgres (the RateLimitEvent model), not
// in memory: serverless instances don't share memory, so an in-process
// counter would reset on every cold start and never see other instances'
// traffic. Deliberately simple — count recent rows, refuse past the limit.
// A burst of concurrent requests can overshoot a limit by a few, which is
// fine for what these are for: capping password guessing and runaway AI or
// transcription spend, not metering.

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const RATE_LIMITS = {
  // Failed logins (and failed current-password checks on the Account page),
  // per attempted email and per client IP. A successful login clears its
  // email's count.
  loginEmail: { limit: 10, windowMs: 15 * MINUTE },
  loginIp: { limit: 30, windowMs: 15 * MINUTE },
  // Sign-up attempts per client IP, wrong invite codes included.
  register: { limit: 10, windowMs: 60 * MINUTE },
  // Interactive AI features: dashboard, class assistant, assignment
  // breakdowns. Generous for one student's real use.
  ai: { limit: 200, windowMs: DAY },
  // New lectures (each one means an AssemblyAI transcription and a long
  // note-generation call), plus audio upload tokens as a backstop for
  // uploads that never become a lecture.
  lecture: { limit: 15, windowMs: DAY },
  upload: { limit: 20, windowMs: DAY },
} satisfies Record<string, RateLimitRule>;

export const AI_LIMIT_MESSAGE = `You've used the AI features ${RATE_LIMITS.ai.limit} times in the last 24 hours, which is the daily limit. They'll work again tomorrow.`;
export const LECTURE_LIMIT_MESSAGE = `You've added ${RATE_LIMITS.lecture.limit} lectures in the last 24 hours, which is the daily limit. Try again tomorrow.`;

// Longest window above; rows older than this can never count again.
const PRUNE_AFTER_MS = DAY;

/** True when one more event for `key` would go over the rule. Records nothing. */
export async function isRateLimited(key: string, rule: RateLimitRule): Promise<boolean> {
  const recent = await prisma.rateLimitEvent.count({
    where: { key, createdAt: { gte: new Date(Date.now() - rule.windowMs) } },
  });
  return recent >= rule.limit;
}

export async function recordRateLimitEvent(key: string): Promise<void> {
  await prisma.rateLimitEvent.create({ data: { key } });
  // Opportunistic cleanup instead of a cron job (this app has none): about
  // one call in fifty prunes every row that's too old to matter.
  if (Math.random() < 0.02) {
    await prisma.rateLimitEvent
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - PRUNE_AFTER_MS) } } })
      .catch((err) => console.error("Rate limit pruning failed:", err));
  }
}

/** Checks and records in one step. Returns false, recording nothing, when over the limit. */
export async function consumeRateLimit(key: string, rule: RateLimitRule): Promise<boolean> {
  if (await isRateLimited(key, rule)) return false;
  await recordRateLimitEvent(key);
  return true;
}

export async function clearRateLimit(key: string): Promise<void> {
  await prisma.rateLimitEvent.deleteMany({ where: { key } });
}

/** One interactive AI request for this user, if they're under the daily limit. */
export async function allowAiRequest(userId: string): Promise<boolean> {
  return consumeRateLimit(`ai:${userId}`, RATE_LIMITS.ai);
}

/**
 * The client's IP as reported by Vercel's proxy, which sets
 * x-forwarded-for itself rather than trusting a client-sent value. Local
 * runs have no proxy, so every request there shares "unknown".
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}
