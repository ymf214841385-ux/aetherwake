#!/usr/bin/env node
import { executeCitadelDefense } from "./qa/citadel-defense.mjs";
import { runCitadelInitialApproach, runCitadelLosReposition, prepareCitadelCombatDecision } from "./qa/citadel-handoff.mjs";
import { verifyCitadelCompletion } from "./qa/citadel-completion.mjs";
import { createRouteNavigation, checkFightScope, FightStopError } from "./qa/route-navigation.mjs";
/**
 * Real-input playthrough. Observes window.__sim but never writes player coords,
 * rewards, or completion flags. Success is the route contract, not "no throw".
 *
 * Owns its preview server unless E2E_URL is set. Never kills a pid it did not
 * spawn. Unexpected page.close is a failure (classifyClose).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { evaluateRoute, progressSnapshot, saveReloadRestored } from "./qa/route-contract.mjs";
import {
  REAL_INPUT_CODES,
  authoredBaseY,
  climbTickPolicy,
  keysForAction,
  reapproachWaypoints,
  towerApproachPoint,
} from "./qa/climb-policy.mjs";
import {
  ClosedPageError,
  bindCloseTracking,
  browserProcessInfo,
  classifyClose,
  maybeStartQaServer,
  qaChromiumLaunchOptions,
  stopOwnedServer,
  waitHttpReady,
} from "./qa/lifecycle.mjs";
import { installHarnessLifetime } from "./qa/durable-session.mjs";
import {
  STILL_FROM_SPAWN,
  STILL_PIT_LIP_Z,
  STILL_SAFE_WAYPOINTS,
  canEnterIntendedShrine,
  enteredShrineMatches,
  shrineAltar,
  shrineApproachCandidates,
  shrineApproachPoint,
  shrineNavTarget,
  shrineWorldOrigin,
  stillBlockAligned,
} from "./qa/shrine-steer.mjs";
import { citadelOffArena, citadelReturnWaypoints } from "./qa/citadel-steer.mjs";
import { citadelResumePlan, CITADEL_RESUME_FOCUS, v2MatchesSource } from "./qa/citadel-resume.mjs";
import {
  createFightOrchestrator,
  runCitadelFocusGate,
} from "./qa/combat-progress-monitor.mjs";
import { bossFightDecision, nextCitadelAction } from "./qa/boss-fight-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });

const harnessLife =
  typeof installHarnessLifetime === "function"
    ? installHarnessLifetime({
        name: "play-routes",
        lastNote: "boot",
        evidenceLog: resolve(outDir, "play-routes-run.log"),
      })
    : null;

const ownedServer = await maybeStartQaServer({ name: "play-routes", kind: process.env.QA_SERVER || "preview" });
if (!ownedServer.ok) {
  console.error(JSON.stringify({ ok: false, error: ownedServer.error || "failed to start owned QA server", server: ownedServer }, null, 2));
  process.exit(1);
}

const baseUrl = new URL(ownedServer.url || process.env.E2E_URL || "http://127.0.0.1:8080/");
baseUrl.searchParams.set("t", String(Date.now()));
const url = checkedUrl(baseUrl.href);

const LOOK_SENS = 0.0022;
const POI = {
  dawn: { x: 10, z: 68, y: 11.1 },
  mere: { x: -108, z: 8, y: 7.8 },
  crown: { x: 48, z: -128, y: 16.8 },
  pull: { x: 36, z: 8 },
  rime: { x: -72, z: 36 },
  burst: { x: 118, z: 28 },
  still: { x: 14, z: -78 },
  citadel: { x: 6, z: -5 },
  ruin: { x: 28, z: 74 },
  ruinSide: { x: 28 + 6.4, z: 74 - 3.2 },
  planks: { x: 28, z: 80.5 },
  gustStand: { x: 28, z: 86 },
  valleyLift: { x: 20, z: 86 },
  ruinLift: { x: 32, z: 70 },
  campA: { x: 42 + 1.6, z: 52 - 1.2 },
  mereLift: { x: -96, z: 14 },
};

const WAYPOINTS = {
  dawn: [
    { x: 14, z: 88 },
    { x: 10, z: 73.6 },
  ],
  ruin: [
    { x: 20, z: 86 },
    { x: 28, z: 74 },
  ],
  pull: [
    { x: 24, z: 40 },
    { x: 36, z: 14 },
  ],
  rime: [
    { x: 0, z: 50 },
    { x: -40, z: 48 },
    { x: -72, z: 44 },
  ],
  burst: [
    { x: 70, z: 16 },
    { x: 118, z: 34 },
  ],
  still: STILL_SAFE_WAYPOINTS,
  stillFromSpawn: STILL_FROM_SPAWN,
  mere: [
    { x: -40, z: 16 },
    { x: -80, z: 0 },
    { x: -96, z: 14 },
    { x: -108, z: 13.6 },
  ],
  crown: [
    { x: -80, z: 0 },
    { x: -40, z: -20 },
    { x: 24, z: -40 },
    { x: 36, z: -90 },
    { x: 48, z: -122 },
  ],
  citadel: [
    { x: 6, z: 8 },
    { x: 6, z: -1 },
    { x: 6, z: -5 },
  ],
  campA: [{ x: 43.6, z: 50.8 }],
};

const MOVE_CODES = [...REAL_INPUT_CODES];

let browser;
try {
  const chromeOpts = qaChromiumLaunchOptions();
  browser = await chromium.launch(chromeOpts);
} catch (err) {
  if (ownedServer?.owned) await stopOwnedServer(ownedServer);
  throw err;
}
if (ownedServer?.pid) harnessLife?.setServerPid?.(ownedServer.pid);
const contextOpts = { viewport: { width: 1280, height: 800 } };
if (process.env.RECORD_VIDEO === "1") {
  contextOpts.recordVideo = { dir: outDir, size: { width: 1280, height: 800 } };
}
const context = await browser.newContext(contextOpts);
await context.addInitScript(() => {
  try {
    localStorage.setItem(
      "aetherwake-settings-v1",
      JSON.stringify({
        lookSens: 1,
        invertY: false,
        shake: 0.2,
        masterVol: 0,
        sfxVol: 0,
        musicVol: 0,
        quality: "low",
        lockDay: true,
      }),
    );
  } catch {
    /* ignore */
  }
});
const page = await context.newPage();
page.setDefaultTimeout(0);
page.setDefaultNavigationTimeout(120000);

const closeFlags = bindCloseTracking(page, context, browser);

const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.error("[play]", m);
};

const chromiumInfo = browserProcessInfo(browser);
harnessLife?.setChromiumPid?.(chromiumInfo.chromiumPid);
note(
  `harness pid=${process.pid} ppid=${process.ppid} chromium=${chromiumInfo.chromiumPid ?? "?"} headed=${process.env.QA_HEADED === "1"} url=${url} serverPid=${ownedServer.pid ?? "ext"} serverPort=${ownedServer.port ?? "ext"} pidFile=${ownedServer.pidFile ?? ""} log=${ownedServer.logFile ?? ""} hb=${harnessLife?.heartbeatFile ?? ""}`,
);

let titleMidRun = false;
let sawPlaying = false;
let attemptedCitadel = false;
let sealClosedAttempt = false;
let citadelPrompt = null;
let citadelNavigationEvidence = null;
let last = null;
let lastGood = null;
let lastTitleRecoverAt = 0;
let closeReason = null;
let saveReload = { attempted: false, savePresent: false, continued: false, restored: false, before: null, after: null };
const observed = { towers: [], shrines: [], orbs: 0, ruinSolved: false, bossDead: false };
const shrineNoAbility = process.env.QA_SHRINE_NO_ABILITY === "1";

function remember(s) {
  if (!s) return s;
  last = s;
  if (s.mode === "playing" || s.mode === "ending") {
    lastGood = s;
    for (const t of s.towers || []) if (!observed.towers.includes(t)) observed.towers.push(t);
    for (const t of s.shrines || []) if (!observed.shrines.includes(t)) observed.shrines.push(t);
    if (s.orbs > observed.orbs) observed.orbs = s.orbs;
    if (s.ruinSolved) observed.ruinSolved = true;
    if (s.bossDead) observed.bossDead = true;
  }
  return s;
}

function throwIfClosed(err) {
  const reason = classifyClose({ ...closeFlags, errorMessage: err?.message || String(err) });
  if (reason) {
    closeReason = closeReason || reason;
    harnessLife?.setCloseReason?.(closeReason);
    throw new ClosedPageError(reason);
  }
}

function ensureOpen() {
  if (page.isClosed() || !browser.isConnected()) {
    const reason = classifyClose({
      ...closeFlags,
      errorMessage: "page already closed before wait",
    }) || { kind: "target-destroyed", detail: "page.isClosed", message: "page already closed" };
    closeReason = closeReason || reason;
    harnessLife?.setCloseReason?.(closeReason);
    throw new ClosedPageError(reason);
  }
}

async function wait(ms) {
  ensureOpen();
  try {
    await page.waitForTimeout(ms);
  } catch (err) {
    throwIfClosed(err);
    throw err;
  }
}

