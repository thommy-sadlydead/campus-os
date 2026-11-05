// The extension's service worker: pairing with Campus OS, the sites the
// student allowed, running syncs (one per site at a time) and keeping their
// progress where the popup and the Campus OS page can see it.
//
// Storage (chrome.storage.local, only this extension can read it):
//   auth:  { token, email, apiOrigin }      from pairing; never a password or cookie
//   sites: { [origin]: { provider, courseIds, courseNames, lastSyncAt, lastResult } }
// chrome.storage.session (cleared when Chrome closes):
//   jobs:  { [origin]: progress snapshot from runSync }

import { API_ORIGINS, AUTO_SYNC_HOURS } from "./config.js";
import { ApiError, makeApi, pair } from "./api.js";
import { readerFor, runSync } from "./sync.js";
import { NotSupportedError, SessionError, makeLmsFetch } from "./lms/common.js";
import { sitePermissions } from "./sites.js";

const running = new Set();

async function getAuth() {
  return (await chrome.storage.local.get("auth")).auth ?? null;
}
async function getSites() {
  return (await chrome.storage.local.get("sites")).sites ?? {};
}
async function saveSites(sites) {
  await chrome.storage.local.set({ sites });
}
async function getJobs() {
  return (await chrome.storage.session.get("jobs")).jobs ?? {};
}
async function setJob(origin, job) {
  const jobs = await getJobs();
  jobs[origin] = job;
  await chrome.storage.session.set({ jobs });
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function scriptId(origin) {
  return `lms-visit-${origin.replace(/[^a-z0-9]/gi, "_")}`;
}

/** Lets the extension notice when the student opens this LMS, to sync if it's been a while. */
async function watchSite(origin) {
  const id = scriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length > 0) return;
  await chrome.scripting.registerContentScripts([
    { id, matches: [`${origin}/*`], js: ["src/lms-visit.js"], runAt: "document_idle", persistAcrossSessions: true },
  ]);
}

async function unwatchSite(origin) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptId(origin)] });
  } catch {
    // Not registered.
  }
}

function setBadge(text, color = "#4f46e5") {
  chrome.action.setBadgeText({ text });
  if (text) chrome.action.setBadgeBackgroundColor({ color });
}

async function status() {
  const [auth, sites, jobs] = await Promise.all([getAuth(), getSites(), getJobs()]);
  return {
    paired: Boolean(auth),
    email: auth?.email ?? null,
    apiOrigin: auth?.apiOrigin ?? API_ORIGINS[0],
    apiOrigins: API_ORIGINS,
    sites: Object.entries(sites).map(([origin, s]) => ({ origin, ...s, running: running.has(origin) })),
    jobs,
  };
}

/** A sync of one site, in the background. Resolves once it's started (or already running). */
async function startSync(origin, { reason = "manual" } = {}) {
  if (running.has(origin)) return { started: false, running: true };
  const [auth, sites] = await Promise.all([getAuth(), getSites()]);
  const site = sites[origin];
  if (!auth) return { error: "Connect the extension to Campus OS first." };
  if (!site || site.courseIds.length === 0) return { error: "Choose which courses to import first." };
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
    return { error: "The extension no longer has permission for this site. Open it and click the Campus OS button to allow it again." };
  }

  running.add(origin);
  setBadge("…");
  // Extension API calls keep the service worker awake through a long sync.
  const keepAwake = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  const api = makeApi({ apiOrigin: auth.apiOrigin, token: auth.token });
  runSync({
    provider: site.provider,
    origin,
    courseIds: site.courseIds,
    courseNames: site.courseNames ?? {},
    api,
    onProgress: (snapshot) => setJob(origin, { ...snapshot, reason }),
  })
    .then(async (result) => {
      const latest = await getSites();
      if (latest[origin]) {
        latest[origin].lastAttemptAt = new Date().toISOString();
        if (result.ok) latest[origin].lastSyncAt = latest[origin].lastAttemptAt;
        latest[origin].lastResult = result.ok ? { ok: true, summary: result.summary } : { ok: false, error: result.error, signedOut: result.signedOut };
        await saveSites(latest);
      }
      setBadge(result.ok ? "" : "!", "#dc2626");
      // A token Campus OS no longer accepts: forget it, so the popup asks to connect again.
      if (!result.ok && /disconnected from Campus OS|Connect the extension/.test(result.error ?? "")) {
        await chrome.storage.local.remove("auth");
      }
    })
    .finally(() => {
      clearInterval(keepAwake);
      running.delete(origin);
    });
  return { started: true };
}

function isDue(site, now = Date.now()) {
  const last = Date.parse(site.lastSyncAt ?? "");
  const tried = Date.parse(site.lastAttemptAt ?? "");
  if (!Number.isNaN(tried) && now - tried < 10 * 60_000) return false;
  return Number.isNaN(last) || now - last > AUTO_SYNC_HOURS * 60 * 60_000;
}

async function maybeAutoSync(origin) {
  if (!origin || running.has(origin)) return { started: false };
  const [auth, sites] = await Promise.all([getAuth(), getSites()]);
  const site = sites[origin];
  if (!auth || !site || site.paused || !isDue(site)) return { started: false };
  return startSync(origin, { reason: "auto" });
}

