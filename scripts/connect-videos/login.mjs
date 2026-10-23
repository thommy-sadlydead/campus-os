// Logs the headless profile in to the local dev server with the seed
// account (prisma/seed.ts), so render.mjs can film the Connect pages.
// Local only: never point this at the live site.
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = process.env.CONNECT_VIDEOS_URL || "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error(`${BASE} isn't a local dev server`);
const seed = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../../prisma/seed.ts"), "utf8");
const email = seed.match(/DEMO_EMAIL = "([^"]+)"/)[1];
const password = seed.match(/DEMO_PASSWORD = "([^"]+)"/)[1];

const page = await launch();
await page.goto(`${BASE}/dashboard`);
await sleep(1500);
if ((await page.eval("location.pathname")) !== "/dashboard") {
  await page.goto(`${BASE}/login`);
  await sleep(2500);
  await page.eval(`(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("email", ${JSON.stringify(email)});
    set("password", ${JSON.stringify(password)});
    document.querySelector("form button[type=submit]").click();
    return true;
  })()`);
  await sleep(4000);
}
const where = await page.eval("location.pathname");
await page.close();
if (where !== "/dashboard") throw new Error("Couldn't log in. Run npm run db:seed against the local database first.");
console.log(`Logged in as ${email}`);
