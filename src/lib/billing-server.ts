import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  accessFor,
  parseFreeAccessCodes,
  trialEndFrom,
  type Access,
  type Plan,
  type SubscriptionSource,
  type SubscriptionStatus,
} from "@/lib/billing";

/** Trial and subscription checks are enforced only with PAYMENTS_ENABLED=1. */
export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_ENABLED === "1";
}

/**
 * The account's access right now, once per request. Accounts made before
 * payments went live have no trial yet; theirs starts on this first check.
 */
export const getAccess = cache(async (userId: string): Promise<Access> => {
  if (!paymentsEnabled()) return { kind: "free" };

  let user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { trialEndsAt: true, freeAccessAt: true, subscriptions: true },
  });
  if (!user.trialEndsAt && !user.freeAccessAt) {
    // Conditional, so two requests at once can't both move the end date.
    await prisma.user.updateMany({
      where: { id: userId, trialEndsAt: null },
      data: { trialEndsAt: trialEndFrom(new Date()) },
    });
    user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { trialEndsAt: true, freeAccessAt: true, subscriptions: true },
    });
  }
  return accessFor(user, new Date());
});

/** False only when payments are on and the account has neither a trial, a subscription nor free access. */
export async function hasAccess(userId: string): Promise<boolean> {
  return (await getAccess(userId)).kind !== "none";
}

/** Same constant-time comparison as the invite code (src/lib/signup.ts). */
export function freeAccessCodeMatches(attempt: string): boolean {
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  const guess = digest(attempt.trim().toLowerCase());
  return parseFreeAccessCodes(process.env.FREE_ACCESS_CODE).some((code) =>
    crypto.timingSafeEqual(guess, digest(code))
  );
}

/** Requests from the iPhone app (its user agent; see capacitor.config.json). */
export async function isAppRequest(): Promise<boolean> {
  return (await headers()).get("user-agent")?.includes("CampusOSApp") ?? false;
}

/** This site's origin, for Stripe's return links. APP_URL overrides it. */
export async function requestOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The UUID the iPhone app attaches to purchases (StoreKit's appAccountToken), made on first use. */
export async function appleAccountTokenFor(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { appleAccountToken: true } });
  if (user.appleAccountToken) return user.appleAccountToken;
  await prisma.user.updateMany({
    where: { id: userId, appleAccountToken: null },
    data: { appleAccountToken: crypto.randomUUID() },
  });
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { appleAccountToken: true } });
  return updated.appleAccountToken!;
}

export interface SubscriptionRecord {
  userId: string;
  source: SubscriptionSource;
  externalId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

/** Creates or updates the row for one Stripe subscription or Apple original transaction. */
export async function saveSubscription(record: SubscriptionRecord): Promise<void> {
  const { userId, source, externalId, ...fields } = record;
  await prisma.subscription.upsert({
    where: { source_externalId: { source, externalId } },
    create: { userId, source, externalId, ...fields },
    update: fields,
  });
}
