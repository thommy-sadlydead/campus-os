// A small Chrome DevTools Protocol driver (Node's built-in WebSocket): opens
// headless Chrome at iPhone size for rendering the connect videos.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const W = 390;
export const H = 844;
export const DPR = 2;
// Kept between runs so the login from login.mjs sticks.
export const PROFILE = path.join(os.tmpdir(), "campus-os-connect-videos-chrome");

export async function launch() {
  const port = 9333;
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${PROFILE}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("Chrome didn't start (set CHROME_PATH?)");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const waitFor = (method) =>
    new Promise((resolve) => {
      const l = (msg) => msg.method === method && (listeners.delete(l), resolve(msg.params));
      listeners.add(l);
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await send("Emulation.setUserAgentOverride", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  });

  return {
    async goto(url) {
      const loaded = waitFor("Page.loadEventFired");
      await send("Page.navigate", { url });
      await loaded;
    },
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    },
    async close() {
      try {
        await send("Browser.close");
      } catch {}
      proc.kill();
    },
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
