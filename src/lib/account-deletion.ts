import "server-only";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { deleteAssemblyAITranscripts } from "@/lib/assemblyai";
import { decryptSecret } from "@/lib/crypto";
import { revokeGoogleToken } from "@/lib/google-oauth";
import { stripeConfigured, stripeRequest } from "@/lib/stripe";

/**
 * Deletes a user and everything tied to them. Database rows go through the
 * schema's onDelete: Cascade relations (every model hangs off User directly
 * or through Class). Copies held by outside services are cleaned up first:
 * lecture audio in Vercel Blob, transcripts at AssemblyAI, and the Gmail
 * grant at Google, and website subscriptions at Stripe (canceled so they
 * stop charging). Each of those is best effort, logged on failure, and
 * never blocks the account itself from being deleted. An App Store
 * subscription can only be canceled by its owner in iPhone Settings; the
 * Account page says so before deleting.
 *
 * The Canvas access token, Schoology API key and Brightspace/Blackboard
 * calendar links are the user's own credentials, made in those systems.
 * None of them can be revoked from here, so deleting our encrypted copies
 * (via the cascade) is all we can do; the privacy page tells users where to
 * revoke them.
 */
export async function deleteUserAndData(userId: string): Promise<void> {
  const [user, lectures, emailAccount, stripeSubscriptions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
    prisma.lecture.findMany({
      where: { class: { userId } },
      select: { audioUrl: true, assemblyaiId: true },
    }),
    prisma.emailAccount.findUnique({ where: { userId } }),
    prisma.subscription.findMany({
      where: { userId, source: "stripe", status: { in: ["active", "past_due"] } },
      select: { externalId: true },
    }),
  ]);

  if (stripeConfigured()) {
    for (const sub of stripeSubscriptions) {
      try {
        await stripeRequest("DELETE", `/subscriptions/${sub.externalId}`);
      } catch (err) {
        console.error("Account deletion: Stripe cancel failed:", err);
      }
    }
  }

  const audioUrls = lectures.map((l) => l.audioUrl).filter((url): url is string => Boolean(url));
  if (audioUrls.length > 0) {
    try {
      await del(audioUrls);
    } catch (err) {
      console.error("Account deletion: lecture audio cleanup failed:", err);
    }
  }

  await deleteAssemblyAITranscripts(lectures.map((l) => l.assemblyaiId));

  if (emailAccount) {
    try {
      await revokeGoogleToken(decryptSecret(emailAccount.refreshTokenEnc));
    } catch (err) {
      console.error("Account deletion: Gmail revoke failed:", err);
    }
  }

  // RateLimitEvent rows are keyed by string, not by a relation, so the
  // cascade doesn't reach them (see src/lib/rate-limit.ts for the keys).
  await prisma.$transaction([
    prisma.rateLimitEvent.deleteMany({
      where: {
        key: {
          in: [
            `ai:${userId}`,
            `lecture:${userId}`,
            `upload:${userId}`,
            `free-code:${userId}`,
            `login-email:${user.email.toLowerCase()}`,
          ],
        },
      },
    }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}
