#!/usr/bin/env node
// Packages the Campus OS Chrome extension (chrome-extension/).
//
//   node scripts/build-extension.mjs          → chrome-extension/campus-os-connector-<version>.zip,
//                                               the file to upload to the Chrome Web Store
//   node scripts/build-extension.mjs --dev    → chrome-extension/dist-dev/, to load unpacked
//                                               (chrome://extensions → Developer mode → Load unpacked).
//                                               It also trusts this computer's Campus OS
//                                               (localhost:3014) and the stand-in LMS
//                                               (scripts/lms-standin, localhost:4010).
//
// The extension has no build step of its own: the published files are the
// ones in chrome-extension/, so what's reviewed is what runs.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "chrome-extension");
const FILES = ["manifest.json", "popup.html", "popup.css", "icons", "src"];
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));

if (process.argv.includes("--dev")) {
  const out = path.join(root, "dist-dev");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  for (const f of FILES) cpSync(path.join(root, f), path.join(out, f), { recursive: true });
  const local = ["http://localhost:3014", "http://127.0.0.1:3014"];
  const standIn = ["http://localhost:4010/*", "http://127.0.0.1:4010/*"];
  const dev = structuredClone(manifest);
  dev.name = `${manifest.name} (development)`;
  // Granted up front so a scripted run never stops at a permission prompt.
  dev.host_permissions = [...manifest.host_permissions, ...local.map((o) => `${o}/*`), ...standIn, "https://*.blackboardcdn.com/*"];
  dev.content_scripts[0].matches = [...manifest.content_scripts[0].matches, ...local.map((o) => `${o}/*`)];
  writeFileSync(path.join(out, "manifest.json"), JSON.stringify(dev, null, 2) + "\n");
  const config = path.join(out, "src", "config.js");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(/^export const API_ORIGINS = (\[[^\]]*\]);$/m, (_, list) =>
      `export const API_ORIGINS = ${JSON.stringify([...JSON.parse(list), ...local])};`
    )
  );
  console.log(`Development build in ${path.relative(process.cwd(), out)}. Load it unpacked from chrome://extensions.`);
} else {
  const zip = path.join(root, `campus-os-connector-${manifest.version}.zip`);
  if (existsSync(zip)) rmSync(zip);
  execFileSync("zip", ["-r", "-X", "-q", zip, ...FILES, "-x", "*.DS_Store"], { cwd: root });
  console.log(`Chrome Web Store package: ${path.relative(process.cwd(), zip)}`);
}
