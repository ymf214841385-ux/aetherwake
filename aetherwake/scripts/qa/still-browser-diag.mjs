/**
 * Limited browser diagnostic: HTTP → page → scripts → __sim → mode → one input.
 * Run: E2E_URL=http://127.0.0.1:8091/ node scripts/qa/still-browser-diag.mjs
 */
import { chromium } from "playwright";
import { qaChromiumLaunchOptions } from "./lifecycle.mjs";

const url = process.env.E2E_URL || "http://127.0.0.1:8091/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
function note(m) {
  log.push({ t: Date.now(), m });
  console.log(`[diag] ${m}`);
}

note(`url=${url}`);
const browser = await chromium.launch(qaChromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message || e)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console: ${msg.text().slice(0, 200)}`);
});

try {
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  note(`goto status=${resp?.status()}`);
  note(`title=${await page.title()}`);
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")).slice(0, 12),
  );
  note(`scripts=${JSON.stringify(scripts)}`);
  const bodyText = (await page.locator("body").innerText()).slice(0, 240).replace(/\n/g, " | ");
  note(`body=${bodyText}`);

  for (let i = 0; i < 8; i++) {
    const has = await page.evaluate(() => Boolean(window.__sim));
    note(`t+${i * 500}ms __sim=${has}`);
    if (has) break;
    await wait(500);
  }

  let s = await page.evaluate(() => {
    const sim = window.__sim;
    if (!sim) return null;
    return { mode: sim.mode, x: sim.player?.x, y: sim.player?.y, z: sim.player?.z };
  });
  note(`sim0=${JSON.stringify(s)}`);

  // Try start button
  try {
    await page.getByRole("button", { name: "开始探索" }).click({ timeout: 2500 });
    note("clicked 开始探索");
  } catch (e) {
    note(`start click fail: ${e?.message?.slice(0, 120)}`);
  }
  await wait(1200);
  s = await page.evaluate(() => {
    const sim = window.__sim;
    if (!sim) return null;
    return { mode: sim.mode, x: sim.player?.x, z: sim.player?.z, prompt: sim.prompt };
  });
  note(`sim1=${JSON.stringify(s)}`);

  if (s?.mode === "playing") {
    const x0 = s.x;
    const z0 = s.z;
    await page.locator("canvas").focus().catch(() => {});
    await page.keyboard.down("KeyW");
    await wait(500);
    await page.keyboard.up("KeyW");
    const s2 = await page.evaluate(() => {
      const sim = window.__sim;
      return sim ? { x: sim.player.x, z: sim.player.z, mode: sim.mode } : null;
    });
    note(`afterW moved=${s2 ? Math.hypot(s2.x - x0, s2.z - z0).toFixed(2) : "?"} ${JSON.stringify(s2)}`);
  }

  if (errors.length) note(`errors=${JSON.stringify(errors.slice(0, 8))}`);
} catch (e) {
  note(`fatal ${e?.message || e}`);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  note("done");
}
