// node scripts/connect-videos/render.mjs <canvas|schoology|brightspace|blackboard> [--preview | --poster]
//
// Draws every frame of one walkthrough (cw.js) in headless Chrome and encodes
// public/videos/connect-<lms>.mp4 plus its poster (the first frame). The last
// scene films the real Connect page on the local dev server, so log in first
// (login.mjs). --preview saves a few stills per scene instead; --poster only
// writes the poster (the Connect page shows it, so make posters first).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, sleep } from "./cdp.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PUBLIC = path.join(HERE, "../../public/videos");
const BASE = process.env.CONNECT_VIDEOS_URL || "http://localhost:3100";
const FPS = 30;
// Web fonts load lazily, so each scene waits for every face it might use.
const FONTS = ["400 16px Geist", "500 16px Geist", "600 16px Geist", "700 16px Geist", "400 16px Lato", "700 16px Lato", '400 16px "Open Sans"'];

const [lms, flag] = process.argv.slice(2);
if (!["canvas", "schoology", "brightspace", "blackboard"].includes(lms)) throw new Error("usage: render.mjs <lms> [--preview | --poster]");
const preview = flag === "--preview";
const posterOnly = flag === "--poster";
const work = fs.mkdtempSync(path.join(os.tmpdir(), `connect-video-${lms}-`));

const cw = fs.readFileSync(path.join(HERE, "cw.js"), "utf8");
const page = await launch();
await page.goto(`file://${HERE}/walkthrough.html`);
const scenes = await page.eval(`CW.meta(${JSON.stringify(lms)})`);

let n = 0;
for (let i = 0; i < (posterOnly ? 1 : scenes.length); i++) {
  const { dur, live } = scenes[i];
  if (live) {
    await page.goto(BASE + live);
    await sleep(2200);
    if ((await page.eval("location.pathname")) !== live) throw new Error(`${live} redirected: log in with login.mjs first`);
    await page.eval(cw);
  } else {
    await page.goto(`file://${HERE}/walkthrough.html`);
  }
  await page.eval(`CW.init(${JSON.stringify(lms)}, ${i})`);
  await page.eval(`Promise.all(${JSON.stringify(FONTS)}.map((f) => document.fonts.load(f))).then(() => document.fonts.ready).then(() => true)`);
  await sleep(200);
  const times = posterOnly ? [0] : preview ? [0.15, 0.35, 0.55, 0.8].map((f) => f * dur) : Array.from({ length: Math.round(dur * FPS) }, (_, f) => f / FPS);
  for (const t of times) {
    await page.eval(`CW.seek(${t.toFixed(4)})`);
    await page.shot(path.join(work, `${String(n++).padStart(5, "0")}.png`));
  }
}
await page.close();

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const poster = () => ffmpeg("-i", path.join(work, "00000.png"), "-vf", "scale=480:-2", "-q:v", "4", path.join(PUBLIC, `connect-${lms}.jpg`));
fs.mkdirSync(PUBLIC, { recursive: true });
if (preview) {
  console.log(`Stills in ${work}`);
} else if (posterOnly) {
  poster();
  fs.rmSync(work, { recursive: true, force: true });
} else {
  const mp4 = path.join(PUBLIC, `connect-${lms}.mp4`);
  ffmpeg("-framerate", String(FPS), "-i", path.join(work, "%05d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", "26",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4);
  poster();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`${mp4}: ${(n / FPS).toFixed(1)}s, ${(fs.statSync(mp4).size / 1024).toFixed(0)} KB`);
}