async function read() {
  for (let i = 0; i < 6; i++) {
    ensureOpen();
    try {
      const s = await page.evaluate(() => {
        const sim = window.__sim;
        if (!sim) return null;
        return {
          mode: sim.mode,
          x: sim.player.x,
          y: sim.player.y,
          z: sim.player.z,
          yaw: sim.player.yaw,
          camYaw: sim.cam.yaw,
          state: sim.player.state,
          stamina: sim.player.stamina,
          staminaMax: sim.player.staminaMax,
          climbing: sim.player.climbing,
          grounded: sim.player.grounded,
          vy: sim.player.vy,
          coldAcc: sim.coldAcc,
          // Read-only neighborhood; radius is evidence coverage, not a hit test.
          nearbyEnemies: (sim.enemies ?? [])
            .filter((e) => Math.hypot(e.x - sim.player.x, e.y - sim.player.y, e.z - sim.player.z) <= 30)
            .map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z,
              yaw: e.yaw, hp: e.hp, alive: e.alive, frozen: e.frozen,
              timer: e.timer, hurt: e.hurt, telegraph: e.telegraph,
              brain: { phase: e.brain?.phase, t: e.brain?.t } })),
          nearbyProjectiles: (sim.projs ?? [])
            .map((q, index) => ({ index, ...q }))
            .filter((q) => Math.hypot(q.x - sim.player.x, q.y - sim.player.y, q.z - sim.player.z) <= 30),
          towers: [...sim.towersOn],
          shrines: [...sim.shrinesOn],
          orbs: sim.orbs,
          ruinSolved: sim.ruinSolved,
          prompt: sim.prompt,
          shrine: sim.shrine,
          shrineHint: sim.shrineHint,
          interactLock: sim.interactLock ?? 0,
          hp: sim.player.hp,
          amber: sim.amber,
          art: sim.art,
          bossDead: sim.bossDead,
          toast: sim.toast,
          worldKind: sim.worldKind,
          spicy: sim.player.spicy,
          cold: sim.player.cold,
          meals: Array.isArray(sim.meals) ? sim.meals.map((m) => ({ id: m.id, name: m.name })) : [],
          pointerLock: Boolean(document.pointerLockElement),
          cracked: sim.shrine != null ? Boolean(sim.crackedBroken?.[sim.shrine]) : false,
          moveBlock: sim.moveBlock
            ? {
                x: sim.moveBlock.x,
                z: sim.moveBlock.z,
                frozen: sim.moveBlock.frozen,
                t: sim.moveBlock.t,
              }
            : null,
          ices: Array.isArray(sim.ices) ? sim.ices.length : 0,
          metals: Array.isArray(sim.metals)
            ? sim.metals.map((m) => ({ id: m.id, x: m.x, z: m.z, held: Boolean(m.held) }))
            : [],
          bomb: sim.bomb ? { x: sim.bomb.x, z: sim.bomb.z } : null,
          attackPhase: sim.attack?.phase ?? "idle",
          attackT: sim.attack?.t ?? 0,
          equippedId: sim.equippedId ?? null,
          arrows: sim.arrows,
          dodgeCd: sim.player.dodgeCd,
          stamina: sim.player.stamina,
          dodgeT: sim.player.dodgeT ?? 0,
          canDodge:
            typeof sim.canAcceptDodge === "function"
              ? sim.canAcceptDodge({
                  state: sim.player.state,
                  dodgeCd: sim.player.dodgeCd,
                  stamina: sim.player.stamina,
                })
              : sim.player.dodgeCd <= 0 &&
                sim.player.state === "grounded" &&
                sim.player.stamina > 18,
          invuln: sim.player.invuln,
          sealOpen: typeof sim.sealIsOpen === "function" ? sim.sealIsOpen() : false,
          boss: (() => {
            const e = sim.enemies?.find?.((x) => x.kind === "boss");
            return e
              ? {
                  hp: e.hp,
                  max: e.max,
                  x: e.x,
                  y: e.y,
                  z: e.z,
                  alive: e.alive,
                  phase: e.brain?.phase ?? null,
                  yaw: e.yaw,
                }
              : null;
          })(),
          // D3: production LOS to live boss (read-only targetVisibility).
          ...(() => {
            const e = sim.enemies?.find?.((x) => x.kind === "boss");
            if (!e || typeof sim.targetVisibility !== "function") {
              return { bossMeleeBlocked: false, blockerId: null };
            }
            const vis = sim.targetVisibility(e.x, e.z);
            return { bossMeleeBlocked: Boolean(vis.blocked), blockerId: vis.blockerId ?? null };
          })(),
        };
      });
      if (s) return remember(s);
    } catch (err) {
      if (classifyClose({ ...closeFlags, errorMessage: err?.message || String(err) })) throwIfClosed(err);
    }
    await wait(200);
  }
  return null;
}

async function releaseAll() {
  for (const k of MOVE_CODES) {
    try {
      if (!page.isClosed()) await page.keyboard.up(k);
    } catch {
      /* ignore */
    }
  }
}



const { hold, tap, resumePlay, keysToward, lookToward, goTo, follow, leaveShrine, checkedRead } = createRouteNavigation({
  page, read, wait, ensureOpen, MOVE_CODES, releaseAll, note, clickNamed, clickCanvas,
  focusPlaySurface, shrineWorldOrigin,
  state: {
    get sawPlaying() { return sawPlaying; }, set sawPlaying(value) { sawPlaying = value; },
    get titleMidRun() { return titleMidRun; }, set titleMidRun(value) { titleMidRun = value; },
    get lastTitleRecoverAt() { return lastTitleRecoverAt; }, set lastTitleRecoverAt(value) { lastTitleRecoverAt = value; },
    get last() { return last; }, set last(value) { last = value; },
  },
});

async function shot(name) {
  if (page.isClosed()) return null;
  try {
    const p = checkedOutputPath(resolve(outDir, name), [outDir]);
    await page.screenshot({ path: p, type: "png" });
    return p;
  } catch (err) {
    note(`shot ${name} failed: ${err?.message || err}`);
    return null;
  }
}

async function focusPlaySurface() {
  try {
    await page.locator("canvas").focus({ timeout: 800 });
  } catch {
    /* overlay */
  }
}

async function clickCanvas() {
  // Left-click enqueues attack (input.ts button 0). Only use when we mean to
  // swing or to dismiss the title overlay; look-steering must not click.
  try {
    await page.locator("canvas").click({ position: { x: 640, y: 400 }, timeout: 4000 });
  } catch {
    /* overlay may eat the click */
  }
}

async function clickNamed(name, scope) {
  checkFightScope(scope);
  const btn = page.getByRole("button", { name });
  try {
    if (await btn.count()) {
      checkFightScope(scope);
      await btn.first().click({ timeout: 2500 });
      return true;
    }
  } catch (err) {
    if (err instanceof FightStopError) throw err;
    /* overlay may be mid-transition */
  }
  return false;
}

async function startGame() {
  await page.waitForFunction(() => Boolean(window.__sim), { timeout: 30000 });
  for (let i = 0; i < 20; i++) {
    const s = await read();
    if (s?.mode === "playing") {
      sawPlaying = true;
      return s;
    }
    await clickNamed("开始探索");
    await wait(400);
  }
  return read();
}










async function interactIf(substr) {
  const s = await read();
  if (s?.prompt && s.prompt.includes(substr)) {
    await tap("KeyE");
    await wait(220);
    return true;
  }
  return false;
}

async function grabIfNotClimbing() {
  let s = await read();
  if (s?.state === "climbing") return s;
  await releaseAll();
  if (s) await lookToward(s.x - Math.sin(s.yaw), s.z - Math.cos(s.yaw));
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyE");
  await wait(280);
  await page.keyboard.up("KeyE");
  await page.keyboard.up("KeyW");
  s = await read();
  return s;
}

async function leaveTower(id, tw) {
  let s = await read();
  if (!s) return s;
  const dx = s.x - tw.x;
  const dz = s.z - tw.z;
  const len = Math.hypot(dx, dz) || 1;
  const distOut = s.y > 40 ? 18 : 11;
  const out = { x: tw.x + (dx / len) * distOut, z: tw.z + (dz / len) * distOut };
  note(`${id} leave radially to ${out.x.toFixed(1)},${out.z.toFixed(1)} from y=${s.y.toFixed(1)} ${s.state}`);
  await lookToward(out.x, out.z);
  if (s.state === "climbing") {
    await hold(["KeyC"], 200);
    await wait(250);
  }
  s = await goTo(out.x, out.z, s.y > 40 ? 20000 : 10000, { arrive: 2.6, sprint: false, label: `${id}-leave` });
  if (s?.state === "climbing") {
    await hold(["KeyC"], 200);
    await wait(400);
    s = await goTo(out.x, out.z, 8000, { arrive: 3, sprint: false, label: `${id}-leave2` });
  }
  // 88293 stayed on the crown cap (y=53.5) and fightBoss never reached the courtyard.
  if (id === "crown" && s && s.y > 40) {
    note(`${id} still high y=${s.y.toFixed(1)}; walk the ridge down`);
    s = await goTo(36, -90, 22000, { arrive: 4, sprint: false, label: `${id}-dismount` });
  }
  return s;
}

