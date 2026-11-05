// What the popup and the service worker share about LMS sites. No chrome.*.

/** Permission for an LMS site (and, for Blackboard, the file server it hands downloads to). */
export function sitePermissions(origin, provider) {
  return { origins: [`${origin}/*`, ...(provider === "blackboard" ? ["https://*.blackboardcdn.com/*"] : [])] };
}

/**
 * A first guess from the page's address: Brightspace pages are under
 * /d2l/, Blackboard's under /ultra/ or /webapps/. Only a guess; the API
 * check after the student allows the site is what decides.
 */
export function guessProvider(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  if (/^\/d2l(\/|$)/i.test(path)) return "brightspace";
  if (/^\/(ultra|webapps)(\/|$)/i.test(path)) return "blackboard";
  return null;
}

/** Sites the extension may ask for: https, or this computer while developing. */
export function siteOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return u.origin;
    if (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return u.origin;
    return null;
  } catch {
    return null;
  }
}

export const PROVIDER_NAMES = { brightspace: "Brightspace", blackboard: "Blackboard" };
