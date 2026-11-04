import "server-only";
import { cache } from "react";
import { canUseGmail } from "@/lib/gmail-access";
import { isDemoAccount } from "@/lib/sample-classes";
import { enabledFeatures, type FeatureId, type FeatureUser } from "@/lib/features";

type User = FeatureUser & { id: string; email: string };

/** Features this account can turn on: Email only where Gmail is open to it (src/lib/gmail-access.ts). */
export async function availableFeatures(user: { id: string; email: string }): Promise<(id: FeatureId) => boolean> {
  const gmail = await canUseGmail(user);
  return (id) => id !== "email" || gmail;
}

/** The features this account has on and can use. Once per request, like getCurrentUser. */
export const featuresFor = cache(async (user: User): Promise<Set<FeatureId>> => {
  const available = await availableFeatures(user);
  const on = enabledFeatures(user, { demo: isDemoAccount(user.email) });
  return new Set([...on].filter(available));
});
