// Runs on Campus OS's own pages only (see manifest.json). Lets the Connect
// page see that the extension is installed, pair it with the signed-in
// account, and start a sync. Messages are only taken from this page itself
// (same window, same origin), and the service worker checks the origin too.
(() => {
  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.campusOsExtension = version;

  const post = (message) => window.postMessage({ source: "campus-os-extension", ...message }, location.origin);
  const ask = (message) =>
    chrome.runtime.sendMessage(message).catch(() => ({ error: "The extension didn't answer. Reload the page and try again." }));

  async function announce() {
    post({ type: "status", version, ...(await ask({ type: "bridge-status" })) });
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== "campus-os-app") return;
    if (message.type === "hello") await announce();
    if (message.type === "pair") {
      const result = await ask({ type: "pair", code: String(message.code ?? "") });
      post({ type: result.error ? "pair-failed" : "paired", ...result });
      await announce();
    }
    if (message.type === "sync") {
      post({ type: "sync-result", provider: message.provider, ...(await ask({ type: "sync-provider", provider: String(message.provider) })) });
      await announce();
    }
  });

  announce();
})();
