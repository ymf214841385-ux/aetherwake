#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";

const raw = new URL(process.env.E2E_URL || "http://127.0.0.1:8080/");
raw.searchParams.set("t", String(Date.now()));
const url = checkedUrl(raw.href);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });

const views = [
  { id: "spawn-vista", x: 16, z: 96, yaw: 0, pitch: 0.28, dist: 9, note: "spawn looking toward dawn tower" },
  { id: "hero-close", x: 16, z: 100, yaw: 0.12, pitch: -0.04, dist: 2.35, note: "hero close-up" },
  { id: "cliff-lookback", x: 22, z: 88, yaw: 3.0, pitch: 0.22, dist: 8, note: "cliff look back" },
  { id: "glide-down", x: 12, z: 82, yaw: 0.2, pitch: 0.7, dist: 10, note: "high look / glide angle" },
  { id: "lake-shore", x: -62, z: 28, yaw: 1.4, pitch: 0.22, dist: 10, note: "lake shore" },
  { id: "ruin-camp", x: 24, z: 76, yaw: 0.5, pitch: 0.28, dist: 12, note: "wind ruin" },
];

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);
const start = page.getByRole("button", { name: "开始探索" });
if (await start.count()) await start.click();
await page.waitForTimeout(1500);

const shots = [];
for (const v of views) {
  await page.evaluate((view) => {
    const sim = window.__sim;
    if (!sim) return;
    sim.mode = "playing";
    sim.player.hp = sim.player.heartsMax;
    sim.player.invuln = 30;
    sim.player.vx = 0;
    sim.player.vy = 0;
    sim.player.vz = 0;
    sim.player.x = view.x;
    sim.player.z = view.z;
    sim.player.y = sim.heightFn(view.x, view.z) + 0.05;
    sim.player.yaw = view.yaw;
    sim.setMove("grounded");
    sim.cam.yaw = view.yaw;
    sim.cam.pitch = view.pitch;
    sim.cam.dist = view.dist;
    sim.cam.x = sim.player.x + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist;
    sim.cam.y = sim.player.y + 1.2 + Math.sin(view.pitch) * view.dist;
    sim.cam.z = sim.player.z + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist;
    sim.cam.lx = sim.player.x;
    sim.cam.ly = sim.player.y + 1.2;
    sim.cam.lz = sim.player.z;
  }, v);
  await page.waitForTimeout(900);
  const path = checkedOutputPath(resolve(outDir, `${v.id}.png`), [outDir]);
  await page.screenshot({ path, type: "png" });
  shots.push({ ...v, path });
}

const perf = await page.evaluate(() => {
  const sim = window.__sim;
  return {
    mode: sim?.mode,
    x: sim?.player.x,
    z: sim?.player.z,
    y: sim?.player.y,
    timeOfDay: sim?.timeOfDay,
    dpr: window.devicePixelRatio,
    size: [window.innerWidth, window.innerHeight],
    ua: navigator.userAgent,
  };
});

console.log(JSON.stringify({ ok: true, shots, perf }, null, 2));
await browser.close();
