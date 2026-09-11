#!/usr/bin/env node
/**
 * Local browser capture for rebuild evidence. Loopback only.
 * Does not write completion flags into the save.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";

const url = checkedUrl(process.env.E2E_URL || "http://127.0.0.1:8080/");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });
const titlePng = checkedOutputPath(resolve(outDir, "title.png"), [outDir]);
const playPng = checkedOutputPath(resolve(outDir, "playing.png"), [outDir]);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on("pageerror", (err) => logs.push(`pageerror ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") logs.push(`console ${msg.text()}`);
});
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: titlePng, type: "png" });
  const start = page.getByRole("button", { name: "开始探索" });
  if (await start.count()) {
    await start.click();
    await page.waitForTimeout(2000);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(800);
    await page.keyboard.up("KeyW");
    await page.screenshot({ path: playPng, type: "png" });
  }
  const hud = await page.evaluate(() => {
    const sim = window.__sim;
    return sim
      ? { mode: sim.mode, x: sim.player.x, z: sim.player.z, y: sim.player.y, state: sim.player.state }
      : null;
  });
  console.log(JSON.stringify({ ok: logs.length === 0, titlePng, playPng, logs, hud }, null, 2));
  await browser.close();
  process.exit(logs.length ? 1 : 0);
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err), logs }, null, 2));
  await browser.close();
  process.exit(1);
}
