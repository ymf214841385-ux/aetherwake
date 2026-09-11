/**
 * Per-pulse lookToward diagnostic (Review08).
 * Measures err, dYaw, wallMs, yawRate. Small errors both signs + wrap.
 *
 * E2E_URL=http://127.0.0.1:8115/ QA_HEADED=1 node scripts/qa/look-pulse-diag.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { lookToward, wrapAngle, yawError } from "./nav-walk.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
const runId = process.env.QA_RUN_ID || `look-${Date.now()}`;
const runDir = resolve(outDir, `runs/${runId}`);
mkdirSync(runDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[look] ${m}`);
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
      t: sim.t,
    };
  });
}
async function hold(keys, ms) {
  const downs = [];
  try {
    for (const k of keys) {
      await page.keyboard.down(k);
      downs.push(k);
    }
    await wait(ms);
  } finally {
    for (const k of downs.reverse()) await page.keyboard.up(k).catch(() => {});
  }
}

const result = { runId, trials: [], ok: false };

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
    await wait(500);
    s = await read();
  }
  note(`mode=${s?.mode} camYaw=${s?.camYaw?.toFixed(3)} t=${s?.t?.toFixed(2)}`);
  if (s?.mode !== "playing") throw new Error("not playing");

  const io = { read, hold };

  // Trial A: large error — face (5,80) from spawn-ish
  // Trial B/C: small errors both signs by aiming slightly left/right of current forward
  // Trial D: wrap-around target behind player
  const trials = [
    { name: "large-forward", tx: 5, tz: 80, tol: 0.25 },
    { name: "small-pos", tx: s.x + 0.1, tz: s.z - 8, tol: 0.2 },
    { name: "small-neg", tx: s.x - 0.1, tz: s.z - 8, tol: 0.2 },
    { name: "wrap-behind", tx: s.x, tz: s.z + 20, tol: 0.25 },
  ];

  for (const tr of trials) {
    const s0 = await read();
    if (!s0) break;
    const err0 = yawError(s0.camYaw, s0.x, s0.z, tr.tx, tr.tz);
    const r = await lookToward(io, tr.tx, tr.tz, {
      tol: tr.tol,
      maxPulses: 16,
      minPulseMs: 60,
      maxPulseMs: 500,
      onPulse: (p) =>
        note(
          `${tr.name} p${p.i} key=${p.key} ms=${p.ms} wall=${p.wallMs} dYaw=${p.dYaw?.toFixed?.(4)} err=${p.err?.toFixed?.(4)} rate=${p.yawRate?.toExponential?.(3)}`,
        ),
    });
    const s1 = await read();
    const err1 = s1 ? yawError(s1.camYaw, s1.x, s1.z, tr.tx, tr.tz) : null;
    // oscillation: sign flips of dYaw or err without shrinking |err|
    const errs = r.trace.map((t) => t.err).filter((e) => e != null && Number.isFinite(e));
    let flips = 0;
    for (let i = 1; i < errs.length; i++) {
      if (Math.sign(errs[i]) !== Math.sign(errs[i - 1]) && Math.abs(errs[i]) > 0.05) flips += 1;
    }
    const rec = {
      name: tr.name,
      err0,
      err1,
      status: r.status,
      pulses: r.pulses,
      flips,
      finalCamYaw: r.camYaw,
      trace: r.trace,
    };
    result.trials.push(rec);
    note(
      `${tr.name} => ${r.status} err ${err0?.toFixed?.(3)}->${err1?.toFixed?.(3)} pulses=${r.pulses} flips=${flips}`,
    );
  }

  result.ok = result.trials.every((t) => t.status === "aligned");
  result.detail = result.ok ? "all trials aligned" : `unaligned: ${result.trials.filter((t) => t.status !== "aligned").map((t) => t.name).join(",")}`;
} catch (e) {
  result.error = String(e?.message || e);
  note(result.error);
} finally {
  writeFileSync(resolve(runDir, "look-pulse-diag.json"), JSON.stringify({ ...result, log }, null, 2));
  writeFileSync(resolve(outDir, "look-pulse-diag.json"), JSON.stringify({ ...result, log }, null, 2));
  note(`json ok=${result.ok} ${result.detail || result.error || ""}`);
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(result.ok ? 0 : 1);
}