async function climbTower(id, tw) {
  note(`climb ${id}`);
  const approach = towerApproachPoint(tw, id);
  let s = await goTo(approach.x, approach.z, 70000, { arrive: 1.8, sprint: true, label: id });
  // Grab ring on the dock/approach, never the shaft center.
  const ring = towerApproachPoint(tw, id);
  s = await goTo(ring.x, ring.z, 12000, { arrive: 1.2, sprint: false, label: `${id}-ring` });
  const dist = s ? Math.hypot(s.x - tw.x, s.z - tw.z) : 999;
  note(`${id} approach dist=${dist.toFixed(1)} y=${s?.y.toFixed(1)} state=${s?.state} prompt=${s?.prompt}`);
  if (!s || dist > 12) {
    note(`${id} never arrived`);
    await shot(id === "dawn" ? "route-dawn-result.png" : `route-tower-${id}.png`);
    return s;
  }
  const baseY = authoredBaseY(id, Number.isFinite(tw.y) ? tw.y : s.y);
  note(`${id} authored baseY=${baseY.toFixed(1)} (player y=${s.y.toFixed(1)})`);
  await lookToward(tw.x, tw.z);
  for (let g = 0; g < 10 && s?.state !== "climbing"; g++) {
    // Do not walk/swim toward (tw.x, tw.z). Press into the wall with W+E.
    s = await grabIfNotClimbing();
    if (s?.state === "swimming") {
      await page.keyboard.down("KeyW");
      await page.keyboard.down("KeyE");
      await wait(320);
      await page.keyboard.up("KeyE");
      await page.keyboard.up("KeyW");
      s = await read();
    }
  }

  const deadline = Date.now() + 240000;
  let burstUntil = Date.now() + 1200;
  let rested = 0;
  let ticks = 0;
  while (Date.now() < deadline) {
    s = await resumePlay();
    last = s;
    ticks += 1;
    if (!s) break;
    const action = climbTickPolicy(s, { id, tw, baseY, burstUntil, now: Date.now() });
    if (action.type === "done") {
      note(`${id} lit towers=${s.towers}`);
      break;
    }
    if (action.type === "activate") {
      await releaseAll();
      await tap("KeyE");
      await wait(280);
      s = await read();
      note(`${id} pressed 启动 towers=${s?.towers} prompt=${s?.prompt}`);
      if (s?.towers?.includes(id)) break;
      continue;
    }
    if (action.type === "reapproach") {
      const xzNow = Math.hypot(s.x - tw.x, s.z - tw.z);
      if (s.state === "climbing" && xzNow < 8) {
        note(`${id} stay-climb y=${s.y.toFixed(1)} xz=${xzNow.toFixed(1)}`);
        await page.keyboard.down("KeyW");
        await wait(200);
        continue;
      }
      note(`${id} fell/shaft y=${s.y.toFixed(1)} xz=${xzNow.toFixed(1)}; detour`);
      await releaseAll();
      for (const wp of reapproachWaypoints(s, tw, id)) {
        await goTo(wp.x, wp.z, 12000, { arrive: 2.4, sprint: true, label: `${id}-reapproach` });
      }
      await lookToward(tw.x, tw.z);
      await grabIfNotClimbing();
      burstUntil = Date.now() + 1200;
      continue;
    }
    if (action.type === "rest") {
      rested += 1;
      if (rested <= 3 || ticks % 4 === 0) note(`${id} rest y=${s.y.toFixed(1)} stam=${s.stamina.toFixed(0)} n=${rested}`);
      await releaseAll();
      await wait(380);
      continue;
    }
    if (action.type === "regrab") {
      await releaseAll();
      await lookToward(tw.x, tw.z);
      // Hold W+E together so wantClimb (resting && moveY>0.12) fires. Never tap E then W.
      const grabKeys = keysForAction(action);
      for (const k of grabKeys) await page.keyboard.down(k);
      await wait(900);
      s = await read();
      if (s?.state === "climbing") {
        burstUntil = Date.now() + 1200;
        await page.keyboard.up("KeyE");
      } else {
        note(`${id} regrab missed state=${s?.state} y=${s?.y.toFixed(1)} stam=${s?.stamina?.toFixed?.(0)}`);
        for (const k of [...grabKeys].reverse()) {
          try {
            await page.keyboard.up(k);
          } catch {
            /* ignore */
          }
        }
      }
      continue;
    }
    if (action.type === "ledge-drop") {
      await page.keyboard.up("KeyW");
      await page.keyboard.down("KeyS");
      await wait(90);
      await page.keyboard.up("KeyS");
      await wait(200);
      s = await read();
      if (ticks % 3 === 0) note(`${id} ledge-try y=${s?.y.toFixed(1)} stam=${s?.stamina.toFixed(0)} state=${s?.state}`);
      continue;
    }
    if (action.type === "climb-up") {
      if (!burstUntil) burstUntil = Date.now() + 1150;
      await page.keyboard.down("KeyW");
      await wait(160);
      continue;
    }
    if (action.type === "surface-jump") {
      await releaseAll();
      await lookToward(tw.x, tw.z);
      await tap("Space");
      await wait(90);
      await tap("KeyE");
      await wait(160);
      continue;
    }
    if (action.type === "wait-air") {
      await releaseAll();
      await wait(280);
      continue;
    }
    await lookToward(tw.x, tw.z);
    await hold(keysToward(s, tw.x, tw.z, false), 160);
    s = await grabIfNotClimbing();
    if (s?.state === "climbing") {
      burstUntil = Date.now() + 1150;
      await page.keyboard.down("KeyW");
      await wait(200);
    }
  }
  await releaseAll();
  s = await read();
  // 85510: loop ended on the cap with prompt 启动 雪冠塔 but y>tw.y+30 skipped retry.
  if (s && !s.towers?.includes(id) && (s.prompt?.includes("启动") || s.y > baseY + 35)) {
    for (let i = 0; i < 8 && s && !s.towers?.includes(id); i++) {
      await tap("KeyE");
      await wait(280);
      s = await read();
      note(`${id} cap-E n=${i + 1} towers=${s?.towers} prompt=${s?.prompt}`);
      if (s?.towers?.includes(id)) break;
    }
  }
  if (s && !s.towers?.includes(id) && s.y < (tw.y || s.y) + 30) {
    note(`${id} not lit after climb window; retrying from the ring`);
    await goTo(ring.x, ring.z, 20000, { arrive: 1.4, sprint: false, label: `${id}-retry-ring` });
    await lookToward(tw.x, tw.z);
    for (let g = 0; g < 8 && s?.state !== "climbing"; g++) {
      s = await grabIfNotClimbing();
    }
    const retryUntil = Date.now() + 120000;
    while (Date.now() < retryUntil) {
      s = await resumePlay();
      if (!s) break;
      const action = climbTickPolicy(s, { id, tw, baseY, burstUntil: Date.now() + 800, now: Date.now() });
      if (action.type === "done" || s.towers?.includes(id)) break;
      if (action.type === "activate") {
        await tap("KeyE");
        await wait(280);
        continue;
      }
      if (action.type === "regrab") {
        const grabKeys = keysForAction(action);
        for (const k of grabKeys) await page.keyboard.down(k);
        await wait(800);
        for (const k of [...grabKeys].reverse()) {
          try {
            await page.keyboard.up(k);
          } catch {
            /* ignore */
          }
        }
        continue;
      }
      await hold(["KeyW", "KeyE"], 400);
    }
    s = await read();
  }
  note(`${id} done towers=${s?.towers} y=${s?.y.toFixed(1)} prompt=${s?.prompt} state=${s?.state}`);
  await saveStorageCheckpoint(`tower-${id}`);
  await shot(id === "dawn" ? "route-dawn-result.png" : `route-tower-${id}.png`);
  s = await leaveTower(id, tw);
  return s;
}

async function solveRuin() {
  note("wind ruin gust");
  await follow(
    [
      { x: 20, z: 86 },
      POI.gustStand,
    ],
    25000,
    2.4,
  );
  await lookToward(POI.planks.x, POI.planks.z);
  await tap("Digit1");
  for (let i = 0; i < 8; i++) {
    let s = await read();
    if (s?.ruinSolved) break;
    if (s?.prompt?.includes("复位")) {
      await tap("KeyE");
      await wait(300);
    }
    await lookToward(POI.ruin.x, POI.ruin.z);
    await tap("KeyF");
    await wait(500);
    await hold(["KeyW"], 280);
    s = await read();
    note(`gust tick ruinSolved=${s?.ruinSolved} toast=${s?.toast} art=${s?.art}`);
  }
  let s = await read();
  await shot("route-wind-gust.png");
  if (s?.ruinSolved) return s;

  note("wind ruin updraft glide");
  await goTo(POI.valleyLift.x, POI.valleyLift.z, 16000, { arrive: 2.0, sprint: true, label: "valley-lift" });
  await tap("Space");
  await wait(90);
  await tap("Space");
  const glideEnd = Date.now() + 9000;
  while (Date.now() < glideEnd) {
    s = await read();
    if (s?.ruinSolved) break;
    const keys = keysToward(s, POI.ruinSide.x, POI.ruinSide.z, false);
    await hold(keys, 220);
  }
  await goTo(POI.ruinLift.x, POI.ruinLift.z, 8000, { arrive: 1.8, sprint: false, label: "ruin-lift" });
  await tap("Space");
  await wait(80);
  await tap("Space");
  await goTo(POI.ruinSide.x, POI.ruinSide.z, 8000, { arrive: 1.6, sprint: false, label: "ruin-side" });
  s = await read();
  note(`after glide y=${s?.y.toFixed(1)} ruinSolved=${s?.ruinSolved} at ${s?.x.toFixed(1)},${s?.z.toFixed(1)}`);
  await shot("route-wind-glide.png");
  return s;
}

async function tapEnterShrine(s) {
  await focusPlaySurface();
  for (let i = 0; i < 12 && s?.shrine == null; i++) {
    if (s?.mode === "dead") {
      s = await resumePlay();
      break;
    }
    const pre = s;
    await tap("KeyE");
    await wait(450);
    s = await read();
    if (i === 0 || s?.shrine != null) {
      note(
        `E#${i} shrine=${s?.shrine} prompt=${JSON.stringify(s?.prompt)} prePrompt=${JSON.stringify(pre?.prompt)} mode=${s?.mode} lock=${s?.interactLock ?? "?"}`,
      );
    }
    if (s?.shrine != null) return s;
  }
  return s;
}

