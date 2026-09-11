/**
 * First waypoint with real lookToward (aligned-only W).
 * E2E_URL=http://127.0.0.1:8115/ node scripts/qa/first-wp-aligned.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { lookToward, walkTo, yawError } from "./nav-walk.mjs";

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

const io = { read, hold, lookToward: (tx, tz, opts) => lookToward({ read, hold }, tx, tz, opts) };

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
  note(`mode=${s?.mode} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)} camYaw=${s?.camYaw?.toFixed(2)} t=${s?.t?.toFixed(2)}`);
  if (s?.mode !== "playing") throw new Error("not playing");

  const tx = 40;
  const tz = 80;
  const t0 = s.t;
  const start = { x: s.x, z: s.z };
  const err0 = yawError(s.camYaw, s.x, s.z, tx, tz);
  note(`yawError0=${err0.toFixed(3)} want≈${(s.camYaw + err0).toFixed(3)}`);

  const r = await walkTo(io, tx, tz, 180000, {
    arrive: 3.2,
    expectShrine: null,
    tol: 0.22,
    stepMs: 280,
    lookOpts: { maxPulses: 12, pulseMs: 300, pulseScale: 450, maxPulseMs: 900, tol: 0.22 },
  });
  const end = r.s;
  note(
    `result ${r.status} steps=${r.steps} dist=${r.dist?.toFixed(2)} look=${JSON.stringify(r.look)} ` +
      `end=${end ? `${end.x.toFixed(1)},${end.z.toFixed(1)} camYaw=${end.camYaw.toFixed(2)} state=${end.state}` : "null"} ` +
      `simDt=${end ? (end.t - t0).toFixed(2) : "?"}s`,
  );
  writeFileSync(
    resolve(outDir, "first-wp-aligned.json"),
    JSON.stringify(
      {
        status: r.status,
        steps: r.steps,
        dist: r.dist,
        look: r.look,
        start,
        end: end ? { x: end.x, z: end.z, camYaw: end.camYaw, t: end.t, state: end.state } : null,
        simDt: end ? end.t - t0 : null,
        log,
      },
      null,
      2,
    ),
  );
} catch (e) {
  note(`error ${e?.message || e}`);
  writeFileSync(resolve(outDir, "first-wp-aligned.json"), JSON.stringify({ error: String(e?.message || e), log }, null, 2));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
