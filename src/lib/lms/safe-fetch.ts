// Fetches a link a student pasted (a calendar feed, a web page to save as
// class material) without letting it reach anything that isn't on the
// public internet. Every address a name resolves to is checked at connect
// time (so a DNS answer can't change between the check and the request),
// every redirect is checked again, and the response is capped in size and
// time.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export type SafeFetchErrorCode = "not-public" | "insecure" | "too-large" | "timeout" | "unreachable" | "http-error" | "redirects" | "bad-url";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly code: SafeFetchErrorCode,
    /** The HTTP status, for "http-error". */
    readonly status?: number
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address is on the public internet (not private, loopback, link-local, reserved...). */
export function isPublicAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) return !blocked.check(address, "ipv6");
  return false;
}

/** Local addresses are allowed only in development, with LMS_ALLOW_LOCAL_URLS=1, for testing against a local server. */
function localAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LMS_ALLOW_LOCAL_URLS === "1";
}

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || (!localAllowed() && !list.every((a) => isPublicAddress(a.address)))) {
      return callback(new SafeFetchError("That link doesn't point to a public website.", "not-public"), "", 0);
    }
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

/** A pasted feed link as a fetchable URL: webcal:// becomes https://, and http:// is upgraded. Null if it isn't a link. */
export function normalizeFeedUrl(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  value = value.replace(/^webcals?:\/\//i, "https://");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" && !(localAllowed() && isLocalHost(url.hostname))) url.protocol = "https:";
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Checks an address the server will call later (a school's Canvas URL):
 * https, and every address its name resolves to is public. Throws a
 * SafeFetchError meant for the student otherwise.
 */
export async function assertPublicHost(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("That doesn't look like a web address.", "bad-url");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (localAllowed() && isLocalHost(url.hostname)) return;
  if (url.protocol !== "https:") throw new SafeFetchError("Use your school's secure (https://) address.", "insecure");
  const addresses = isIP(host)
    ? [host]
    : await dns.promises
        .lookup(host, { all: true })
        .then((list) => list.map((a) => a.address))
        .catch(() => {
          throw new SafeFetchError("Couldn't find that address. Check it and try again.", "unreachable");
        });
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new SafeFetchError("That address isn't a public website.", "not-public");
  }
}

interface FetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  /** Allow http:// as well as https:// (web pages; never for links that carry a token). */
  allowHttp?: boolean;
  accept?: string;
  userAgent?: string;
}

export interface PublicResponse {
  contentType: string;
  body: Buffer;
}

function requestOnce(
  url: URL,
  options: FetchOptions,
  deadline: number
): Promise<{ status: number; location: string | null; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: publicOnlyLookup,
        timeout: remaining,
        headers: {
          "User-Agent": options.userAgent ?? "CampusOS/1.0",
          Accept: options.accept ?? "*/*",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location: res.headers.location ?? null, contentType, body: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            req.destroy(new SafeFetchError("That's too large to read.", "too-large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, location: null, contentType, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new SafeFetchError("That link took too long to answer.", "timeout")));
    req.on("error", reject);
    setTimeout(() => req.destroy(new SafeFetchError("That link took too long to answer.", "timeout")), remaining).unref();
    req.end();
  });
}

/** GETs a public URL, following up to `maxRedirects` redirects, each checked again. */
export async function fetchPublic(rawUrl: string, options: FetchOptions): Promise<PublicResponse> {
  const deadline = Date.now() + options.timeoutMs;
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop++) {
    const local = localAllowed() && isLocalHost(url.hostname);
    const allowed = url.protocol === "https:" || (url.protocol === "http:" && (local || options.allowHttp));
    if (!allowed) throw new SafeFetchError("Only secure (https) links can be used.", "insecure");
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !local && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
      throw new SafeFetchError("That link doesn't point to a public website.", "not-public");
    }
    let result;
    try {
      result = await requestOnce(url, options, deadline);
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;
      throw new SafeFetchError("Couldn't reach that link. Check it and try again.", "unreachable");
    }
    if (result.status >= 300 && result.status < 400) {
      if (!result.location) throw new SafeFetchError("That link redirected nowhere.", "redirects");
      url = new URL(result.location, url);
      continue;
    }
    if (result.status < 200 || result.status >= 300) {
      throw new SafeFetchError(`That link answered with an error (${result.status}).`, "http-error", result.status);
    }
    return { contentType: result.contentType, body: result.body };
  }
  throw new SafeFetchError("That link redirected too many times.", "redirects");
}

/** fetchPublic's body as UTF-8 text. */
export async function fetchPublicText(rawUrl: string, options: FetchOptions): Promise<string> {
  return (await fetchPublic(rawUrl, options)).body.toString("utf8");
}