async function tryEnterShrine(id, poi, from) {
  const faces = shrineApproachCandidates(poi, from);
  let s = await read();
  for (let fi = 0; fi < faces.length; fi++) {
    const ap = faces[fi];
    s = await goTo(ap.x, ap.z, 18000, { arrive: 1.4, sprint: fi === 0, label: `${id}-face${fi}` });
    const dist = s ? Math.hypot(s.x - poi.x, s.z - poi.z) : 999;
    note(`at ${id} face${fi} dist=${dist.toFixed(1)} y=${s?.y?.toFixed?.(1)} prompt=${s?.prompt} state=${s?.state} nav=${s?.nav?.status || "?"}`);
    if (!s) continue;
    if (s.nav && !s.nav.arrived) {
      note(`refuse E at ${id} face${fi}: navigation ${s.nav.status} dist=${dist.toFixed(1)}`);
      continue;
    }
    if (s.shrine != null) {
      if (!enteredShrineMatches(s.shrine, id)) {
        note(`wrong shrine already open ${s.shrine} wanted ${id}; leaving without claiming`);
        await leaveShrine();
        s = await read();
        continue;
      }
      return s;
    }
    const gate = canEnterIntendedShrine({ id, poi, x: s.x, z: s.z, prompt: s.prompt });
    if (!gate.ok) {
      note(`refuse E at ${id}: ${gate.reason} dist=${gate.dist.toFixed(1)} prompt=${s.prompt}`);
      continue;
    }
    await shot(`route-${id}-face${fi}-before-E.png`);
    await lookToward(poi.x, poi.z);
    s = await read();
    note(`${id} after look prompt=${JSON.stringify(s?.prompt)} x=${s?.x?.toFixed?.(1)} z=${s?.z?.toFixed?.(1)} y=${s?.y?.toFixed?.(1)}`);
    s = await tapEnterShrine(s);
    if (s?.shrine != null) {
      if (!enteredShrineMatches(s.shrine, id)) {
        note(`entered shrine ${s.shrine} wanted ${id}; leaving without claiming`);
        await leaveShrine();
        s = await read();
        continue;
      }
      return s;
    }
  }
  return s;
}

function puzzleSnapshot(s, o, id) {
  const altar = o ? shrineAltar(o) : null;
  return {
    id,
    art: s?.art,
    cracked: s?.cracked,
    frozen: s?.moveBlock?.frozen,
    bx: s?.moveBlock?.x,
    bz: s?.moveBlock?.z,
    ices: s?.ices,
    metals: s?.metals,
    bomb: s?.bomb,
    toast: s?.toast,
    prompt: s?.prompt,
    orbs: s?.orbs,
    y: s?.y,
    x: s?.x,
    z: s?.z,
    dAltar: altar && s ? Math.hypot(s.x - altar.x, s.z - altar.z) : null,
  };
}

/** Intended still path: pit lip, freeze when the slab is in the center lane, walk +Z. */
async function tryStillFreezeBridge(o) {
  let s = await read();
  const altar = shrineAltar(o);
  note(`still intended start ${JSON.stringify(puzzleSnapshot(s, o, "still"))}`);
  s = await goTo(o.x, o.z + STILL_PIT_LIP_Z, 9000, { arrive: 1.2, sprint: false, label: "still-pit-lip" });
  if (!s || s.y < o.y - 1.5) {
    return { claimed: false, detail: `fell before lip y=${s?.y} z=${s?.z}` };
  }
  const alignEnd = Date.now() + 8000;
  while (Date.now() < alignEnd) {
    s = await read();
    if (s?.moveBlock && stillBlockAligned(o.x, s.moveBlock.x)) break;
    await wait(80);
  }
  s = await read();
  const aligned = Boolean(s?.moveBlock && stillBlockAligned(o.x, s.moveBlock.x));
  const frozenBefore = Number(s?.moveBlock?.frozen ?? 0);
  const toastBefore = s?.toast || "";
  await tap("Digit5");
  await tap("KeyF");
  await wait(220);
  s = await read();
  const frozenAfter = Number(s?.moveBlock?.frozen ?? 0);
  note(
    `still F aligned=${aligned} frozen ${frozenBefore}->${frozenAfter} toast ${JSON.stringify(toastBefore)}->${JSON.stringify(s?.toast)} bx=${s?.moveBlock?.x?.toFixed?.(2)} pos=${s?.x?.toFixed?.(1)},${s?.z?.toFixed?.(1)} y=${s?.y?.toFixed?.(1)}`,
  );
  if (!(frozenAfter > frozenBefore + 0.5)) {
    return { claimed: false, detail: `F had no freeze ${frozenBefore}->${frozenAfter} toast=${s?.toast}` };
  }
  s = await goTo(altar.x, altar.z, 12000, { arrive: 1.4, sprint: false, label: "still-freeze-altar" });
  if (s?.y < o.y - 1.5) {
    return { claimed: false, detail: `fell on freeze-bridge y=${s.y} z=${s.z} frozen=${s.moveBlock?.frozen}` };
  }
  if (s?.prompt?.includes("领取")) {
    await tap("KeyE");
    await wait(400);
  }
  s = await read();
  return {
    claimed: Boolean(s?.shrines?.includes("still")),
    detail: `orbs=${s?.orbs} prompt=${s?.prompt} dAltar=${s ? Math.hypot(s.x - altar.x, s.z - altar.z).toFixed(1) : "?"} frozen=${s?.moveBlock?.frozen}`,
  };
}

