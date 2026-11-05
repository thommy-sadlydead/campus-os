// The learning management systems Campus OS syncs from, and what a
// student's own connection to each one can read. Canvas and Schoology let a
// student make their own API key or token. D2L Brightspace and Blackboard
// don't, so a student connects them with the Campus OS Chrome extension,
// which reads them with the sign-in already in their browser (see
// chrome-extension/README.md), or, without Chrome on a computer, with
// their calendar feed, which carries due dates but not directions,
// submissions or files.
//
// Pure (no Prisma or Next.js), so client components can use it too.

export const LMS_PROVIDERS = ["canvas", "schoology", "brightspace", "blackboard"] as const;
export type LmsProvider = (typeof LMS_PROVIDERS)[number];

/** The providers connected through a calendar feed link rather than an API. */
export const FEED_PROVIDERS = ["brightspace", "blackboard"] as const;
export type FeedProvider = (typeof FEED_PROVIDERS)[number];

export function isLmsProvider(value: unknown): value is LmsProvider {
  return typeof value === "string" && (LMS_PROVIDERS as readonly string[]).includes(value);
}

export function isFeedProvider(value: unknown): value is FeedProvider {
  return typeof value === "string" && (FEED_PROVIDERS as readonly string[]).includes(value);
}

export interface LmsCapabilities {
  /** Directions/instructions for each assignment. */
  directions: boolean;
  /** Whether the student has turned each assignment in, or it's been graded. */
  submissionStatus: boolean;
  /** Books, slides, syllabi and other course files, for notes and the class assistant. */
  materials: boolean;
}

export interface LmsProviderInfo {
  id: LmsProvider;
  /** Short name, for buttons and links: "Open in Brightspace". */
  name: string;
  /** What students may know it as, for the connect page. */
  fullName: string;
  capabilities: LmsCapabilities;
}

export const LMS_PROVIDER_INFO: Record<LmsProvider, LmsProviderInfo> = {
  canvas: {
    id: "canvas",
    name: "Canvas",
    fullName: "Canvas",
    capabilities: { directions: true, submissionStatus: true, materials: true },
  },
  schoology: {
    id: "schoology",
    name: "Schoology",
    fullName: "Schoology",
    capabilities: { directions: true, submissionStatus: true, materials: true },
  },
  brightspace: {
    id: "brightspace",
    name: "Brightspace",
    fullName: "D2L Brightspace",
    capabilities: { directions: false, submissionStatus: false, materials: false },
  },
  blackboard: {
    id: "blackboard",
    name: "Blackboard",
    fullName: "Blackboard Learn",
    capabilities: { directions: false, submissionStatus: false, materials: false },
  },
};

/** What Brightspace and Blackboard bring in through the Chrome extension. */
export const EXTENSION_CAPABILITIES: LmsCapabilities = { directions: true, submissionStatus: true, materials: true };

/** What a connection reads: by calendar link, LMS_PROVIDER_INFO's; through the extension, all of it. */
export function capabilitiesFor(provider: LmsProvider, method: string | null | undefined): LmsCapabilities {
  return method === "extension" ? EXTENSION_CAPABILITIES : LMS_PROVIDER_INFO[provider].capabilities;
}

/** "Canvas", or null for a class that wasn't synced from an LMS. */
export function lmsName(provider: string | null | undefined): string | null {
  return isLmsProvider(provider) ? LMS_PROVIDER_INFO[provider].name : null;
}

/** A synced item's own page in its LMS, for "Open in Canvas". */
export interface LmsLink {
  url: string;
  /** The LMS's short name: "Canvas". */
  name: string;
}

/**
 * The link for an item synced from `provider`, or null when there isn't a
 * usable one. Only http(s) links: the URL came from the LMS (or a calendar
 * feed), and it ends up in an href.
 */
export function lmsLink(url: string | null | undefined, provider: string | null | undefined): LmsLink | null {
  const name = lmsName(provider);
  if (!url || !name) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? { url: parsed.toString(), name } : null;
  } catch {
    return null;
  }
}

/**
 * "Brightspace", or "Brightspace and Blackboard": the given LMSs that don't
 * tell Campus OS what the student has turned in. Null when they all do.
 */
export function namesWithoutSubmissionStatus(connections: { provider: LmsProvider; method?: string | null }[]): string | null {
  const names = [...new Set(connections.filter((c) => !capabilitiesFor(c.provider, c.method).submissionStatus).map((c) => c.provider))]
    .map((p) => LMS_PROVIDER_INFO[p].name);
  if (names.length === 0) return null;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
