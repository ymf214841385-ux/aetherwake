/**
 * First-waypoint only: spawn → (40,80) with sprint. Aborts on first failure.
 * E2E_URL=http://127.0.0.1:8115/ node scripts/qa/first-wp-diag.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { walkTo } from "./nav-walk.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[first-wp] ${m}`);
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
async function hold(keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}
async function lookToward(tx, tz) {
  // one evaluate; one short turn burst if needed
  const s0 = await read();
  if (!s0) return null;
  const want = Math.atan2(-(tx - s0.x), -(tz - s0.z));
  let err = want - s0.camYaw;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  if (Math.abs(err) < 0.25) return s0;
  const key = err > 0 ? "ArrowLeft" : "ArrowRight";
  await hold([key], Math.min(250, Math.max(80, Math.abs(err) * 100)));
  return s0; // do not re-read
}

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(1000);
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
    await wait(500);
    s = await read();
  }
  note(`mode=${s?.mode} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)} t=${s?.t?.toFixed(2)}`);
  if (s?.mode !== "playing") throw new Error("not playing");

  const t0 = s.t;
  const r = await walkTo(
    {
      read,
      lookToward,
      hold: (keys, ms) => hold([...keys, "ShiftLeft"], ms),
    },
    40,
    80,
    40000,
    { arrive: 3.5, expectShrine: null, stepMs: 2000 },
  );
  const s2 = r.s;
  note(
    `result ${r.status} steps=${r.steps} dist=${r.dist?.toFixed(1)} simDt=${((s2?.t ?? 0) - t0).toFixed(2)}s at ${s2?.x?.toFixed(1)},${s2?.z?.toFixed(1)} state=${s2?.state}`,
  );
  writeFileSync(
    resolve(outDir, "first-wp-diag.json"),
    JSON.stringify({ status: r.status, steps: r.steps, dist: r.dist, simDt: (s2?.t ?? 0) - t0, final: s2, log }, null, 2),
  );
} catch (e) {
  note(`error ${e?.message || e}`);
  writeFileSync(resolve(outDir, "first-wp-diag.json"), JSON.stringify({ error: String(e?.message || e), log }, null, 2));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