async function solveShrine(id) {
  const poi = POI[id];
  note(`go shrine ${id}`);
  await follow(WAYPOINTS[id], 55000, 2.6);
  const lastWp = WAYPOINTS[id][WAYPOINTS[id].length - 1] ?? poi;
  let s = await tryEnterShrine(id, poi, lastWp);
  if (s?.shrine == null) {
    note(`retry ${id} from inbound standoff`);
    const ap = shrineApproachPoint(poi, lastWp);
    s = await goTo(ap.x, ap.z, 16000, { arrive: 1.6, sprint: false, label: `${id}-retry` });
    const retryGate = s
      ? canEnterIntendedShrine({ id, poi, x: s.x, z: s.z, prompt: s.prompt })
      : { ok: false, reason: "no-sim" };
    if (retryGate.ok) {
      await lookToward(poi.x, poi.z);
      for (let i = 0; i < 6 && s?.shrine == null; i++) {
        await tap("KeyE");
        await wait(500);
        s = await read();
      }
    } else {
      note(`retry refuse E at ${id}: ${retryGate.reason} dist=${s ? Math.hypot(s.x - poi.x, s.z - poi.z).toFixed(1) : "?"} prompt=${s?.prompt}`);
    }
  }
  s = await read();
  if (s?.shrine == null) {
    note(`failed to enter ${id} prompt=${s?.prompt} dist=${s ? Math.hypot(s.x - poi.x, s.z - poi.z).toFixed(1) : "?"}`);
    await shot(`route-shrine-${id}.png`);
    return s;
  }
  if (!enteredShrineMatches(s.shrine, id)) {
    note(`entered shrine ${s.shrine} does not match requested ${id}; leaving without claiming`);
    await leaveShrine();
    await shot(`route-shrine-${id}.png`);
    return read();
  }
  note(`entered shrine ${s.shrine} id=${id} hint=${s.shrineHint}`);
  await wait(900);

  const idx = s.shrine;
  const o = shrineWorldOrigin(idx);
  const altar = shrineAltar(o);
  note(`${id} puzzle enter ${JSON.stringify(puzzleSnapshot(s, o, id))} noAbility=${shrineNoAbility}`);

  if (id === "still" && !shrineNoAbility) {
    const intended = await tryStillFreezeBridge(o);
    note(`still intended claimed=${intended.claimed} ${intended.detail}`);
    s = await read();
    if (intended.claimed || s?.shrines?.includes("still")) {
      if (s?.shrine != null) await leaveShrine();
      s = await read();
      note(`after shrine ${id} path=freeze-bridge shrines=${s?.shrines} orbs=${s?.orbs} shrine=${s?.shrine}`);
      await saveStorageCheckpoint(`shrine-${id}-freeze`);
      await shot(`route-shrine-${id}.png`);
      return s;
    }
    note("still freeze-bridge missed; sidewalk is the legal alternate (not a useF gate)");
  }

  const puzzleEnd = Date.now() + 70000;
  const sideUntil = Date.now() + 9000;
  let ticks = 0;

  while (Date.now() < puzzleEnd) {
    s = await resumePlay();
    ticks += 1;
    if (!s) break;
    if (s.shrine == null) {
      note(`left shrine ${id} shrines=${s.shrines} orbs=${s.orbs}`);
      break;
    }
    if (s.shrines?.includes(id)) {
      await leaveShrine();
      break;
    }
    if (s.prompt?.includes("领取")) {
      await tap("KeyE");
      await wait(400);
      continue;
    }

    const target = shrineNavTarget(id, o, s, {
      sideUntil,
      now: Date.now(),
      burstOpen: Boolean(s.cracked),
    });
    if (ticks % 8 === 0) {
      note(
        `${id} inside ${JSON.stringify(puzzleSnapshot(s, o, id))} nav=${target.reason}`,
      );
    }

    const claiming = target.reason === "at-altar" || target.reason === "past-z20-altar" || s.prompt?.includes("领取");
    if (!claiming && !shrineNoAbility) {
      const before = puzzleSnapshot(s, o, id);
      if (id === "burst") {
        await tap("Digit2");
        await lookToward(o.x, o.z + 12.4);
        await tap("KeyF");
      } else if (id === "rime") {
        await tap("Digit3");
        await lookToward(o.x, o.z + 16);
        await tap("KeyF");
      } else if (id === "pull") {
        await tap("Digit4");
        await lookToward(o.x + 6.2, o.z + 8);
        await tap("KeyF");
      } else if (id === "still") {
        await tap("Digit5");
        await tap("KeyF");
      }
      s = await read();
      const after = puzzleSnapshot(s, o, id);
      const physical =
        (id === "burst" && after.cracked && !before.cracked) ||
        (id === "still" && Number(after.frozen) > Number(before.frozen) + 0.2) ||
        (id === "rime" && Number(after.ices) > Number(before.ices)) ||
        (id === "pull" && JSON.stringify(after.metals) !== JSON.stringify(before.metals));
      if (ticks <= 3 || physical) {
        note(`${id} F physical=${physical} ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      }
      if (!physical && ticks === 1) note(`${id} F had no observed physical effect (spam does not count)`);
    }

    s = await goTo(target.x, target.z, 7000, { arrive: target.arrive, sprint: false, label: `${id}-${target.reason}` });
    if (target.tapE || s?.prompt?.includes("领取")) await tap("KeyE");
    await wait(180);
  }
  s = await read();
  if (s?.shrine != null) await leaveShrine();
  s = await read();
  note(`after shrine ${id} shrines=${s?.shrines} orbs=${s?.orbs} shrine=${s?.shrine}`);
  await saveStorageCheckpoint(`shrine-${id}`);
  await shot(`route-shrine-${id}.png`);
  return s;
}

async function cookPepper() {
  note("cook pepper at camp-a (meal kept for crown frost)");
  const before = await read();
  const mealsBefore = before?.meals?.length ?? 0;
  // p04/p04b: from dawn-leave, bee-line south sticks on the west face at
  // ~(8,73) climbing/airborne. First step onto open ground NE of dawn.
  if (before && Math.hypot(before.x - 9, before.z - 73) < 18) {
    note("camp-a: recover from dawn west face via (16,80)");
    await goTo(16, 80, 14000, { arrive: 3.2, sprint: true, label: "dawn-open" });
  }
  await follow(
    [
      { x: 16, z: 70 },
      { x: 28, z: 56 },
      { x: 43.6, z: 50.8 },
    ],
    40000,
    2.5,
  );
  let s = await goTo(POI.campA.x, POI.campA.z, 15000, { arrive: 2.0, sprint: false, label: "fire" });
  let opened = false;
  for (let i = 0; i < 8; i++) {
    s = await read();
    if (s?.prompt?.includes("烹饪") || s?.prompt?.includes("休息") || s?.mode === "cooking") {
      opened = true;
      await tap("KeyE");
      await wait(450);
      break;
    }
    await tap("KeyE");
    await wait(250);
  }
  const cookBtn = page.getByRole("button", { name: /烹饪 火棘椒/ });
  if (await cookBtn.count()) await cookBtn.click();
  await wait(300);
  await resumePlay();
  s = await read();
  const mealsAfter = s?.meals?.length ?? 0;
  const cooked = mealsAfter > mealsBefore || (s?.spicy ?? 0) > 0;
  note(
    `after cook spicy=${s?.spicy} meals=${mealsAfter}/${mealsBefore} opened=${opened} cooked=${cooked} mode=${s?.mode} at ${s?.x?.toFixed?.(1)},${s?.z?.toFixed?.(1)}`,
  );
  if (!cooked) {
    note("cook FAILED — will not treat after-cook as spicy ready");
  }
}

async function eatPepper() {
  note("eat 辣炒椒 before crown frost");
  await tap("Tab");
  await wait(250);
  const meal = page.getByRole("button", { name: /辣炒椒/ });
  if (await meal.count()) await meal.click();
  else await interactIf("烹饪");
  await wait(200);
  await resumePlay();
  const s = await read();
  note(`after eat spicy=${s?.spicy} cold=${s?.cold}`);
  return s;
}

async function tryMeleeClick(scope) {
  checkFightScope(scope);
  try {
    await page.locator("canvas").click({ position: { x: 640, y: 360 }, timeout: 800 });
    scope?.markInput("melee-click");
  } catch (err) {
    if (err instanceof FightStopError) throw err;
    try {
      checkFightScope(scope);
      await page.mouse.click(640, 360);
      scope?.markInput("melee-click-fallback");
    } catch (err) {
    if (err instanceof FightStopError) throw err;
      /* overlay */
    }
  }
}

async function fightBoss() {
  attemptedCitadel = true;
  note("citadel");
  // E1.1: shared orchestrator — monitor starts BEFORE descent navigation.
  const stopFirstHpDrop = process.env.QA_FOCUS === CITADEL_RESUME_FOCUS &&
    process.env.QA_STOP_FIRST_HP_DROP === "1";
  let firstHpDropPath = null;
  let firstHpDropWriteError = null;
  const orch = createFightOrchestrator({
    stopFirstHpDrop,
    onFirstHpDrop: (event) => {
      // Persist synchronously at detection, before any await or ring eviction.
      try {
        const runs = resolve(outDir, "runs");
        mkdirSync(runs, { recursive: true });
        const dir = mkdtempSync(resolve(runs, "e23-first-hp-drop-"));
        firstHpDropPath = resolve(dir, "player-hp-drop.json");
        writeFileSync(firstHpDropPath, JSON.stringify({
          ...event, runId: process.env.QA_RUN_ID ?? null,
          scope: "citadel-resume", capturedAt: new Date().toISOString(),
          neighborhoodRadius: 30,
        }, null, 2), { flag: "wx" });
        note(`first HP drop evidence ${firstHpDropPath}`);
      } catch (err) {
        firstHpDropWriteError = String(err?.message || err);
        note(`first HP drop evidence write failed: ${firstHpDropWriteError}`);
      }
    },
    read,
    hold,
    goTo,
    follow,
    resumePlay,
    tryMeleeClick,
    releaseAll,
    now: () => performance.now(),
    wait,
    note,
  });
  const fightRead = () => checkedRead(orch.scope);
  const fightAbort = orch.abort;
  const fightMonitor = orch.monitor;
  // Scoped helpers replace globals for this fight only.
  const fightHold = orch.hold;
  const fightGoTo = orch.goTo;
  const fightFollow = orch.follow;
  const fightResume = orch.resumePlay;
  const fightClick = orch.tryMeleeClick;
  // Start serial sample loop before any navigation.
  orch.startSampling();
  try {
    const entry = await runCitadelInitialApproach({
      scope: orch.scope, fightRead, fightGoTo, fightFollow, tap, wait, note, WAYPOINTS, POI,
    });
    let s = entry.snapshot;
    let pendingCombatSnapshot = entry.combatReady ? s : null;
    citadelPrompt = s?.prompt || "";
    if (s?.sealOpen === false || s?.prompt?.includes("封印未开")) {
      sealClosedAttempt = true;
      note(`seal closed prompt=${s?.prompt} sealOpen=${s?.sealOpen}`);
      await shot("route-citadel.png");
      return s;
    }
    const end = Date.now() + 180000;
    let swings = 0;
    let hits = 0;
    let attackStarts = 0;
    let deaths = 0;
    let lastApproach = null;
    let stallCount = 0;
    let missStreak = 0;
    let lastMissKey = null;
    let repositionUsed = 0;
    while (Date.now() < end) {
      if (fightAbort.aborted) break;
      // Sample loop is the sole observe path — main loop does not re-observe.
      // Consume the actual entry observation once; later turns resume as before.
      const handoffSnapshot = pendingCombatSnapshot;
      pendingCombatSnapshot = null;
      s = handoffSnapshot ?? await fightResume();
      checkFightScope(orch.scope, s);
      if (fightAbort.aborted) break;
      if (!s) break;
      if (s.bossDead || s.mode === "ending") break;
      if (s.sealOpen === false || s.prompt?.includes("封印未开")) {
        sealClosedAttempt = true;
        break;
      }
      if (
        s.mode === "dead" ||
        s.state === "dead" ||
        (Number.isFinite(s.hp) && s.hp <= 0)
      ) {
        deaths += 1;
        fightAbort.abort("death-in-loop");
        note(
          `citadel FIRST-DEATH stop n=${deaths} t=${Date.now()} hp=${s.hp} state=${s.state} mode=${s.mode} — abort latch`,
        );
        const deathRunId = process.env.QA_RUN_ID || String(Date.now());
        writeFileSync(
          resolve(outDir, `citadel-first-death-${deathRunId}.json`),
          JSON.stringify(
            {
              t: Date.now(),
              deaths,
              snap: s,
              monitor: {
                combatMs: fightMonitor.combatMs,
                navMs: fightMonitor.navMs,
                noDamageMs: fightMonitor.noDamageMs,
                ring: fightMonitor.ring.slice(-100),
              },
            },
            null,
            2,
          ),
        );
        break;
      }
      const boss = s.boss;
      if (!boss || boss.alive === false) {
        note(`citadel no live boss snapshot=${JSON.stringify(boss)} bossDead=${s.bossDead}`);
        break;
      }
      let dist = Math.hypot(s.x - boss.x, s.z - boss.z);
      if (dist > 8) {
        const off = citadelOffArena(s, boss);
        const stalled =
          lastApproach &&
          Math.abs(dist - lastApproach.dist) < 1.4 &&
          Math.hypot(s.x - lastApproach.x, s.z - lastApproach.z) < 2.8;
        stallCount = stalled ? stallCount + 1 : 0;
        lastApproach = { x: s.x, z: s.z, dist };
        note(
          `citadel reapproach live boss d=${dist.toFixed(1)} from ${s.x.toFixed(1)},${s.z.toFixed(1)} y=${s.y.toFixed(1)} state=${s.state} grounded=${s.grounded} off=${off.reason} stall=${stallCount} bossY=${boss.y?.toFixed?.(1)} phase=${boss.phase} prompt=${s.prompt}`,
        );
        if (s.y > 40) {
          await fightGoTo(36, -90, 22000, { arrive: 4, sprint: false, label: "citadel-off-crown", safeDescent: true });

          await fightGoTo(24, -40, 18000, { arrive: 5, sprint: true, label: "citadel-from-crown", safeDescent: true });
        } else if (s.z < -50 && dist > 18) {
          await fightGoTo(-12, -28, 18000, { arrive: 5, sprint: true, label: "citadel-avoid-still" });

          await fightFollow([{ x: 6, z: 18 }, { x: 6, z: 8 }], 14000, 4);

          await fightGoTo(POI.citadel.x, POI.citadel.z + 8, 12000, { arrive: 3.4, sprint: true, label: "citadel-gate" });
        } else if (off.off || stallCount >= 2) {
          const wps = citadelReturnWaypoints(s, boss);
          note(
            `citadel recover via ${wps.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`).join("→")} from ${s.x.toFixed(1)},${s.z.toFixed(1)} reason=${off.reason}`,
          );
          for (const wp of wps) {
            await fightGoTo(wp.x, wp.z, 24000, { arrive: 3.0, sprint: true, label: "citadel-return" });
          }
          stallCount = 0;
        }

        s = await fightGoTo(boss.x, boss.z, 16000, {
          arrive: 4.2,
          sprint: dist > 14 && s.y < 30,
          label: "citadel-boss",
        });
        continue;
      }
      lastApproach = { x: s.x, z: s.z, dist };
      stallCount = 0;
      const prepared = await prepareCitadelCombatDecision({
        snapshot: s, preserveSnapshot: handoffSnapshot !== null,
        scope: orch.scope, lookToward, fightRead,
      });
      if (!prepared) break;
      s = prepared.snapshot;
      dist = prepared.dist;
      const faceDot = prepared.faceDot;
      const step = prepared.step;
      if (step.act === "reposition") {
        if (repositionUsed >= 1) {
          note(`citadel reposition already used still-blocked wall=${s.blockerId} — end short trajectory`);
          break;
        }
        note(
          `citadel reposition los-blocked wall=${s.blockerId || "?"} player=${s.x?.toFixed?.(1)},${s.y?.toFixed?.(1)},${s.z?.toFixed?.(1)} boss=${s.boss.x?.toFixed?.(1)},${s.boss.z?.toFixed?.(1)} d=${dist.toFixed?.(1)} t=${Date.now()}`,
        );
        const rp = await runCitadelLosReposition({ scope: orch.scope, goTo: fightGoTo, read: fightRead, note, start: s });
        repositionUsed += 1;
        s = rp.s ?? (await fightRead());
        pendingCombatSnapshot = rp.combatReady ? s : null;
        if (!rp.ok) {
          note(`citadel reposition failed — short trajectory stop`);
          break;
        }
        missStreak = 0;
        continue;
      }
      const defense = await executeCitadelDefense({
        snapshot: s, step, scope: orch.scope, fightHold, fightRead, releaseAll, note,
      });
      if (defense.handled) {
        s = defense.snapshot;
        if (!s?.boss) break;
        continue;
      }
      if (step.act === "approach") {
        await fightHold(keysToward(s, s.boss.x, s.boss.z, dist > 6), 160);
        continue;
      }
      if (step.act === "hold-attack") {
        await wait(90);
        continue;
      }
      if (step.act === "wait-facing") {
        note(`citadel wait-facing dot=${faceDot.toFixed(2)} camYaw=${s.camYaw?.toFixed?.(2)}`);
        await lookToward(s.boss.x, s.boss.z, orch.scope);
        continue;
      }
      const hpBefore = s?.boss?.hp;
      const phaseBefore = s?.attackPhase;
      const yaw = s?.yaw;
      const camYaw = s?.camYaw;
      const px = s?.x;
      const pz = s?.z;

      await fightClick();
      await wait(180);
      s = await fightRead();
      if (s && (s.mode === "dead" || s.state === "dead" || (Number.isFinite(s.hp) && s.hp <= 0))) {
        deaths += 1;
        fightAbort.abort("death-after-swing");
        note(
          `citadel dead after swing n=${deaths} hp=${s.hp} player=${s.x?.toFixed?.(2)},${s.y?.toFixed?.(2)},${s.z?.toFixed?.(2)} — abort no resumePlay`,
        );
        break;
      }
      swings += 1;
      const phaseAfter = s?.attackPhase;
      if (phaseAfter && phaseAfter !== "idle") attackStarts += 1;
      const hpAfter = s?.boss?.hp;
      const landed = Number.isFinite(hpAfter) && Number.isFinite(hpBefore) && hpAfter < hpBefore - 0.01;
      if (landed) {
        hits += 1;
        missStreak = 0;
        lastMissKey = null;
      } else {
        const mk = `${px?.toFixed?.(2)}|${pz?.toFixed?.(2)}|${hpBefore}|${yaw?.toFixed?.(2)}`;
        if (mk === lastMissKey) missStreak += 1;
        else {
          missStreak = 1;
          lastMissKey = mk;
        }
        if (missStreak >= 3) {
          note(
            `citadel miss-streak=${missStreak} t=${Date.now()} player=${px?.toFixed?.(2)},${s?.y?.toFixed?.(2)},${pz?.toFixed?.(2)} boss=${s?.boss?.x?.toFixed?.(2)},${s?.boss?.z?.toFixed?.(2)} phase=${s?.boss?.phase} blocked=${s?.bossMeleeBlocked} wall=${s?.blockerId || "?"} — stop swing, reposition once`,
          );
          if (repositionUsed >= 1) {
            note("citadel reposition already used — end short trajectory");
            break;
          }
          const rp2 = await runCitadelLosReposition({ scope: orch.scope, goTo: fightGoTo, read: fightRead, note, start: s });
          repositionUsed += 1;
          missStreak = 0;
          s = rp2.s ?? (await fightRead());
          pendingCombatSnapshot = rp2.combatReady ? s : null;
          if (!rp2.ok) {
            note("citadel miss-streak reposition failed — end short trajectory");
            break;
          }
          continue;
        }
      }
      if (swings <= 4 || swings % 5 === 0 || landed || s?.hp < 1.5) {
        const d = s?.boss ? Math.hypot(s.x - s.boss.x, s.z - s.boss.z) : -1;
        note(
          `citadel swing=${swings} hit=${landed} hp ${hpBefore}->${hpAfter} player=${px?.toFixed?.(2)},${s?.y?.toFixed?.(2)},${pz?.toFixed?.(2)} yaw=${yaw?.toFixed?.(2)} camYaw=${camYaw?.toFixed?.(2)} boss=${s?.boss?.x?.toFixed?.(2)},${s?.boss?.z?.toFixed?.(2)} dist=${d.toFixed?.(2)} weapon=${s?.equippedId} ammo=${s?.arrows} attack ${phaseBefore}->${phaseAfter} cd=${s?.attackT?.toFixed?.(2)} seal=${s?.sealOpen} playerHp=${s?.hp} dodgeCd=${s?.dodgeCd?.toFixed?.(2)} bossPhase=${s?.boss?.phase} prompt=${s?.prompt}`,
        );
      }
    }
    s = await fightRead();
    note(
      `citadel towers=${s?.towers} orbs=${s?.orbs} bossDead=${s?.bossDead} mode=${s?.mode} prompt=${s?.prompt} swings=${swings} hits=${hits} attackStarts=${attackStarts} deaths=${deaths} bossHp=${s?.boss?.hp} seal=${s?.sealOpen} combatMs=${fightMonitor.combatMs} navMs=${fightMonitor.navMs} noDamageMs=${fightMonitor.noDamageMs} abort=${fightAbort.reason || "none"}`,
    );
    await shot("route-citadel.png");
    await saveStorageCheckpoint("after-citadel");
    return s;
  } catch (err) {
    if (!(err instanceof FightStopError)) throw err;
    note(`citadel stopped reason=${err.reason} combatMs=${fightMonitor.combatMs} navMs=${fightMonitor.navMs}`);
    const snap = fightMonitor.latched?.snap ?? orch.scope.lastSnapshot ?? last;
    writeFileSync(
      resolve(outDir, `citadel-stop-${process.env.QA_RUN_ID || Date.now()}.json`),
      JSON.stringify({ reason: err.reason, deaths: err.reason === "death" ||
        (err.reason === "player-hp-drop" && (snap?.mode === "dead" || snap?.state === "dead" || snap?.hp <= 0)) ? 1 : 0,
        snap, firstHpDropPath, firstHpDropWriteError,
        firstHpDrop: fightMonitor.latched?.reason === "player-hp-drop" ? fightMonitor.latched : null,
        navigationFailure: orch.scope.navigationFailure ?? null,
        defensiveFailure: orch.scope.defensiveFailure ?? null,
        navigationEvidence: orch.getNavigationEvidence(),
        combatMs: fightMonitor.combatMs, navMs: fightMonitor.navMs,
        noDamageMs: fightMonitor.noDamageMs, ring: fightMonitor.ring }, null, 2),
    );
    return snap;
  } finally {
    citadelNavigationEvidence = orch.getNavigationEvidence();
    citadelNavigationEvidence.ring = structuredClone(fightMonitor.ring);
    // E1.1: stop and await sample loop BEFORE browser cleanup.
    await orch.stopSampling(fightAbort.reason || "fight-end");
    await releaseAll();
  }
}
async function readSaveEnvelope() {
  ensureOpen();
  return page.evaluate(() => {
    const v2 = localStorage.getItem("aetherwake-save-v2");
    const v1 = localStorage.getItem("aetherwake-save-v1");
    const raw = v2 || v1;
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const progress = parsed?.progress && typeof parsed.progress === "object" ? parsed.progress : parsed || {};
    return {
      present: Boolean(raw),
      key: v2 ? "aetherwake-save-v2" : v1 ? "aetherwake-save-v1" : null,
      towers: Array.isArray(progress.towers) ? progress.towers : [],
      shrines: Array.isArray(progress.shrines) ? progress.shrines : [],
      orbs: Number(progress.orbs ?? 0),
      bossDead: progress.bossDead === true,
      ruinSolved: progress.ruinSolved === true,
    };
  });
}

