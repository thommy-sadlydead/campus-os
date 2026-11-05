// The popup: connect to Campus OS, allow the LMS site in this tab, choose
// which courses to import (the student's explicit go-ahead), and see sync
// progress. Course names come from the LMS, so everything is built with
// textContent, never innerHTML.

import { PROVIDER_NAMES, guessProvider, siteOrigin, sitePermissions } from "./sites.js";

const view = document.getElementById("view");
let tab = null;
let origin = null;
// While the student is choosing courses, progress updates mustn't redraw the list under them.
let holdUpdates = false;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "onclick") node.addEventListener("click", value);
    else if (key === "class") node.className = value;
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

const send = (message) => chrome.runtime.sendMessage(message);
const host = (o) => new URL(o).host;

function ago(iso) {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return "never";
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function show(...nodes) {
  view.replaceChildren(...nodes);
}

/** Looks for Brightspace or Blackboard in the page, when its address doesn't say (activeTab). */
async function detectInPage() {
  if (!tab?.id) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (document.querySelector("d2l-navigation, d2l-navigation-main-header, [class^='d2l-']")) return "brightspace";
        if (document.querySelector("#bb-root, bb-base-layout, #globalNavPageNavArea")) return "blackboard";
        const links = [...document.querySelectorAll("a[href], script[src], link[href]")].slice(0, 400).map((n) => n.getAttribute("href") || n.getAttribute("src") || "");
        if (links.some((h) => /\/d2l\/(le|lp|home|lms)\//.test(h))) return "brightspace";
        if (links.some((h) => /\/(ultra|webapps)\//.test(h))) return "blackboard";
        return null;
      },
    });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

function openCampusOs(status, path = "/connect") {
  chrome.tabs.create({ url: `${status.apiOrigin}${path}` });
}

function notPaired(status) {
  show(
    el("h1", {}, "Connect to your Campus OS account"),
    el("p", {}, "Open Campus OS, go to Connect → Brightspace or Blackboard, and click “Connect the extension.” Then come back to your school's site and click this button."),
    el("div", { class: "row" }, el("button", { class: "primary", onclick: () => openCampusOs(status) }, "Open Campus OS"))
  );
}

function progressList(job) {
  const phase = {
    connecting: "Checking your sign-in…",
    courses: "Finding your courses…",
    materials: "Importing course files…",
    finishing: "Finishing up…",
    done: "Done.",
    stopped: job?.error ?? "Stopped.",
  }[job?.phase] ?? "Working…";
  const rows = (job?.courses ?? []).map((c) => {
    const state =
      c.phase === "waiting" ? "Waiting"
      : c.phase === "assignments" ? "Reading assignments"
      : c.phase === "listing" ? "Looking for files"
      : c.phase === "importing" ? `${c.done + c.failed} of ${c.total} files`
      : c.phase === "failed" ? "Couldn't read files"
      : c.total === 0 ? "Up to date"
      : `${c.done} new or changed${c.failed ? `, ${c.failed} couldn't` : ""}`;
    return el("li", {}, el("span", {}, c.name), el("span", { class: "state" }, state));
  });
  return [el("p", { class: job?.phase === "stopped" ? "error" : "" }, phase), rows.length ? el("ul", { class: "progress" }, rows) : null];
}

function siteView(status, site) {
  const job = status.jobs?.[site.origin];
  const running = site.running || (job && !["done", "stopped"].includes(job.phase));
  const result = site.lastResult;
  show(
    el("h1", {}, `${PROVIDER_NAMES[site.provider]} at ${host(site.origin)}`),
    el("p", { class: "small" }, `Sending to Campus OS as ${status.email}`),
    el(
      "div",
      { class: "card" },
      el("p", {}, `${site.courseIds.length} course${site.courseIds.length === 1 ? "" : "s"} · last synced ${ago(site.lastSyncAt)}`),
      result && !result.ok && !running ? el("p", { class: "error" }, result.error) : null,
      // A stopped job's message is already shown above as the last result.
      running || job?.phase === "done" ? progressList(job) : null,
      site.paused ? el("p", { class: "error" }, "Access to this site was turned off in Chrome. Allow it again to keep syncing.") : null
    ),
    el(
      "div",
      { class: "row" },
      site.paused
        ? el("button", { class: "primary", onclick: () => allowSite(status, site.provider) }, "Allow again")
        : el("button", { class: "primary", disabled: running, onclick: () => send({ type: "sync", origin: site.origin }).then(render) }, running ? "Syncing…" : "Sync now"),
      el("button", { disabled: running, onclick: () => chooseCourses(status, site.provider, site.courseIds) }, "Change courses"),
      el("button", { onclick: () => openCampusOs(status, `/connect/${site.provider}`) }, "Open Campus OS")
    ),
    el(
      "div",
      { class: "row" },
      el(
        "button",
        {
          disabled: running,
          onclick: async () => {
            await send({ type: "forget-site", origin: site.origin });
            render();
          },
        },
        "Stop syncing this site"
      )
    ),
    el("p", { class: "small" }, "It also syncs on its own when you open this site, if it's been a few hours.")
  );
}

async function allowSite(status, provider) {
  // Must run straight from the click: Chrome only asks inside a user gesture.
  const granted = await chrome.permissions.request(sitePermissions(origin, provider ?? null));
  if (!granted) {
    show(el("h1", {}, "Not allowed"), el("p", {}, "Campus OS can't read this site without your permission. Click the button again whenever you're ready."));
    return;
  }
  return chooseCourses(status, provider, null);
}

async function chooseCourses(status, provider, selected) {
  holdUpdates = true;
  show(el("p", {}, "Checking your sign-in and finding your courses…"));
  const found = await send({ type: "probe", origin, provider });
  if (found.error === "permission") return candidate(status, provider);
  if (found.signedOut) {
    show(el("h1", {}, "Sign in first"), el("p", {}, `Sign in to ${host(origin)} in this tab, then click the Campus OS button again.`));
    return;
  }
  if (found.error) {
    show(el("h1", {}, "Couldn't read this site"), el("p", { class: "error" }, found.error));
    return;
  }
  const p = found.provider;
  if (p === "blackboard" && !(await chrome.permissions.contains(sitePermissions(origin, p)))) {
    show(
      el("h1", {}, "One more permission"),
      el("p", {}, "Blackboard hands course files out from its own file server (blackboardcdn.com). Allow it so the extension can download them."),
      el("div", { class: "row" }, el("button", { class: "primary", onclick: () => allowSite(status, p) }, "Allow file downloads"))
    );
    return;
  }
  if (found.courses.length === 0) {
    show(el("h1", {}, "No courses found"), el("p", {}, `${PROVIDER_NAMES[p]} isn't listing any courses you can open right now.`));
    return;
  }
  const checks = found.courses.map((c) => ({ course: c, box: el("input", { type: "checkbox", checked: selected ? selected.includes(c.id) : true }) }));
  show(
    el("h1", {}, `Import from ${PROVIDER_NAMES[p]}`),
    el("p", {}, "For the courses you check, Campus OS imports their assignments and due dates, and the course files and pages you can open here. They go to your Campus OS account only."),
    el(
      "ul",
      { class: "courses" },
      checks.map(({ course, box }) =>
        el("li", {}, el("label", {}, box, " ", el("span", { class: "name" }, course.name), course.code ? el("div", { class: "small" }, course.code) : null))
      )
    ),
    el(
      "div",
      { class: "row" },
      el(
        "button",
        {
          class: "primary",
          onclick: async () => {
            const chosen = checks.filter((c) => c.box.checked).map((c) => c.course);
            if (chosen.length === 0) return;
            await send({
              type: "save-site",
              origin,
              provider: p,
              courseIds: chosen.map((c) => c.id),
              courseNames: Object.fromEntries(chosen.map((c) => [c.id, c.name])),
            });
            await send({ type: "sync", origin });
            render();
          },
        },
        "Import selected courses"
      )
    ),
    el("p", { class: "small" }, `Signed in to Campus OS as ${status.email}. The extension never sees your school password.`)
  );
}

async function candidate(status, provider) {
  const guess = provider ?? guessProvider(tab.url) ?? (await detectInPage());
  show(
    el("h1", {}, guess ? `${PROVIDER_NAMES[guess]} at ${host(origin)}` : `Is ${host(origin)} your school's Brightspace or Blackboard?`),
    el("p", {}, "Campus OS can import your courses, assignments and course files from this site, using the sign-in you already have here."),
    el("p", { class: "small" }, "Chrome will ask to let the extension read this site. It only reads pages and files your account can already open."),
    el("div", { class: "row" }, el("button", { class: "primary", onclick: () => allowSite(status, guess) }, `Allow access to ${host(origin)}`))
  );
}

function home(status) {
  show(
    el("h1", {}, "Open your school's site"),
    el("p", {}, "Go to your school's Brightspace or Blackboard in this tab, sign in, then click the Campus OS button."),
    status.sites.length
      ? el(
          "ul",
          { class: "progress" },
          status.sites.map((s) =>
            el(
              "li",
              {},
              el("span", {}, `${PROVIDER_NAMES[s.provider]} · ${host(s.origin)}`),
              el("button", { disabled: s.running, onclick: () => send({ type: "sync", origin: s.origin }).then(render) }, s.running ? "Syncing…" : "Sync now")
            )
          )
        )
      : null,
    el("p", { class: "small" }, `Connected to Campus OS as ${status.email}.`),
    el("div", { class: "row" }, el("button", { onclick: () => send({ type: "unpair" }).then(render) }, "Disconnect from Campus OS"))
  );
}

async function render() {
  holdUpdates = false;
  const status = await send({ type: "status" });
  if (!status.paired) return notPaired(status);
  const site = status.sites.find((s) => s.origin === origin);
  if (site) return siteView(status, site);
  if (origin && !status.apiOrigins.includes(origin)) return candidate(status, null);
  return home(status);
}

async function init() {
  // ?tab=<id> opens the popup about another tab, for trying it in a normal tab while testing.
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  origin = tab?.url ? siteOrigin(tab.url) : null;
  await render();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (holdUpdates) return;
    if ((area === "session" && changes.jobs) || (area === "local" && (changes.sites || changes.auth))) render();
  });
}

init();
