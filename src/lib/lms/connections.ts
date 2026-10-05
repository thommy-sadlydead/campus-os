import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { failedReport, type SyncReport } from "@/lib/lms/report";
import { LMS_PROVIDER_INFO, type LmsProvider } from "@/lib/lms/providers";
import { describeSchoologyConnectError, SchoologyApiError, SchoologyClient } from "@/lib/lms/schoology";
import { syncSchoologyForUser, type SchoologySettings } from "@/lib/lms/schoology-sync";
import { syncFeedForUser, FeedError, type FeedCredentials } from "@/lib/lms/feed-sync";
import type { FeedCourseSettings } from "@/lib/lms/feed-courses";
import { SafeFetchError } from "@/lib/lms/safe-fetch";

// The student's LMS connections (Canvas lives in CanvasAccount, the rest
// in LmsConnection), and running a sync for the ones in LmsConnection.

export type NonCanvasProvider = Exclude<LmsProvider, "canvas">;

export interface SchoologyCredentials {
  consumerKey: string;
  consumerSecret: string;
}

export interface ConnectionSummary {
  provider: LmsProvider;
  connectedAt: Date;
  lastSyncedAt: Date | null;
}

/** Every LMS the account is connected to. Once per request. */
export const getConnections = cache(async (userId: string): Promise<ConnectionSummary[]> => {
  const [canvas, others] = await Promise.all([
    prisma.canvasAccount.findUnique({ where: { userId }, select: { connectedAt: true, lastSyncedAt: true } }),
    prisma.lmsConnection.findMany({ where: { userId }, select: { provider: true, connectedAt: true, lastSyncedAt: true } }),
  ]);
  const list: ConnectionSummary[] = [];
  if (canvas) list.push({ provider: "canvas", connectedAt: canvas.connectedAt, lastSyncedAt: canvas.lastSyncedAt });
  for (const c of others) {
    if (c.provider in LMS_PROVIDER_INFO) {
      list.push({ provider: c.provider as LmsProvider, connectedAt: c.connectedAt, lastSyncedAt: c.lastSyncedAt });
    }
  }
  return list;
});

/** The navigation entry: the connected LMS's own name, or a way to connect one. */
export async function lmsNavItem(userId: string): Promise<{ href: string; label: string }> {
  const connections = await getConnections(userId);
  if (connections.length === 1) {
    const provider = connections[0].provider;
    return { href: `/connect/${provider}`, label: LMS_PROVIDER_INFO[provider].name };
  }
  return { href: "/connect", label: connections.length === 0 ? "Connect classes" : "Class sync" };
}

export function getLmsConnection(userId: string, provider: NonCanvasProvider) {
  return prisma.lmsConnection.findUnique({ where: { userId_provider: { userId, provider } } });
}

export function readCredentials<T>(credentialsEnc: string): T {
  return JSON.parse(decryptSecret(credentialsEnc)) as T;
}

export function readSettings<T>(settings: string | null, fallback: T): T {
  if (!settings) return fallback;
  try {
    return JSON.parse(settings) as T;
  } catch {
    return fallback;
  }
}

export async function saveLmsConnection(
  userId: string,
  provider: NonCanvasProvider,
  data: { baseUrl: string; credentials: unknown; settings: unknown }
): Promise<void> {
  const fields = {
    baseUrl: data.baseUrl,
    credentialsEnc: encryptSecret(JSON.stringify(data.credentials)),
    settings: JSON.stringify(data.settings),
  };
  await prisma.lmsConnection.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ...fields },
    update: fields,
  });
}

/** Why a whole sync failed, for its report. */
function describeSyncError(provider: NonCanvasProvider, baseUrl: string, err: unknown): string {
  if (provider === "schoology") {
    if (err instanceof SchoologyApiError && err.status === 401) {
      return "Schoology stopped accepting your API key (it may have been reset). Disconnect, then connect again with your current key.";
    }
    if (err instanceof SchoologyApiError) return describeSchoologyConnectError(err, baseUrl);
  }
  if (err instanceof FeedError || err instanceof SafeFetchError) return err.message;
  if (err instanceof Error && (err instanceof TypeError || err.name === "TimeoutError" || err.name === "AbortError")) {
    return `Couldn't reach ${LMS_PROVIDER_INFO[provider].name}. Check your connection and sync again.`;
  }
  return "The sync stopped partway through. Sync again to finish it.";
}

/**
 * Syncs one connection and saves its report. Never throws: a failed sync
 * is a report with an error, and the last good sync time stays.
 */
export async function runLmsSync(userId: string, provider: NonCanvasProvider, timeZone: string): Promise<SyncReport> {
  const connection = await getLmsConnection(userId, provider);
  if (!connection) return failedReport(provider, new Date(), `${LMS_PROVIDER_INFO[provider].name} isn't connected.`);

  let report: SyncReport;
  try {
    if (provider === "schoology") {
      const credentials = readCredentials<SchoologyCredentials>(connection.credentialsEnc);
      const settings = readSettings<SchoologySettings | null>(connection.settings, null);
      if (!settings) throw new Error("Missing Schoology account details.");
      const client = new SchoologyClient({ ...credentials, domain: connection.baseUrl });
      report = await syncSchoologyForUser(prisma, userId, client, settings);
    } else {
      const credentials = readCredentials<FeedCredentials>(connection.credentialsEnc);
      const settings = readSettings<FeedCourseSettings>(connection.settings, { courses: {} });
      report = await syncFeedForUser(prisma, userId, provider, credentials, settings, timeZone);
    }
  } catch (err) {
    console.error(`${provider} sync failed for user ${userId}:`, err);
    report = failedReport(provider, new Date(), describeSyncError(provider, connection.baseUrl, err));
  }

  await prisma.lmsConnection.update({
    where: { id: connection.id },
    data: { lastSyncReport: JSON.stringify(report), ...(report.error ? {} : { lastSyncedAt: new Date() }) },
  });
  return report;
}