/**
 * Review15: persist legitimate browser save at checkpoints (not only teardown).
 * Never fabricates game data.
 */
async function saveStorageCheckpoint(label) {
  try {
    if (page.isClosed()) return null;
    const snap = await page.evaluate(() => ({
      v2: localStorage.getItem("aetherwake-save-v2"),
      v1: localStorage.getItem("aetherwake-save-v1"),
      origin: location.origin,
      href: location.href,
    }));
    if (!snap?.v2 && !snap?.v1) {
      note(`storage checkpoint ${label}: no save key yet`);
      return null;
    }
    const file = resolve(outDir, `storage-ckpt-${label}.json`);
    writeFileSync(
      file,
      JSON.stringify({ ...snap, label, t: Date.now(), hasV2: Boolean(snap.v2), hasV1: Boolean(snap.v1) }, null, 2),
    );
    note(`storage checkpoint ${label} -> ${file} v2=${Boolean(snap.v2)}`);
    return file;
  } catch (e) {
    note(`storage checkpoint ${label} failed: ${e?.message || e}`);
    return null;
  }
}

/**
 * Reload the page and click 继续旅途. Reads window.__sim / localStorage only.
 * Never writes player coords, rewards, or completion flags.
 */
async function observeSaveReload() {
  const before = await read();
  const envelope = await readSaveEnvelope().catch((err) => {
    throwIfClosed(err);
    return { present: false, error: err?.message || String(err) };
  });
  note(`save envelope present=${envelope?.present} towers=${envelope?.towers} shrines=${envelope?.shrines} orbs=${envelope?.orbs}`);
  await tap("Escape");
  await wait(250);
  await resumePlay();
  ensureOpen();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.__sim), { timeout: 30000 });
  let continued = false;
  for (let i = 0; i < 12; i++) {
    const s = await read();
    if (s?.mode === "playing" || s?.mode === "ending" || s?.mode === "credits") {
      continued = i > 0 || Boolean(envelope?.present);
      if (s.mode === "playing") sawPlaying = true;
      break;
    }
    continued = (await clickNamed("继续旅途")) || continued;
    await wait(350);
  }
  const after = await read();
  if (after?.mode === "playing") sawPlaying = true;
  const check = saveReloadRestored(before, after);
  const result = {
    attempted: true,
    savePresent: envelope?.present === true,
    continued,
    restored: check.ok && envelope?.present === true && continued,
    detail: check.detail,
    envelope,
    before: progressSnapshot(before),
    after: progressSnapshot(after),
  };
  note(`save-reload restored=${result.restored} continued=${continued} afterTowers=${after?.towers} afterShrines=${after?.shrines}`);
  return result;
}

