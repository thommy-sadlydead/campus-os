"use server";

import { redirect } from "next/navigation";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { createAuthorization } from "@/lib/oauth/oauth-server";
import { authorizationResponseUrl } from "@/lib/oauth/oauth";
import { resolveAuthorizeRequest } from "./request";

// Allow and Cancel on /oauth/authorize. The original request rides along in
// a hidden field and is validated again here: like every server action,
// these can be called with anything.

function queryFrom(formData: FormData): URLSearchParams {
  return new URLSearchParams(String(formData.get("query") ?? ""));
}

export async function approveAuthorizationAction(formData: FormData): Promise<void> {
  const query = queryFrom(formData);
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  const req = await resolveAuthorizeRequest(query);
  if (req.kind === "redirect") redirect(req.url);
  if (req.kind === "fatal") redirect(`/oauth/authorize?${query}`);

  const code = await createAuthorization({
    userId: user.id,
    client: req.client,
    redirectUri: req.params.redirectUri,
    codeChallenge: req.params.codeChallenge,
    scope: req.scope,
    resource: req.resource,
  });
  redirect(authorizationResponseUrl(req.params.redirectUri, req.origin, req.params.state, { code }));
}

export async function denyAuthorizationAction(formData: FormData): Promise<void> {
  const req = await resolveAuthorizeRequest(queryFrom(formData));
  if (req.kind === "fatal") redirect("/dashboard");
  if (req.kind === "redirect") redirect(req.url);
  redirect(
    authorizationResponseUrl(req.params.redirectUri, req.origin, req.params.state, {
      error: "access_denied",
      description: "The student didn't allow access.",
    })
  );
}

/** "Not you?": logs out and comes back to the same request after the next login. */
export async function switchAccountAction(formData: FormData): Promise<void> {
  const query = queryFrom(formData);
  await destroySession();
  redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
}
