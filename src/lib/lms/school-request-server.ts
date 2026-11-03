import "server-only";
import { prisma } from "@/lib/prisma";
import type { FeedProvider } from "@/lib/lms/providers";
import { schoolHost, suggestedContact } from "@/lib/lms/school-request";

export interface SchoolRequestStatus {
  /** The student's school in that LMS: "learn.school.edu". */
  host: string;
  /** When this student last asked, and where they sent it. */
  askedAt: Date | null;
  contactEmail: string | null;
  /** Other students at the same school who've asked. */
  othersAsked: number;
  /** The address most of them sent it to, when it's at the school's own domain. */
  suggestedContact: string | null;
}

export async function schoolRequestStatus(userId: string, provider: FeedProvider, baseUrl: string): Promise<SchoolRequestStatus | null> {
  const host = schoolHost(baseUrl);
  if (!host) return null;
  const others = { provider, schoolHost: host, userId: { not: userId } };
  const [mine, othersAsked, recent] = await Promise.all([
    prisma.schoolAccessRequest.findUnique({ where: { userId_provider: { userId, provider } } }),
    prisma.schoolAccessRequest.count({ where: others }),
    prisma.schoolAccessRequest.findMany({
      where: { ...others, contactEmail: { not: null } },
      select: { contactEmail: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  return {
    host,
    askedAt: mine?.updatedAt ?? null,
    contactEmail: mine?.contactEmail ?? null,
    othersAsked,
    suggestedContact: suggestedContact(recent, host),
  };
}