function writeReport(extra = {}) {
  const verdict = evaluateRoute({
    final: last,
    observed,
    titleMidRun,
    attemptedCitadel,
    sealClosedAttempt,
    citadelPrompt,
    closeReason,
    saveReload,
  });
  const report = {
    ok: verdict.ok,
    failures: verdict.failures,
    titleMidRun,
    attemptedCitadel,
    sealClosedAttempt,
    citadelPrompt,
    closeReason,
    saveReload,
    server: {
      owned: Boolean(ownedServer.owned),
      pid: ownedServer.pid ?? null,
      port: ownedServer.port ?? null,
      url: ownedServer.url ?? url,
      pidFile: ownedServer.pidFile ?? null,
      logFile: ownedServer.logFile ?? null,
    },
    observed,
    lastGood,
    final: last,
    navigationEvidence: citadelNavigationEvidence,
    log,
    ...extra,
  };
  const json = checkedOutputPath(resolve(outDir, "play-routes.json"), [outDir]);
  writeFileSync(json, JSON.stringify(report, null, 2));
  return { json, verdict };
}

async function teardownBrowser() {
  closeFlags.intentionalTeardown = true;
  try {
    await releaseAll();
  } catch {
    /* ignore */
  }
  // Review13: preserve legitimate browser save before teardown (no fabrication).
  try {
    if (!page.isClosed()) {
      const save = await page.evaluate(() => ({
        v2: localStorage.getItem("aetherwake-save-v2"),
        v1: localStorage.getItem("aetherwake-save-v1"),
        origin: location.origin,
        href: location.href,
      }));
      if (save?.v2 || save?.v1) {
        writeFileSync(resolve(outDir, "browser-save-snapshot.json"), JSON.stringify({ ...save, t: Date.now() }, null, 2));
        note(`saved browser-save-snapshot v2=${Boolean(save.v2)} v1=${Boolean(save.v1)}`);
      }
    }
  } catch (e) {
    note(`save snapshot failed: ${e?.message || e}`);
  }
  try {
    if (!page.isClosed()) await context.close();
  } catch {
    /* ignore */
  }
  try {
    if (browser.isConnected()) await browser.close();
  } catch {
    /* ignore */
  }
}

async function teardownServer() {
  if (ownedServer?.owned) await stopOwnedServer(ownedServer);
}

