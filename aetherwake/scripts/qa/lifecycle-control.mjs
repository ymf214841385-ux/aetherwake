/**
 * Bounded headed lifecycle/control run (Review 06).
 * Same 8115 snapshot. Normal movement. Records sim/wall ratio + close flags.
 * Does NOT walk the full shrine route.
 *
 * QA_HEADED=1 E2E_URL=http://127.0.0.1:8115/ node scripts/qa/lifecycle-control.mjs
 * Optional: QA_BUDGET_MS=520000
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { bindCloseTracking, browserProcessInfo, qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { controlFailureReason, isControlSuccess } from "./control-success.mjs";
import { lookToward, walkTo } from "./nav-walk.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
const runId = process.env.QA_RUN_ID || `life-${Date.now()}`;
const runDir = resolve(outDir, `runs/${runId}`);
mkdirSync(runDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const budgetMs = Number(process.env.QA_BUDGET_MS || 520000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[life] ${m}`);
};

note(`boot headed=${process.env.QA_HEADED === "1"} budgetMs=${budgetMs} url=${url} runId=${runId}`);
if (!process.env.DEBUG) process.env.DEBUG = "pw:browser";
const browser = await chromium.launch({
  ...qaChromiumLaunchOptions(),
  env: { ...process.env, DEBUG: process.env.DEBUG },
});
const browserInfo = browserProcessInfo(browser, { rootPid: process.pid });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const closeFlags = bindCloseTracking(page, context, browser);
const harness = { pid: process.pid, ppid: process.ppid, startedAt: Date.now(), runId, headed: process.env.QA_HEADED === "1" };

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
      hp: sim.player.hp,
      stamina: sim.player.stamina,
      shrine: sim.shrine,
      pointerLock: Boolean(document.pointerLockElement),
    };
  });
}
async function hold(keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}

const result = { ok: false, arrived: false, completedBudget: false, survivedBudget: false, phases: [], samples: [], errorMessage: null };

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  note("goto ok");
  await wait(1200);
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
    await wait(600);
    s = await read();
  }
  note(`mode=${s?.mode} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)} t=${s?.t?.toFixed(2)}`);
  if (s?.mode !== "playing") throw new Error(`not playing ${s?.mode}`);

  const t0 = s.t;
  const wall0 = Date.now();
  const start = { x: s.x, z: s.z };

  // Clock ratio over 2s wall
  await wait(2000);
  s = await read();
  const clock = {
    wallMs: Date.now() - wall0,
    simMs: (s.t - t0) * 1000,
    ratio: ((s.t - t0) * 1000) / (Date.now() - wall0),
  };
  note(`clock ${JSON.stringify(clock)}`);
  result.phases.push({ name: "clock", ...clock });

  // Bounded movement: walk toward (5,80) only — first west waypoint
  const io = {
    read,
    hold,
    lookToward: (tx, tz, opts) => lookToward({ read, hold }, tx, tz, { tol: 0.22, maxPulses: 8, pulseMs: 250, maxPulseMs: 700, ...opts }),
  };

  // Sample heartbeat every 3s until budget or arrive
  const endAt = Date.now() + budgetMs;
  let last = s;
  while (Date.now() < endAt) {
    const r = await walkTo(io, 5, 80, Math.min(30000, endAt - Date.now()), {
      arrive: 3.2,
      expectShrine: null,
      stepMs: 280,
      tol: 0.22,
    });
    last = r.s || (await read());
    const wall = Date.now() - wall0;
    const simDt = last ? last.t - t0 : null;
    result.samples.push({
      tWall: wall,
      tSim: simDt != null ? +simDt.toFixed(2) : null,
      ratio: simDt != null ? +((simDt * 1000) / wall).toFixed(3) : null,
      x: last?.x,
      z: last?.z,
      status: r.status,
      dist: r.dist,
    });
    note(
      `hb wall=${(wall / 1000).toFixed(0)}s sim=${simDt?.toFixed?.(2)}s ratio=${simDt != null ? ((simDt * 1000) / wall).toFixed(3) : "?"} ` +
        `status=${r.status} dist=${r.dist?.toFixed?.(1)} at ${last?.x?.toFixed?.(1)},${last?.z?.toFixed?.(1)}`,
    );
    if (r.status === "arrived") {
      result.arrived = true;
      result.detail = `arrived (5,80) at wall=${(wall / 1000).toFixed(0)}s — hold to budget`;
      let holdBroken = false;
      while (Date.now() < endAt) {
        await wait(5000);
        try {
          last = await read();
        } catch (e) {
          holdBroken = true;
          result.errorMessage = String(e?.message || e);
          result.detail += `; hold read failed: ${result.errorMessage}`;
          note(result.detail);
          break;
        }
        if (!last || last.mode !== "playing") {
          holdBroken = true;
          result.detail += `; then mode=${last?.mode} at wall=${((Date.now() - wall0) / 1000).toFixed(0)}s`;
          break;
        }
        const w2 = Date.now() - wall0;
        const sim2 = last.t - t0;
        result.samples.push({
          tWall: w2,
          tSim: +sim2.toFixed(2),
          ratio: +((sim2 * 1000) / w2).toFixed(3),
          x: last.x,
          z: last.z,
          status: "hold-after-arrive",
        });
        if (Math.floor(w2 / 60000) !== Math.floor((w2 - 5000) / 60000)) {
          note(`hold wall=${(w2 / 1000).toFixed(0)}s sim=${sim2.toFixed(2)}s ratio=${((sim2 * 1000) / w2).toFixed(3)}`);
        }
      }
      const wallEnd = Date.now() - wall0;
      result.survivedBudget = wallEnd >= budgetMs - 1000;
      result.completedBudget = !holdBroken && result.survivedBudget;
      result.detail += `; total wall=${(wallEnd / 1000).toFixed(0)}s budget=${(budgetMs / 1000).toFixed(0)}s`;
      break;
    }
    if (r.status === "not-playing" || last?.mode === "dead") {
      result.detail = `dead/quit at wall=${(wall / 1000).toFixed(0)}s`;
      break;
    }
    // continue same target until budget
    if (wall > budgetMs - 5000) break;
  }
  if (!result.ok && !result.detail) {
    result.detail = `budget exhausted wall=${((Date.now() - wall0) / 1000).toFixed(0)}s last=${last ? `${last.x.toFixed(1)},${last.z.toFixed(1)}` : "?"}`;
  }
  result.start = start;
  result.end = last ? { x: last.x, z: last.z, mode: last.mode, t: last.t } : null;
} catch (err) {
  result.errorMessage = String(err?.message || err);
  result.detail = `error ${result.errorMessage}`;
  result.ok = false;
  note(result.detail);
} finally {
  const life = typeof closeFlags.snapshot === "function" ? closeFlags.snapshot() : { ...closeFlags, events: [] };
  result.ok = isControlSuccess({
    arrived: result.arrived,
    completedBudget: result.completedBudget,
    survivedBudget: result.survivedBudget,
    lifecycle: life,
    errorMessage: result.errorMessage,
  });
  result.successReason = controlFailureReason({
    arrived: result.arrived,
    completedBudget: result.completedBudget,
    survivedBudget: result.survivedBudget,
    lifecycle: life,
    errorMessage: result.errorMessage,
  });
  const payload = {
    ...result,
    url,
    runId,
    harness,
    browserInfo,
    lifecycle: life,
    closeReason: life.crashed ? "crash" : life.browserDisconnected ? "browser-disconnected" : life.pageClosed ? "page-close" : null,
    log,
  };
  const json = resolve(runDir, "lifecycle-control.json");
  writeFileSync(json, JSON.stringify(payload, null, 2));
  writeFileSync(resolve(outDir, "lifecycle-control.json"), JSON.stringify(payload, null, 2));
  note(`json ${json} ok=${result.ok} reason=${result.successReason} closeOrder=${life.order || "none"}`);
  closeFlags.intentionalTeardown = true;
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(result.ok ? 0 : 1);
}
