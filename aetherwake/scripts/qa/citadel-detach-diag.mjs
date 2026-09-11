/**
 * Citadel climb-detach diagnostic (Review10).
 * Continue existing save (3 towers / 4 shrines). No teleport/HP/progress writes.
 *
 * E2E_URL=... QA_HEADED=1 node scripts/qa/citadel-detach-diag.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { bindCloseTracking, browserProcessInfo, qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { lookToward } from "./nav-walk.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
const runId = process.env.QA_RUN_ID || `detach-${Date.now()}`;
const runDir = resolve(outDir, `runs/${runId}`);
mkdirSync(runDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[detach] ${m}`);
};

if (!process.env.DEBUG) process.env.DEBUG = "pw:browser";
const browser = await chromium.launch({ ...qaChromiumLaunchOptions(), env: { ...process.env } });
const browserInfo = browserProcessInfo(browser, { rootPid: process.pid });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const closeFlags = bindCloseTracking(page, context, browser);

async function shot(name) {
  const p = resolve(runDir, name);
  await page.screenshot({ path: p, type: "png" });
  return p;
}
async function read() {
  return page.evaluate(() => {
    const sim = window.__sim;
    if (!sim) return null;
    const boss = sim.enemies?.find?.((e) => e.kind === "boss");
    return {
      mode: sim.mode,
      x: sim.player.x,
      y: sim.player.y,
      z: sim.player.z,
      state: sim.player.state,
      climbing: sim.player.climbing,
      grounded: sim.player.grounded,
      stamina: sim.player.stamina,
      vx: sim.player.vx,
      vy: sim.player.vy,
      vz: sim.player.vz,
      camYaw: sim.cam.yaw,
      towers: [...sim.towersOn],
      shrines: [...sim.shrinesOn],
      orbs: sim.orbs,
      bossDead: sim.bossDead,
      sealOpen: typeof sim.sealIsOpen === "function" ? sim.sealIsOpen() : false,
      attackPhase: sim.attack?.phase,
      toast: sim.toast,
      boss: boss
        ? {
            x: +boss.x.toFixed(2),
            z: +boss.z.toFixed(2),
            y: +boss.y.toFixed(2),
            hp: boss.hp,
            alive: boss.alive,
            phase: boss.brain?.phase,
          }
        : null,
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
    for (const k of [...downs].reverse()) await page.keyboard.up(k).catch(() => {});
  }
}
async function releaseAll() {
  for (const k of [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyC",
    "ShiftLeft",
    "Space",
    "KeyE",
    "ArrowLeft",
    "ArrowRight",
  ]) {
    await page.keyboard.up(k).catch(() => {});
  }
}

const result = { ok: false, steps: [], notes: [] };

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1200);
  let s = await read();
  // Prefer continue if save exists
  const cont = page.locator("button", { hasText: "继续旅途" });
  let started = false;
  if ((await cont.count()) > 0) {
    await cont.first().focus();
    await page.keyboard.press("Enter");
    await wait(800);
    started = true;
    note("clicked 继续旅途");
  }
  s = await read();
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
    note("fallback 开始探索 (may be new game)");
  }
  stage(`boot mode=${s?.mode} seal=${s?.sealOpen} towers=${JSON.stringify(s?.towers)} shrines=${JSON.stringify(s?.shrines)} orbs=${s?.orbs} at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} state=${s?.state}`);
  result.shots = [await shot("detach-boot.png")];
  if (s?.mode !== "playing") throw new Error("not playing");

  // Walk to east wall area if not already there
  if (Math.hypot(s.x - 18.1, s.z - 1.6) > 12) {
    note("not near east wall; walking south-east toward gate approach");
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const cur = await read();
      if (!cur || cur.mode !== "playing") break;
      const d = Math.hypot(18.1 - cur.x, 1.6 - cur.z);
      if (d < 4 || cur.state === "climbing") break;
      await lookToward({ read, hold }, 18.1, 1.6, { tol: 0.25, maxPulses: 10, minPulseMs: 60, maxPulseMs: 400 });
      await hold(["KeyW", "ShiftLeft"], 280);
    }
    s = await read();
  }
  stage(`at-wall ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} state=${s?.state} stamina=${s?.stamina?.toFixed?.(0)}`);

  // If climbing, detach sequence
  if (s?.state === "climbing") {
    stage("climbing", "release all + KeyC dismount attempts");
    await releaseAll();
    await wait(200);
    for (let i = 0; i < 8; i++) {
      s = await read();
      result.steps.push({ i, x: s?.x, y: s?.y, z: s?.z, state: s?.state, stamina: s?.stamina, vy: s?.vy });
      note(`dismount#${i} state=${s?.state} at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} st=${s?.stamina?.toFixed?.(0)}`);
      if (s?.state !== "climbing") break;
      await hold(["KeyC"], 200);
      await wait(250);
      s = await read();
      if (s?.state !== "climbing") {
        note(`dismount via KeyC -> ${s?.state}`);
        break;
      }
      // try S away from wall (slide/back)
      await hold(["KeyS"], 300);
      s = await read();
      if (s?.state !== "climbing") {
        note(`dismount via S -> ${s?.state}`);
        break;
      }
      // try jump
      await hold(["Space"], 80);
      await wait(300);
    }
    s = await read();
    stage("after-dismount", `state=${s?.state} at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)}`);
    result.shots.push(await shot("detach-after.png"));
  } else {
    stage("not-climbing", `state=${s?.state} — skip dismount; inspect clearance`);
  }

  // Back away from east wall toward courtyard center / gate
  await releaseAll();
  s = await read();
  stage("clearance", `state=${s?.state} x=${s?.x?.toFixed?.(1)} y=${s?.y?.toFixed?.(1)} z=${s?.z?.toFixed?.(1)} seal=${s?.sealOpen} boss=${JSON.stringify(s?.boss)}`);

  // Route through real gate: (6,8) → (6,0.8) → boss standoff
  const gateWps = [
    { x: 6, z: 8, label: "south-of-gate" },
    { x: 6, z: 0.8, label: "through-gate" },
  ];
  for (const t of gateWps) {
    const end = Date.now() + 50000;
    let last = null;
    while (Date.now() < end) {
      const cur = await read();
      if (!cur || cur.mode !== "playing") break;
      if (cur.state === "climbing") {
        await hold(["KeyC"], 180);
        await wait(150);
        continue;
      }
      const dist = Math.hypot(t.x - cur.x, t.z - cur.z);
      last = cur;
      if (dist < 3) break;
      await lookToward({ read, hold }, t.x, t.z, { tol: 0.25, maxPulses: 10, minPulseMs: 60, maxPulseMs: 400 });
      await hold(["KeyW", "ShiftLeft"], 250);
    }
    s = await read();
    stage(t.label, `state=${s?.state} at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} d=${last ? Math.hypot(t.x - last.x, t.z - last.z).toFixed(1) : "?"}`);
  }

  // Approach boss if present
  s = await read();
  if (s?.boss?.alive) {
    const end = Date.now() + 40000;
    while (Date.now() < end) {
      const cur = await read();
      if (!cur || cur.mode !== "playing" || !cur.boss?.alive) break;
      const dist = Math.hypot(cur.boss.x - cur.x, cur.boss.z - cur.z);
      stage(`boss-approach d=${dist.toFixed(1)} state=${cur.state} bossPhase=${cur.boss.phase}`);
      if (dist < 2.2) break;
      if (cur.state === "climbing") {
        await hold(["KeyC"], 180);
        continue;
      }
      await lookToward({ read, hold }, cur.boss.x, cur.boss.z, {
        tol: 0.22,
        maxPulses: 8,
        minPulseMs: 60,
        maxPulseMs: 400,
      });
      await hold(["KeyW"], 220);
    }
    s = await read();
    const d = s?.boss ? Math.hypot(s.boss.x - s.x, s.boss.z - s.z) : Infinity;
    result.ok = s?.state !== "climbing" && d < 3.5;
    result.detail = `state=${s?.state} bossDist=${d.toFixed(2)} bossHp=${s?.boss?.hp}`;
  } else {
    result.ok = s?.state !== "climbing";
    result.detail = `no live boss state=${s?.state} seal=${s?.sealOpen}`;
  }
  result.shots.push(await shot("detach-end.png"));
  stage("done", result.detail);
} catch (e) {
  result.detail = `error ${e?.message || e}`;
  note(result.detail);
} finally {
  const life = typeof closeFlags.snapshot === "function" ? closeFlags.snapshot() : { ...closeFlags, events: [] };
  writeFileSync(resolve(runDir, "citadel-detach-diag.json"), JSON.stringify({ ...result, runId, browserInfo, lifecycle: life, log }, null, 2));
  writeFileSync(resolve(outDir, "citadel-detach-diag.json"), JSON.stringify({ ...result, runId, lifecycle: life, log }, null, 2));
  note(`json ok=${result.ok} ${result.detail || ""}`);
  closeFlags.intentionalTeardown = true;
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(result.ok ? 0 : 1);
}

function stage(n, d) {
  result.notes.push({ n, d, t: Date.now() });
  note(`stage ${n}: ${d}`);
}