try {
  const stillUp = await waitHttpReady(url, ownedServer?.child, 15000);
  if (!stillUp?.ok) {
    throw new Error(`owned preview not answering before goto: ${stillUp?.error || "unknown"}`);
  }
  let gotoErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      gotoErr = null;
      break;
    } catch (err) {
      gotoErr = err;
      note(`goto attempt ${attempt + 1} failed: ${err?.message || err}`);
      await wait(700);
    }
  }
  if (gotoErr) throw gotoErr;
  // D4.1: citadel-resume injects the designated sealed save once, then 继续旅途.
  const resumePlan = citadelResumePlan({
    focus: process.env.QA_FOCUS || null,
    ckptPath: process.env.QA_STORAGE_CHECKPOINT || null,
  });
  if (resumePlan.mode === "citadel-resume" && !resumePlan.ok) {
    throw new Error(resumePlan.reason || "citadel-resume plan invalid");
  }
  let resumeInject = null;
  if (resumePlan.mode === "citadel-resume") {
    note(`citadel-resume restore ${resumePlan.ckptPath}`);
    const rawCkpt = readFileSync(resolve(root, resumePlan.ckptPath), "utf8");
    const ckptJson = JSON.parse(rawCkpt);
    const v2 = typeof ckptJson.v2 === "string" ? ckptJson.v2 : JSON.stringify(ckptJson.v2);
    const sourceSha = await import("node:crypto").then((c) =>
      c.createHash("sha256").update(rawCkpt).digest("hex"),
    );
    await page.evaluate((saveV2) => {
      // Formal save key only; no progress writes beyond the legal file bytes.
      localStorage.setItem("aetherwake-save-v2", saveV2);
    }, v2);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(800);
    // Must continue — never start a new file.
    const cont = page.locator("button", { hasText: "继续旅途" });
    if ((await cont.count()) > 0) {
      await cont.first().focus();
      await page.keyboard.press("Enter");
      await wait(800);
    } else {
      note("citadel-resume: no 继续旅途 button — refuse new game");
      throw new Error("citadel-resume missing continue button");
    }
    last = await read();
    const v2After = await page.evaluate(() => localStorage.getItem("aetherwake-save-v2"));
    resumeInject = {
      scope: "citadel-resume",
      ckptPath: resumePlan.ckptPath,
      sourceSha256: sourceSha,
      v2Len: v2.length,
      v2MatchesSource: v2MatchesSource(v2, v2After),
      restore: {
        mode: last?.mode,
        towers: last?.towers,
        shrines: last?.shrines,
        orbs: last?.orbs,
        sealOpen: last?.sealOpen,
        hp: last?.hp,
        pos: last
          ? { x: +last.x.toFixed(3), y: +last.y.toFixed(3), z: +last.z.toFixed(3) }
          : null,
        bossDead: last?.bossDead,
      },
    };
    note(
      `citadel-resume restore ok towers=${last?.towers} orbs=${last?.orbs} hp=${last?.hp} pos=${resumeInject.restore.pos && JSON.stringify(resumeInject.restore.pos)} v2Match=${resumeInject.v2MatchesSource} sha=${sourceSha}`,
    );
    if (!resumeInject.v2MatchesSource) {
      throw new Error("citadel-resume v2 string rewritten after inject");
    }
  } else {
    last = await startGame();
  }
  await wait(400);
  await clickCanvas();
  last = await read();
  if (last?.mode === "playing") sawPlaying = true;
  note(`start mode=${last?.mode} at ${last?.x?.toFixed?.(1)},${last?.z?.toFixed?.(1)}`);
  await shot("route-start.png");

  if (resumePlan.mode === "citadel-resume") {
    note("QA_FOCUS=citadel: resume sealed save + original fightBoss (no coord jump)");
    // Focus gate: legal progress on this restore.
    const focusOk =
      Boolean(last?.sealOpen) &&
      ["dawn", "mere", "crown"].every((t) => last.towers?.includes(t)) &&
      ["pull", "rime", "burst", "still"].every((t) => last.shrines?.includes(t)) &&
      (last?.orbs ?? 0) >= 4 &&
      last?.bossDead === false;
    if (!focusOk) {
      note(
        `citadel-resume focus verify FAIL towers=${last?.towers} shrines=${last?.shrines} orbs=${last?.orbs} bossDead=${last?.bossDead} seal=${last?.sealOpen}`,
      );
    }
    // E1: focusOk=false is precondition-failed — never call fightBoss.
    const gate = await runCitadelFocusGate({
      focusOk,
      fightBoss: () => fightBoss(),
    });
    last = gate.result ?? last;
    if (!focusOk) {
      note(`citadel-resume focus verify FAIL — precondition-failed (no fightBoss)`);
    }
    const battleOk =
      focusOk && Boolean(last?.bossDead || last?.mode === "ending") && !closeReason;
    let completion = null;
    if (battleOk) {
      try {
        completion = await verifyCitadelCompletion({
          finish: last,
          saveCheckpoint: async () => {
            await shot("route-citadel-victory.png");
            return saveStorageCheckpoint("citadel-victory");
          },
          observeReload: observeSaveReload,
          read,
        });
        saveReload = completion.reload ?? null;
        last = completion.after ?? last;
        note(`citadel completion verified=${completion.ok} failures=${JSON.stringify(completion.failures)}`);
      } catch (err) {
        completion = { ok: false, failures: ["completion-observation-error"], error: String(err?.message || err) };
        note(`citadel completion failed: ${completion.error}`);
      }
    }
    const citadelOk = battleOk && completion?.ok === true && !closeReason;
    const json = checkedOutputPath(resolve(outDir, "citadel-resume.json"), [outDir]);
    writeFileSync(
      json,
      JSON.stringify(
        {
          ok: citadelOk,
          scope: "citadel-resume",
          focus: "citadel",
          resumeInject,
          focusVerify: focusOk,
          completion,
          towers: last?.towers || [],
          shrines: last?.shrines || [],
          orbs: last?.orbs ?? 0,
          bossDead: last?.bossDead,
          mode: last?.mode,
          bossHp: last?.boss?.hp,
          final: last,
          navigationEvidence: citadelNavigationEvidence,
          closeReason,
          log,
        },
        null,
        2,
      ),
    );
    await teardownBrowser();
    await teardownServer();
    harnessLife?.writeExit?.({ exitCode: citadelOk ? 0 : 1, closeReason });
    console.log(
      JSON.stringify(
        {
          json,
          ok: citadelOk,
          scope: "citadel-resume",
          bossDead: last?.bossDead,
          towers: last?.towers,
          closeReason,
        },
        null,
        2,
      ),
    );
    process.exit(citadelOk ? 0 : 1);
  }

  if (process.env.QA_FOCUS === "mere") {
    note("QA_FOCUS=mere: lake approach + shaft climb only (real keys, no progress writes)");
    await follow(WAYPOINTS.mere, 50000, 2.4);
    last = await climbTower("mere", POI.mere);
    const mereOk = Boolean(last?.towers?.includes("mere")) && !closeReason;
    const json = checkedOutputPath(resolve(outDir, "mere-focus.json"), [outDir]);
    writeFileSync(
      json,
      JSON.stringify(
        {
          ok: mereOk,
          focus: "mere",
          towers: last?.towers || [],
          final: last,
          closeReason,
          log,
        },
        null,
        2,
      ),
    );
    await teardownBrowser();
    await teardownServer();
    harnessLife?.writeExit?.({ exitCode: mereOk ? 0 : 1, closeReason });
    console.log(JSON.stringify({ json, ok: mereOk, focus: "mere", towers: last?.towers, closeReason }, null, 2));
    process.exit(mereOk ? 0 : 1);
  }

  if (process.env.QA_FOCUS === "crown") {
    note("QA_FOCUS=crown: frost tower climb only (real keys, no progress writes)");
    await follow(WAYPOINTS.crown, 50000, 3);
    last = await climbTower("crown", POI.crown);
    const crownOk = Boolean(last?.towers?.includes("crown")) && !closeReason;
    const json = checkedOutputPath(resolve(outDir, "crown-focus.json"), [outDir]);
    writeFileSync(
      json,
      JSON.stringify(
        {
          ok: crownOk,
          focus: "crown",
          towers: last?.towers || [],
          final: last,
          closeReason,
          log,
        },
        null,
        2,
      ),
    );
    await teardownBrowser();
    await teardownServer();
    harnessLife?.writeExit?.({ exitCode: crownOk ? 0 : 1, closeReason });
    console.log(JSON.stringify({ json, ok: crownOk, focus: "crown", towers: last?.towers, closeReason }, null, 2));
    process.exit(crownOk ? 0 : 1);
  }

  if (process.env.QA_FOCUS === "still") {
    note(`QA_FOCUS=still noAbility=${shrineNoAbility}: 凝时祠 freeze-bridge then sidewalk alternate`);
    WAYPOINTS.still = STILL_FROM_SPAWN;
    last = await solveShrine("still");
    const claimed = Boolean(last?.shrines?.includes("still"));
    const stillOk = claimed && !closeReason;
    const json = checkedOutputPath(resolve(outDir, shrineNoAbility ? "still-no-ability.json" : "still-focus.json"), [outDir]);
    writeFileSync(
      json,
      JSON.stringify(
        {
          ok: stillOk,
          focus: "still",
          noAbility: shrineNoAbility,
          shrines: last?.shrines || [],
          orbs: last?.orbs ?? 0,
          final: last,
          closeReason,
          log,
        },
        null,
        2,
      ),
    );
    await teardownBrowser();
    await teardownServer();
    harnessLife?.writeExit?.({ exitCode: stillOk ? 0 : 1, closeReason });
    console.log(
      JSON.stringify(
        {
          json,
          ok: stillOk,
          focus: "still",
          noAbility: shrineNoAbility,
          shrines: last?.shrines,
          orbs: last?.orbs,
          closeReason,
        },
        null,
        2,
      ),
    );
    process.exit(stillOk ? 0 : 1);
  }

  note("walk toward dawn tower");
  await follow(WAYPOINTS.dawn, 28000, 2.4);
  last = await read();
  note(
    `near dawn? ${last?.x.toFixed(1)},${last?.z.toFixed(1)} dist=${last ? Math.hypot(last.x - 10, last.z - 68).toFixed(1) : "?"}`,
  );
  await shot("route-dawn-approach.png");
  await climbTower("dawn", POI.dawn);

  last = await solveRuin();
  await cookPepper();

  for (const id of ["pull", "rime", "burst", "still"]) {
    last = await solveShrine(id);
  }

  last = await climbTower("mere", POI.mere);
  await eatPepper();
  await follow(WAYPOINTS.crown, 40000, 3);
  last = await climbTower("crown", POI.crown);

  const ready =
    last &&
    ["dawn", "mere", "crown"].every((t) => last.towers?.includes(t)) &&
    ["pull", "rime", "burst", "still"].every((t) => last.shrines?.includes(t));
  if (ready) last = await fightBoss();
  else {
    note("skip citadel: towers/shrines incomplete (would be a seal-closed failure if forced)");
    await goTo(POI.citadel.x, POI.citadel.z, 8000, { arrive: 16, sprint: true, label: "citadel-look" });
    last = await read();
    if (last?.prompt?.includes("封印未开")) {
      note(`citadel visible but not entered: ${last.prompt}`);
    }
    await shot("route-citadel.png");
  }

  last = await read();
  try {
    saveReload = await observeSaveReload();
    last = saveReload.after ? await read() : last;
  } catch (err) {
    throwIfClosed(err);
    saveReload = {
      attempted: true,
      savePresent: false,
      continued: false,
      restored: false,
      before: progressSnapshot(last),
      after: null,
      detail: err?.message || String(err),
    };
    note(`save-reload failed: ${err?.message || err}`);
  }

  const { json, verdict } = writeReport();
  await teardownBrowser();
  await teardownServer();
  harnessLife?.writeExit?.({ exitCode: verdict.ok ? 0 : 1, closeReason });
  console.log(
    JSON.stringify(
      {
        json,
        ok: verdict.ok,
        failures: verdict.failures,
        closeReason,
        saveReload: { attempted: saveReload.attempted, restored: saveReload.restored, continued: saveReload.continued },
        towers: last?.towers,
        shrines: last?.shrines,
        orbs: last?.orbs,
        ruinSolved: last?.ruinSolved,
        bossDead: last?.bossDead,
        mode: last?.mode,
        titleMidRun,
        serverPid: ownedServer.pid ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(verdict.ok ? 0 : 1);
} catch (err) {
  last = last || null;
  if (err instanceof ClosedPageError) closeReason = closeReason || err.closeReason;
  else {
    const reason = classifyClose({ ...closeFlags, errorMessage: err?.message || String(err) });
    if (reason) closeReason = closeReason || reason;
  }
  if (process.env.QA_FOCUS === "mere" || process.env.QA_FOCUS === "crown" || process.env.QA_FOCUS === "still") {
    const focus = process.env.QA_FOCUS;
    const json = checkedOutputPath(resolve(outDir, `${focus}-focus.json`), [outDir]);
    writeFileSync(
      json,
      JSON.stringify(
        {
          ok: false,
          focus,
          towers: last?.towers || [],
          final: last,
          closeReason,
          error: err?.message || String(err),
          log,
        },
        null,
        2,
      ),
    );
    console.error(JSON.stringify({ ok: false, focus, json, closeReason, error: err?.message || String(err) }, null, 2));
    await teardownBrowser();
    await teardownServer();
    harnessLife?.setCloseReason?.(closeReason);
    harnessLife?.writeExit?.({ exitCode: 1, closeReason, error: err?.message || String(err), stack: err?.stack });
    process.exit(1);
  }
  const { json, verdict } = writeReport({ error: err?.message || String(err) });
  console.error(
    JSON.stringify(
      { ok: false, error: err?.message || String(err), closeReason, json, failures: verdict.failures, log },
      null,
      2,
    ),
  );
  await teardownBrowser();
  await teardownServer();
  harnessLife?.setCloseReason?.(closeReason);
  harnessLife?.writeExit?.({ exitCode: 1, closeReason, error: err?.message || String(err), stack: err?.stack });
  process.exit(1);
}
