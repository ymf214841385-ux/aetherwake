#!/usr/bin/env node
/**
 * Plan 11.7 short loop — ordinary input only.
 * No cam.yaw / player.yaw writes. Look uses real Arrow keys (camera look input).
 * Required: sage → chest → map dawn → tower base → climb → activate → reload keeps dawn.
 * Stops at first failure with contact/stamina/phase trace.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideClimbAction } from '../../src/game/climb-controller.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `short-loop-real-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = {
  ok: false,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  milestones: [],
  failure: null,
  errors: [],
  directionChecks: [],
};
const record = (name, pass, data = {}) => {
  report.milestones.push({ name, pass, ...data, t: Date.now() });
  return pass;
};
const fail = (name, data) => {
  report.failure = { milestone: name, ...data };
  record(name, false, data);
};

function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

let browser;
const server = await maybeStartQaServer({ name: 'short-loop-real', kind: 'preview' });
assert.ok(server.ok, server.error);

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const climbBtn = document.querySelector('[data-touch-action="climb"]');
    const climbVisible = climbBtn
      ? climbBtn.getBoundingClientRect().width > 0 && getComputedStyle(climbBtn).display !== 'none'
      : false;
    // Nearest climbable solid (readonly physics probe)
    let nearestClimb = null;
    if (s.solids) {
      for (const sol of s.solids) {
        if (!sol.climbable) continue;
        const d = Math.hypot(p.x - sol.x, p.z - sol.z);
        if (!nearestClimb || d < nearestClimb.d) {
          nearestClimb = { id: sol.id, d, climbable: sol.climbable, standable: sol.standable };
        }
      }
    }
    return {
      mode: s.mode,
      x: p.x,
      y: p.y,
      z: p.z,
      vx: p.vx,
      vz: p.vz,
      yaw: p.yaw,
      camYaw: s.cam.yaw,
      state: p.state,
      climbing: p.climbing,
      hp: p.hp,
      stamina: p.stamina,
      prompt: s.prompt,
      towers: [...s.towersOn],
      chests: [...s.chestsGot],
      quest: s.trackedObjective()?.title,
      load: window.__AW_CHARACTER_LOAD?.status,
      climbBtnExists: Boolean(climbBtn),
      climbBtnVisible: climbVisible,
      nearestClimb,
      mantle: s.mantle ? { phase: s.mantle.phase ?? null } : null,
    };
  });

async function steerToward(page, tx, tz, maxSteps = 40) {
  // Real look input only (Arrow keys → camera). Readonly yaw feedback.
  for (let i = 0; i < maxSteps; i++) {
    const t = await readTelemetry(page);
    const dx = tx - t.x;
    const dz = tz - t.z;
    const desired = Math.atan2(-dx, -dz);
    const err = angDiff(desired, t.camYaw);
    if (Math.abs(err) < 0.25) return { ok: true, steps: i, camYaw: t.camYaw, desired };
    // cam.yaw -= lookX; ArrowRight adds +lookX → decreases cam.yaw.
    // err = desired - camYaw > 0 → need larger cam.yaw → ArrowLeft.
    const key = err > 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key);
    await page.waitForTimeout(40);
    await page.keyboard.up(key);
  }
  const t = await readTelemetry(page);
  const dx = tx - t.x;
  const dz = tz - t.z;
  return { ok: false, camYaw: t.camYaw, desired: Math.atan2(-dx, -dz), err: angDiff(Math.atan2(-dx, -dz), t.camYaw) };
}

async function driveStick(page, dy = -40, ms = 400) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  if (!stick) throw new Error('no stick');
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 4 });
  await page.waitForTimeout(ms);
  const t = await readTelemetry(page);
  await page.mouse.up();
  await page.waitForTimeout(80);
  return t;
}

async function walkToward(page, tx, tz, { maxDrives = 50, arrive = 2.5, name }) {
  let prevDist = Infinity;
  let awayCount = 0;
  const samples = [];
  for (let i = 0; i < maxDrives; i++) {
    const steer = await steerToward(page, tx, tz, 24);
    // Direction math: wish = (-sin(camYaw), -cos(camYaw)); require dot(wish, target-player) > 0
    const pre = await readTelemetry(page);
    const dx = tx - pre.x;
    const dz = tz - pre.z;
    const wishX = -Math.sin(pre.camYaw);
    const wishZ = -Math.cos(pre.camYaw);
    const dot = wishX * dx + wishZ * dz;
    const dist = Math.hypot(dx, dz);
    report.directionChecks.push({ name, i, dist: +dist.toFixed(2), dot: +dot.toFixed(2), camYaw: +pre.camYaw.toFixed(3), steerOk: steer.ok });
    if (dot < 0) {
      awayCount += 1;
      if (awayCount >= 2) {
        return { ok: false, reason: 'wrong-direction', last: pre, samples, steer };
      }
    } else {
      awayCount = 0;
    }
    if (dist < arrive) {
      return { ok: true, last: pre, samples };
    }
    const t = await driveStick(page, -44, 320);
    samples.push({ i, x: +t.x.toFixed(2), z: +t.z.toFixed(2), dist: +Math.hypot(tx - t.x, tz - t.z).toFixed(2), state: t.state, stamina: +t.stamina.toFixed(1) });
    const newDist = Math.hypot(tx - t.x, tz - t.z);
    if (newDist > prevDist + 0.15) {
      awayCount += 1;
      if (awayCount >= 3) {
        return { ok: false, reason: 'moving-away', last: t, samples };
      }
    } else if (newDist < prevDist - 0.05) {
      awayCount = 0;
    }
    prevDist = newDist;
  }
  const last = await readTelemetry(page);
  return { ok: false, reason: 'bounded-drives', last, samples };
}

async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if ((await btn.count()) === 0) return null;
  if (!(await btn.isVisible().catch(() => false))) return readTelemetry(page);
  await btn.tap({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(180);
  return readTelemetry(page);
}

try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => report.errors.push(String(e.message)));

  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.waitForSelector('canvas');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 });
  await page.waitForTimeout(400);
  const start = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '01-start.png') });
  if (!record('01-start', start.mode === 'playing' && start.load === 'ready', start)) {
    fail('01-start', start);
    throw new Error('start failed');
  }

  const moved = await driveStick(page, -45, 500);
  await page.screenshot({ path: resolve(outDir, '02-move.png') });
  const d0 = Math.hypot(moved.x - start.x, moved.z - start.z);
  if (!record('02-move', d0 > 0.4 || Math.hypot(moved.vx, moved.vz) > 0.3, { d0 })) {
    fail('02-move', { d0, moved });
    throw new Error('move failed');
  }

  // Sage (4, 114)
  const sageWalk = await walkToward(page, 4, 114, { arrive: 2.8, maxDrives: 35, name: 'sage' });
  await page.screenshot({ path: resolve(outDir, '03-near-sage.png') });
  if (!record('03-near-sage', sageWalk.ok, { sageWalk: { ok: sageWalk.ok, reason: sageWalk.reason, last: sageWalk.last } })) {
    fail('03-near-sage', sageWalk);
    throw new Error('near sage failed');
  }
  const talked = await tapInteract(page);
  await page.screenshot({ path: resolve(outDir, '04-sage-talk.png') });
  if (!record('04-sage-talk', talked?.mode === 'dialogue', { talked })) {
    fail('04-sage-talk', { talked });
    throw new Error('sage talk failed');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Chest (20, 108)
  const chestWalk = await walkToward(page, 20, 108, { arrive: 1.5, maxDrives: 25, name: 'chest' });
  if (!record('03b-near-chest', chestWalk.ok, { chestWalk: { ok: chestWalk.ok, reason: chestWalk.reason, last: chestWalk.last } })) {
    fail('03b-near-chest', chestWalk);
    throw new Error('near chest failed');
  }
  let afterChest = await tapInteract(page);
  if ((afterChest?.chests?.length ?? 0) === 0) {
    await driveStick(page, -18, 220);
    afterChest = await tapInteract(page);
  }
  await page.screenshot({ path: resolve(outDir, '05-chest.png') });
  if (!record('05-chest-reward', (afterChest?.chests?.length ?? 0) > 0, { afterChest })) {
    fail('05-chest-reward', { afterChest });
    throw new Error('chest reward failed');
  }

  // Map select dawn
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map', { timeout: 8000 });
  await page.waitForTimeout(150);
  await page.locator('.map-legend button', { hasText: '晨光塔' }).click();
  await page.waitForTimeout(80);
  const mapped = await page.evaluate(() => window.__sim.trackedObjective()?.targetId);
  if (!record('06-map-dawn', mapped === 'dawn', { mapped })) {
    fail('06-map-dawn', { mapped });
    throw new Error('map select dawn failed');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Tower base (10, 68) — approach from +Z side, desired yaw near 0
  const towerWalk = await walkToward(page, 10, 68, { arrive: 6.5, maxDrives: 55, name: 'tower' });
  await page.screenshot({ path: resolve(outDir, '07-tower-approach.png') });
  if (!record('07-tower-base', towerWalk.ok, {
    towerWalk: { ok: towerWalk.ok, reason: towerWalk.reason, last: towerWalk.last },
    lastSamples: (towerWalk.samples || []).slice(-5),
  })) {
    fail('07-tower-base', towerWalk);
    throw new Error('tower base failed');
  }

  // Climb via shared decision function (climb-controller.ts). maxY is diagnostics only.
  const climbTrace = [];
  let climbingSeen = false;
  let maxY = towerWalk.last.y;
  let activated = false;
  let restElapsedMs = 0;
  const activateY = 11.1 + 38 - 2.2; // dawn world y + TOWER_HEIGHT - 2.2
  const snapClimb = (tag, t2, extra = {}) => {
    climbTrace.push({
      tag,
      x: +t2.x.toFixed(2),
      y: +t2.y.toFixed(2),
      z: +t2.z.toFixed(2),
      state: t2.state,
      stamina: +t2.stamina.toFixed(1),
      prompt: t2.prompt,
      nearestClimb: t2.nearestClimb?.id ?? null,
      mantle: t2.mantle,
      climbVisible: t2.climbBtnVisible,
      interactVisible: t2.climbBtnVisible, // proxy; real interact checked on tap
      ...extra,
    });
  };

  async function holdStick(dirY, ms) {
    const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
    const cx = stick.x + stick.width / 2;
    const cy = stick.y + stick.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + dirY, { steps: 3 });
    await page.waitForTimeout(ms);
    await page.mouse.up();
  }

  for (let i = 0; i < 160; i++) {
    const t0 = await readTelemetry(page);
    maxY = Math.max(maxY, t0.y); // diagnostics only
    if (t0.towers.includes('dawn')) {
      activated = true;
      break;
    }

    const dec = decideClimbAction(
      {
        state: t0.state,
        mode: t0.mode,
        y: t0.y,
        stamina: t0.stamina,
        hp: t0.hp,
        nearestClimbId: t0.nearestClimb?.id ?? null,
        prompt: t0.prompt,
        towers: t0.towers,
        interactVisible: true,
      },
      { restElapsedMs, restRecovered: 85, restTimeoutMs: 8000, activateY },
    );

    if (dec.phase === 'DEAD' || dec.phase === 'FAIL') {
      snapClimb(dec.phase, t0, { reason: dec.reason, i });
      fail(dec.phase === 'DEAD' ? 'death-during-climb' : 'climb-fail', { maxY, last: t0, reason: dec.reason, trace: climbTrace });
      writeFileSync(resolve(outDir, 'climb-trace.json'), JSON.stringify(climbTrace, null, 2) + '\n');
      throw new Error(dec.reason);
    }

    if (dec.phase === 'REST') {
      restElapsedMs = 0;
      snapClimb('enter-REST', t0, { reason: dec.reason, i });
      restElapsedMs = 200;
      continue;
    }
    if (dec.phase === 'REST_WAIT') {
      // No input ownership.
      await page.waitForTimeout(200);
      restElapsedMs += 200;
      if (restElapsedMs % 400 < 200) snapClimb('REST_WAIT', await readTelemetry(page), { restElapsedMs });
      continue;
    }

    // Leaving REST when recovered — zero elapsed so next frame is not REST_WAIT
    if (restElapsedMs > 0 && t0.state === 'grounded' && t0.stamina >= 85) {
      restElapsedMs = 0;
      snapClimb('leave-REST', t0, { i });
    }

    if (dec.phase === 'DESCEND') {
      await holdStick(40, 250);
      const td = await readTelemetry(page);
      snapClimb('DESCEND', td, { reason: dec.reason, i });
      maxY = Math.max(maxY, td.y);
      continue;
    }

    if (dec.phase === 'ASCEND') {
      // Sustained up-hold while climbing; sample every 120ms for REST/low-stam exit.
      const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
      const cx = stick.x + stick.width / 2;
      const cy = stick.y + stick.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 52, { steps: 3 });
      let broke = false;
      for (let h = 0; h < 10; h++) {
        if (dec.tryClimb && (await page.locator('[data-touch-action="climb"]').isVisible().catch(() => false))) {
          await page.locator('[data-touch-action="climb"]').tap({ timeout: 600 }).catch(() => {});
        }
        await page.waitForTimeout(120);
        const th = await readTelemetry(page);
        maxY = Math.max(maxY, th.y);
        if (th.state === 'climbing') climbingSeen = true;
        if (th.towers.includes('dawn')) {
          activated = true;
          await page.mouse.up();
          break;
        }
        if (th.state === 'dead') {
          await page.mouse.up();
          snapClimb('DEAD', th, { i });
          fail('death-during-climb', { maxY, last: th });
          writeFileSync(resolve(outDir, 'climb-trace.json'), JSON.stringify(climbTrace, null, 2) + '\n');
          throw new Error('died during climb');
        }
        // Exit climb hold when legitimate rest / low stam / not climbing
        if (th.state !== 'climbing' || th.stamina < 8) {
          broke = true;
          await page.mouse.up();
          snapClimb('ASCEND-break', th, { i, stam: th.stamina, state: th.state });
          break;
        }
      }
      if (!broke) await page.mouse.up();
      if (activated) break;
      continue;
    }

    if (dec.phase === 'APPROACH') {
      await steerToward(page, 10, 68, 8);
      await holdStick(-48, 200);
      if ((await page.locator('[data-touch-action="climb"]').isVisible().catch(() => false))) {
        await page.locator('[data-touch-action="climb"]').tap({ timeout: 800 }).catch(() => {});
      }
      const ta = await readTelemetry(page);
      snapClimb('APPROACH', ta, { i });
      maxY = Math.max(maxY, ta.y);
      if (ta.towers.includes('dawn')) {
        activated = true;
        break;
      }
      continue;
    }

    if (dec.phase === 'SUMMIT_INTERACT') {
      await tapInteract(page);
      const ti = await readTelemetry(page);
      snapClimb('SUMMIT_INTERACT', ti, { i, reason: dec.reason });
      if (ti.towers.includes('dawn')) {
        activated = true;
        break;
      }
      continue;
    }
  }

  const climbEnd = await readTelemetry(page);
  maxY = Math.max(maxY, climbEnd.y);
  await page.screenshot({ path: resolve(outDir, '08-climb.png') });
  // One last interact if already at height
  if (!activated && climbEnd.y >= activateY) {
    await tapInteract(page);
    if ((await readTelemetry(page)).towers.includes('dawn')) activated = true;
  }
  const climbFinal = await readTelemetry(page);
  if (climbFinal.towers.includes('dawn')) activated = true;
  await page.screenshot({ path: resolve(outDir, '09-activate.png') });
  const climbPass = climbingSeen && (activated || maxY > towerWalk.last.y + 8);
  if (!record('08-climb', climbPass, {
    climbingSeen,
    maxY,
    startY: towerWalk.last.y,
    activateY,
    climbEnd: { y: climbEnd.y, state: climbEnd.state, stamina: climbEnd.stamina },
    traceTail: climbTrace.slice(-8),
  })) {
    fail('08-climb', { climbingSeen, maxY, startY: towerWalk.last.y, climbEnd, trace: climbTrace });
    writeFileSync(resolve(outDir, 'climb-trace.json'), JSON.stringify(climbTrace, null, 2) + '\n');
    throw new Error('climb failed');
  }
  if (!record('09-activate-dawn', activated, {
    maxY,
    climbFinal: { y: climbFinal.y, prompt: climbFinal.prompt, towers: climbFinal.towers },
  })) {
    fail('09-activate-dawn', { maxY, climbFinal, traceTail: climbTrace.slice(-12) });
    writeFileSync(resolve(outDir, 'climb-trace.json'), JSON.stringify(climbTrace, null, 2) + '\n');
    throw new Error('activate failed');
  }

  // Reload must retain dawn
  const beforeReload = await readTelemetry(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  const hasSave = await page.evaluate(() => {
    try {
      return Boolean(localStorage.getItem('aetherwake-save-v2') || localStorage.getItem('aetherwake-save-v1'));
    } catch {
      return false;
    }
  });
  if (hasSave) {
    const cont = page.getByRole('button', { name: /继续|载入/ });
    if ((await cont.count()) > 0) await cont.first().click();
    await page.waitForTimeout(400);
  }
  const afterReload = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '10-reload.png') });
  if (!record('10-reload-dawn', hasSave && afterReload.towers.includes('dawn'), {
    hasSave,
    before: { towers: beforeReload.towers, chests: beforeReload.chests },
    after: { towers: afterReload.towers, chests: afterReload.chests, mode: afterReload.mode },
  })) {
    fail('10-reload-dawn', { hasSave, afterReload });
    throw new Error('reload dawn failed');
  }

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ name: m.name, pass: m.pass })),
    dir: outDir,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  if (!report.failure) report.failure = { milestone: 'exception', message: e.message, stack: e.stack };
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify({
    ok: false,
    failure: report.failure?.milestone || report.failure?.message,
    milestones: report.milestones.map((m) => ({ name: m.name, pass: m.pass })),
    failureData: report.failure,
  }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
