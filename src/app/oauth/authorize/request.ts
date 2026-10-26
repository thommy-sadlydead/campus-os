import "server-only";
import { loadClient, oauthOrigin } from "@/lib/oauth/oauth-server";
import {
  authorizationResponseUrl,
  checkAuthorizeParams,
  mcpResource,
  readAuthorizeParams,
  type AuthorizeParams,
} from "@/lib/oauth/oauth";
import type { ClientMetadata } from "@/lib/oauth/oauth";

export type ResolvedAuthorizeRequest =
  // Shown on the page: with an unknown client or redirect URI there's
  // nowhere safe to send the browser back to.
  | { kind: "fatal"; message: string }
  | { kind: "redirect"; url: string }
  | { kind: "ok"; origin: string; client: ClientMetadata; params: AuthorizeParams; scope: string; resource: string };

/** Validates an authorization request, the same way for the page and for Allow/Cancel. */
export async function resolveAuthorizeRequest(query: URLSearchParams): Promise<ResolvedAuthorizeRequest> {
  const origin = await oauthOrigin();
  if (!origin) return { kind: "fatal", message: "Connecting apps isn't set up on this server yet." };
  const params = readAuthorizeParams((key) => query.get(key));
  if (!params.clientId || !params.redirectUri) {
    return { kind: "fatal", message: "This link is missing the app's details. Start connecting again from the app." };
  }
  const client = await loadClient(params.clientId);
  if (!client) return { kind: "fatal", message: "This app can't connect to Campus OS." };
  if (!client.redirectUris.includes(params.redirectUri)) {
    return { kind: "fatal", message: "This link doesn't match the app it says it's from. Start connecting again from the app." };
  }
  const checked = checkAuthorizeParams(params, mcpResource(origin));
  if ("error" in checked) {
    return { kind: "redirect", url: authorizationResponseUrl(params.redirectUri, origin, params.state, checked) };
  }
  return { kind: "ok", origin, client, params, scope: checked.scope, resource: checked.resource };
}
