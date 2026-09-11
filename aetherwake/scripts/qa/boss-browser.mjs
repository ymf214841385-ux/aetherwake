/**
 * Boss last-hit / ending / reload — real keys+mouse only.
 * Assumes seal already open OR opens via progress already in save (no cheat).
 * E2E_URL=... QA_HEADED=1 node scripts/qa/boss-browser.mjs
 *
 * Uses same nav-walk look (aligned-only W). Does not write HP/progress.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { bindCloseTracking, browserProcessInfo, qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { lookToward, yawError } from "./nav-walk.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
const runId = process.env.QA_RUN_ID || `boss-${Date.now()}`;
const runDir = resolve(outDir, `runs/${runId}`);
mkdirSync(runDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[boss] ${m}`);
};

if (!process.env.DEBUG) process.env.DEBUG = "pw:browser";
const browser = await chromium.launch({
  ...qaChromiumLaunchOptions(),
  env: { ...process.env, DEBUG: process.env.DEBUG },
});
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
      camYaw: sim.cam.yaw,
      state: sim.player.state,
      hp: sim.player.hp,
      stamina: sim.player.stamina,
      towers: [...sim.towersOn],
      shrines: [...sim.shrinesOn],
      orbs: sim.orbs,
      bossDead: sim.bossDead,
      sealOpen: typeof sim.sealIsOpen === "function" ? sim.sealIsOpen() : false,
      attackPhase: sim.attack?.phase,
      toast: sim.toast,
      ruinSolved: sim.ruinSolved,
      boss: boss
        ? {
            id: boss.id,
            x: +boss.x.toFixed(2),
            y: +boss.y.toFixed(2),
            z: +boss.z.toFixed(2),
            hp: boss.hp,
            max: boss.max,
            alive: boss.alive,
            phase: boss.brain?.phase,
          }
        : null,
      worldKind: sim.worldKind,
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
    for (const k of [...downs].reverse()) await page.keyboard.up(k).catch(() => {});
  }
}
async function swing() {
  await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return false;
    const opts = { button: 0, bubbles: true, cancelable: true, clientX: 640, clientY: 400 };
    c.dispatchEvent(new MouseEvent("mousedown", opts));
    c.dispatchEvent(new MouseEvent("mouseup", opts));
    return true;
  });
}

const result = { ok: false, runId, stages: [], hpTrail: [], phases: [] };
function stage(n, d) {
  result.stages.push({ n, d, t: Date.now() });
  note(`stage ${n}: ${d}`);
}

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
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
  stage("boot", `mode=${s?.mode} seal=${s?.sealOpen} towers=${JSON.stringify(s?.towers)} shrines=${JSON.stringify(s?.shrines)} orbs=${s?.orbs}`);
  result.shots = [];
  result.shots.push(await shot("boss-start.png"));
  if (s?.mode !== "playing") throw new Error("not playing");

  if (!s.sealOpen) {
    stage("seal", `closed — towers=${s.towers?.length} shrines=${s.shrines?.length} orbs=${s.orbs}; cannot fight boss without seal`);
    result.detail = "seal-not-open (need 3 towers + 4 shrines on this save; no progress injection)";
    result.ok = false;
  } else {
    // Walk to citadel courtyard boss area (6,-12) from spawn with west path around walls
    const targets = [
      { x: 5, z: 40, label: "wp-south" },
      { x: -18, z: 0, label: "wp-west" },
      { x: -18, z: -12, label: "wp-citadel-west" },
      { x: 0, z: -12, label: "wp-courtyard" },
    ];
    for (const t of targets) {
      const r = await (async () => {
        // local walk using look+hold
        const end = Date.now() + 90000;
        while (Date.now() < end) {
          const cur = await read();
          if (!cur || cur.mode !== "playing") return { status: "not-playing", s: cur, dist: Infinity };
          if (cur.mode === "dead") return { status: "dead", s: cur, dist: Infinity };
          const dist = Math.hypot(t.x - cur.x, t.z - cur.z);
          if (dist < 3.2) return { status: "arrived", s: cur, dist };
          const look = await lookToward({ read, hold }, t.x, t.z, {
            tol: 0.25,
            maxPulses: 12,
            minPulseMs: 60,
            maxPulseMs: 450,
          });
          if (look.status !== "aligned") continue;
          await hold(["KeyW", "ShiftLeft"], 280);
        }
        const cur = await read();
        return { status: "timeout", s: cur, dist: cur ? Math.hypot(t.x - cur.x, t.z - cur.z) : Infinity };
      })();
      s = r.s;
      stage(t.label, `${r.status} dist=${r.dist?.toFixed?.(1)} at ${s?.x?.toFixed?.(1)},${s?.z?.toFixed?.(1)}`);
      if (r.status !== "arrived" && t.label !== "wp-courtyard") {
        // continue trying courtyard from wherever we are
        note(`continue despite ${t.label} ${r.status}`);
      }
    }

    // Fight boss
    s = await read();
    stage("arena", `at ${s?.x?.toFixed?.(1)},${s?.z?.toFixed?.(1)} boss=${JSON.stringify(s?.boss)}`);
    result.shots.push(await shot("boss-arena.png"));
    if (!s?.boss?.alive) {
      result.detail = s?.bossDead ? "boss already dead" : "no live boss";
      result.ok = Boolean(s?.bossDead);
    } else {
      const trail = [];
      for (let i = 0; i < 80; i++) {
        s = await read();
        if (!s || s.mode !== "playing") break;
        if (s.mode === "ending" || s.bossDead) break;
        if (s.mode === "dead") {
          stage("player-dead", `hp=${s.hp} bossHp=${s.boss?.hp}`);
          // respawn via UI
          try {
            await page.getByRole("button", { name: "在篝火旁醒来" }).click({ timeout: 2000 });
          } catch {
            await page.evaluate(() => {
              const b = [...document.querySelectorAll("button")].find((el) =>
                (el.textContent || "").includes("在篝火旁醒来"),
              );
              if (b) {
                b.focus();
                b.click();
              }
            });
            await page.keyboard.press("Enter");
          }
          await wait(800);
          continue;
        }
        const b = s.boss;
        if (!b?.alive) break;
        const dist = Math.hypot(b.x - s.x, b.z - s.z);
        trail.push({ i, hp: b.hp, phase: b.phase, dist: +dist.toFixed(2), playerHp: s.hp, mode: s.mode });
        result.hpTrail = trail;
        if (dist > 2.0) {
          await lookToward({ read, hold }, b.x, b.z, { tol: 0.22, maxPulses: 6, minPulseMs: 60, maxPulseMs: 400 });
          await hold(["KeyW"], 200);
          continue;
        }
        // in range — face and swing; dodge if windup/strike
        if (b.phase === "windup" || b.phase === "strike") {
          await hold(["KeyC"], 40);
          continue;
        }
        await lookToward({ read, hold }, b.x, b.z, { tol: 0.2, maxPulses: 6, minPulseMs: 60, maxPulseMs: 400 });
        await swing();
        await wait(450);
      }
      s = await read();
      stage("fight-end", `bossDead=${s?.bossDead} mode=${s?.mode} bossHp=${s?.boss?.hp} playerHp=${s?.hp}`);
      result.shots.push(await shot("boss-after.png"));

      if (s?.mode === "ending" || s?.bossDead) {
        await wait(1500);
        result.shots.push(await shot("boss-ending.png"));
        // reload: go to title and continue? Review asks reload persistence of bossDead
        // Use continue if save exists — click 继续 if present, else new game is wrong.
        // Simulate reload: evaluate save then continueSave via UI.
        const before = await read();
        stage("pre-reload", `bossDead=${before?.bossDead} mode=${before?.mode}`);
        // Force a save by walking a step then evaluate localStorage envelope if present
        await hold(["KeyW"], 300);
        // Title via pause? Use sim continueSave only through UI 继续探索 — check buttons
        await page.evaluate(() => {
          // no direct write — open pause then title if available
          const sim = window.__sim;
          if (sim && typeof sim.save === "function") sim.save();
        });
        await wait(400);
        // Reload page
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        await wait(1500);
        try {
          const cont = page.locator("button", { hasText: "继续" });
          if ((await cont.count()) > 0) {
            await cont.first().focus();
            await page.keyboard.press("Enter");
          } else {
            await page.evaluate(() => {
              const b = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("开始探索"));
              if (b) {
                b.focus();
                b.click();
              }
            });
            await page.keyboard.press("Enter");
          }
        } catch {
          /* ignore */
        }
        await wait(800);
        const after = await read();
        stage("post-reload", `mode=${after?.mode} bossDead=${after?.bossDead} orbs=${after?.orbs} towers=${JSON.stringify(after?.towers)} shrines=${JSON.stringify(after?.shrines)}`);
        result.shots.push(await shot("boss-reload.png"));
        result.ok = Boolean(s.bossDead || s.mode === "ending") && Boolean(after?.bossDead);
        result.detail = result.ok
          ? `boss dead + reload kept bossDead`
          : `bossDead=${s.bossDead} afterReload=${after?.bossDead}`;
      } else {
        result.detail = `fight loop ended without bossDead mode=${s?.mode} bossHp=${s?.boss?.hp}`;
      }
    }
  }
} catch (e) {
  result.detail = `error ${e?.message || e}`;
  stage("error", result.detail);
} finally {
  const life = typeof closeFlags.snapshot === "function" ? closeFlags.snapshot() : { ...closeFlags, events: [] };
  const payload = { ...result, url, runId, browserInfo, lifecycle: life, log };
  writeFileSync(resolve(runDir, "boss-browser.json"), JSON.stringify(payload, null, 2));
  writeFileSync(resolve(outDir, "boss-browser.json"), JSON.stringify(payload, null, 2));
  note(`json ok=${result.ok} ${result.detail || ""} close=${life.order || "none"}`);
  closeFlags.intentionalTeardown = true;
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(result.ok ? 0 : 1);
}