/** Signed in? Which courses? For the popup, once the student has allowed the site. */
async function probe(origin, provider) {
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return { error: "permission" };
  const lms = makeLmsFetch(origin);
  const tries = provider ? [provider] : ["brightspace", "blackboard"];
  let lastError = null;
  for (const p of tries) {
    try {
      const reader = readerFor(p, lms);
      const me = await reader.connect();
      const courses = await reader.listCourses();
      return { provider: p, userName: me.userName, courses };
    } catch (err) {
      if (err instanceof SessionError) return { provider: p, signedOut: true, error: err.message };
      lastError = err;
    }
  }
  return { error: lastError instanceof NotSupportedError ? lastError.message : "This site didn't answer like Brightspace or Blackboard." };
}

async function handle(msg, sender) {
  const fromOrigin = originOf(sender.url ?? sender.origin ?? "");
  const fromApp = fromOrigin && API_ORIGINS.includes(fromOrigin) && sender.id === chrome.runtime.id;
  // The extension's own pages (the popup, or the popup page opened in a tab), never a website.
  const fromPopup = sender.id === chrome.runtime.id && (sender.url ?? "").startsWith(chrome.runtime.getURL(""));

  switch (msg?.type) {
    // From the popup.
    case "status":
      if (!fromPopup) return { error: "Not allowed." };
      return status();
    case "probe":
      if (!fromPopup) return { error: "Not allowed." };
      return probe(String(msg.origin), msg.provider ?? null);
    case "save-site": {
      if (!fromPopup) return { error: "Not allowed." };
      const origin = String(msg.origin);
      const sites = await getSites();
      sites[origin] = {
        ...(sites[origin] ?? {}),
        provider: msg.provider,
        courseIds: (msg.courseIds ?? []).map(String),
        courseNames: msg.courseNames ?? {},
        paused: false,
      };
      await saveSites(sites);
      await watchSite(origin);
      return { ok: true };
    }
    case "sync":
      if (!fromPopup) return { error: "Not allowed." };
      return startSync(String(msg.origin));
    case "forget-site": {
      if (!fromPopup) return { error: "Not allowed." };
      const origin = String(msg.origin);
      const sites = await getSites();
      const provider = sites[origin]?.provider;
      delete sites[origin];
      await saveSites(sites);
      await unwatchSite(origin);
      await chrome.permissions.remove(sitePermissions(origin, provider)).catch(() => {});
      return { ok: true };
    }
    case "unpair": {
      if (!fromPopup) return { error: "Not allowed." };
      const auth = await getAuth();
      if (auth) await makeApi(auth).disconnect().catch(() => {});
      await chrome.storage.local.remove("auth");
      return { ok: true };
    }

    // From the Campus OS page (src/app-bridge.js).
    case "bridge-status": {
      if (!fromApp) return { error: "Not allowed." };
      const s = await status();
      return { paired: s.paired, email: s.email, apiOrigin: s.apiOrigin, sites: s.sites.map(({ origin, provider, lastSyncAt, lastResult, running: r }) => ({ origin, provider, lastSyncAt, lastResult, running: r })) };
    }
    case "pair": {
      if (!fromApp) return { error: "Not allowed." };
      try {
        const { token, email } = await pair(fromOrigin, String(msg.code ?? ""));
        await chrome.storage.local.set({ auth: { token, email, apiOrigin: fromOrigin } });
        return { paired: true, email };
      } catch (err) {
        return { error: err instanceof ApiError ? err.message : "Couldn't reach Campus OS. Try again." };
      }
    }
    case "sync-provider": {
      if (!fromApp) return { error: "Not allowed." };
      const sites = await getSites();
      const origins = Object.entries(sites).filter(([, s]) => s.provider === msg.provider).map(([o]) => o);
      if (origins.length === 0) return { error: "notSetUp" };
      const results = await Promise.all(origins.map((o) => startSync(o)));
      const failed = results.find((r) => r.error);
      return failed ?? { started: true };
    }

    // From an LMS page the student allowed (src/lms-visit.js).
    case "lms-visit":
      if (!sender.tab || !fromOrigin) return {};
      return maybeAutoSync(fromOrigin);
    default:
      return { error: "Unknown request." };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err) => sendResponse({ error: err?.message ?? "Something went wrong." }));
  return true;
});

// Every hour: any allowed site that's open in a tab and due gets synced,
// since its sign-in is likely still good.
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("auto-sync", { periodInMinutes: 60 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("auto-sync", { periodInMinutes: 60 }));
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "auto-sync") return;
  const sites = await getSites();
  for (const origin of Object.keys(sites)) {
    const tabs = await chrome.tabs.query({ url: `${origin}/*` }).catch(() => []);
    if (tabs.length > 0) await maybeAutoSync(origin);
  }
});

// Permission taken away in Chrome's settings: stop watching that site.
chrome.permissions.onRemoved.addListener(async ({ origins = [] }) => {
  const sites = await getSites();
  for (const pattern of origins) {
    const origin = pattern.replace(/\/\*$/, "");
    if (sites[origin]) {
      sites[origin].paused = true;
      await unwatchSite(origin);
    }
  }
  await saveSites(sites);
});
