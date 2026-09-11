/**
 * Continuous-hold first waypoint probe.
 * Keeps W+Shift down; samples every ~3s; aborts on arrived/timeout.
 * E2E_URL=http://127.0.0.1:8115/ node scripts/qa/first-wp-hold.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { qaChromiumLaunchOptions } from "./lifecycle.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[first-wp-hold] ${m}`);
};

const browser = await chromium.launch(qaChromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

async function read() {
  return page.evaluate(() => {
    const sim = window.__sim;
    if (!sim) return null;
    return {
      mode: sim.mode,
      x: sim.player.x,
      y: sim.player.y,
      z: sim.player.z,
      camYaw: sim.cam.yaw,
      state: sim.player.state,
      t: sim.t,
      shrine: sim.shrine,
    };
  });
}

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(800);
  let s = await read();
  if (s?.mode !== "playing") {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("开始探索"));
      if (b) {
        b.focus();
        b.click();
      }
    });
    await page.keyboard.press("Enter");
    await wait(400);
    s = await read();
  }
  note(`mode=${s?.mode} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)} t=${s?.t?.toFixed(2)}`);
  if (s?.mode !== "playing") throw new Error("not playing");

  const tx = 40;
  const tz = 80;
  const t0 = s.t;
  const start = { x: s.x, z: s.z };

  async function faceTarget(sample) {
    const want = Math.atan2(-(tx - sample.x), -(tz - sample.z));
    let err = want - sample.camYaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    if (Math.abs(err) < 0.2) return sample;
    const key = err > 0 ? "ArrowLeft" : "ArrowRight";
    const ms = Math.min(1200, Math.max(400, Math.abs(err) * 500));
    await page.keyboard.down(key);
    await wait(ms);
    await page.keyboard.up(key);
    return (await read()) || sample;
  }

  s = await faceTarget(s);
  note(`preTurn camYaw=${s?.camYaw?.toFixed(2)} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)}`);

  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  const samples = [];
  let status = "timeout";
  let last = s;
  for (let i = 0; i < 12; i++) {
    await wait(2500);
    last = await read();
    if (!last) {
      status = "no-sim";
      break;
    }
    const dist = Math.hypot(tx - last.x, tz - last.z);
    const want = Math.atan2(-(tx - last.x), -(tz - last.z));
    let err = want - last.camYaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    samples.push({
      i,
      x: +last.x.toFixed(2),
      z: +last.z.toFixed(2),
      y: +last.y.toFixed(2),
      dist: +dist.toFixed(2),
      camYaw: +last.camYaw.toFixed(2),
      err: +err.toFixed(2),
      t: +last.t.toFixed(2),
      state: last.state,
    });
    note(
      `s${i} dist=${dist.toFixed(1)} at ${last.x.toFixed(1)},${last.z.toFixed(1)} y=${last.y.toFixed(1)} err=${err.toFixed(2)} t=${last.t.toFixed(2)} state=${last.state}`,
    );
    if (dist < 3.5) {
      status = "arrived";
      break;
    }
    if (Math.abs(err) > 0.35) {
      await page.keyboard.up("KeyW");
      await page.keyboard.up("ShiftLeft");
      last = (await faceTarget(last)) || last;
      await page.keyboard.down("KeyW");
      await page.keyboard.down("ShiftLeft");
    }
  }
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyW");
  const moved = Math.hypot(last.x - start.x, last.z - start.z);
  const simDt = last.t - t0;
  note(`done ${status} moved=${moved.toFixed(1)}m simDt=${simDt.toFixed(2)}s wall≈30s dist=${Math.hypot(tx - last.x, tz - last.z).toFixed(1)}`);
  writeFileSync(
    resolve(outDir, "first-wp-hold.json"),
    JSON.stringify(
      { status, start, end: { x: last.x, z: last.z }, moved, simDt, dist: Math.hypot(tx - last.x, tz - last.z), samples, log },
      null,
      2,
    ),
  );
} catch (e) {
  note(`error ${e?.message || e}`);
  writeFileSync(resolve(outDir, "first-wp-hold.json"), JSON.stringify({ error: String(e?.message || e), log }, null, 2));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
