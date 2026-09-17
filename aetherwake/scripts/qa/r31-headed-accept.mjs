#!/usr/bin/env node
/**
 * R31 headed: pure-touch D11/D08, safe A06 landing + steady facing.
 * Ordinary input only. No Escape for touch close; no KeyW for touch resume.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptDir = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `r31-accept-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], errors: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };

const readTel = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    return {
      mode: s.mode,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      yaw: +p.yaw.toFixed(4),
      state: p.state,
      gliding: p.gliding,
      vx: +p.vx.toFixed(3),
      vy: +p.vy.toFixed(3),
      vz: +p.vz.toFixed(3),
      hp: p.hp,
      stamina: +p.stamina.toFixed(1),
      attackPhase: s.attack?.phase ?? null,
      load: window.__AW_CHARACTER_LOAD?.status ?? null,
    };
  });

async function continueGame(page) {
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: /继续/ }).first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 }).catch(() => {});
  await page.locator('canvas').focus().catch(() => {});
  await page.waitForTimeout(350);
}

async function remappedCkpt(name, url) {
  const raw = JSON.parse(readFileSync(resolve(ckptDir, name), 'utf8'));
  return { ...raw, origins: (raw.origins || []).map((o) => ({ ...o, origin: url.replace(/\/$/, '') })) };
}

/** Pure-touch close: 关闭 button if in viewport, else modal-back overlay. */
async function tapModalClose(page) {
  const vh = page.viewportSize()?.height ?? 390;
  const close = page.locator('button:has-text("关闭")');
  if ((await close.count()) > 0) {
    const box = await close.first().boundingBox();
    // Only tap if the control is actually on screen (small-landscape defect check).
    if (box && box.y + box.height <= vh && box.y >= 0) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      const mode = await page.evaluate(() => window.__sim.mode);
      if (mode === 'playing') return { ok: true, via: 'close-button', mode, box, vh };
      return { ok: false, via: 'close-button-tap-noop', mode, box, vh, offscreen: false };
    }
    // Record off-screen close as a layout defect signal (still try overlay).
    if (box) {
      await page.screenshot({ path: resolve(outDir, 'close-offscreen.png') }).catch(() => {});
    }
  }
  const back = page.locator('.modal-back');
  if ((await back.count()) > 0) {
    // Tap top strip of the backdrop — away from the centered .modal panel.
    await page.touchscreen.tap(20, 16);
    await page.waitForTimeout(200);
    const mode = await page.evaluate(() => window.__sim.mode);
    return { ok: mode === 'playing', via: 'modal-back', mode };
  }
  return { ok: false, reason: 'no-close-ui' };
}

/** Emulate touch joystick drag on the stick element. */
async function touchStickDrag(page, dx, dy, ms = 300) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  if (!stick) return { ok: false, reason: 'no-stick' };
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.touchscreen.tap(cx, cy); // establish ownership is not enough; use mouse as touch
  // Playwright touch: use mouse down/up which maps to touch on hasTouch context
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return { ok: true, cx, cy, dx, dy };
}

let browser;
const server = await maybeStartQaServer({ name: 'r31-accept', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const state = await remappedCkpt('post-dawn-from-shrines.storage.json', server.url);
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    storageState: state,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await continueGame(page);
  const t0 = await readTel(page);
  record('start', t0.y > 40 && t0.state === 'grounded' && t0.hp > 1, { t0: { x: t0.x, y: t0.y, z: t0.z, hp: t0.hp } });

  // ---- D11 pure touch map open / isolation / touch close / stick resume ----
  const mapBtn = page.locator('[data-touch-action="map"]');
  const mapVis = await mapBtn.isVisible().catch(() => false);
  const mapBox = await mapBtn.boundingBox();
  await page.touchscreen.tap(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.waitForTimeout(250);
  const mapMode = await page.evaluate(() => window.__sim.mode);
  await page.screenshot({ path: resolve(outDir, 'D11-map.png') });

  // Isolation: canvas/world tap under map must not move world.
  // Do not use stick for isolation — stick sits under full-screen modal-back
  // and is a legitimate touch-close path, not a movement input while open.
  const beforeIso = await readTel(page);
  const mapCanvas = page.locator('canvas');
  const mcb = await mapCanvas.boundingBox();
  let mapWorldTap = { ok: false };
  if (mcb) {
    await page.touchscreen.tap(mcb.x + mcb.width * 0.5, mcb.y + mcb.height * 0.4);
    mapWorldTap = { ok: true, point: { x: mcb.x + mcb.width * 0.5, y: mcb.y + mcb.height * 0.4 } };
  }
  await page.waitForTimeout(200);
  const underMap = await readTel(page);
  const movedUnderMap = Math.hypot(underMap.x - beforeIso.x, underMap.z - beforeIso.z);

  const closeMap = await tapModalClose(page);
  const afterMap = await readTel(page);
  const beforeResume = await readTel(page);
  await touchStickDrag(page, 0, -42, 320);
  const afterResume = await readTel(page);
  const resumedMoved = Math.hypot(afterResume.x - beforeResume.x, afterResume.z - beforeResume.z);
  record('D11-pure-touch-map', mapVis && mapMode === 'map' && closeMap.ok && afterMap.mode === 'playing'
    && movedUnderMap < 0.05 && resumedMoved > 0.05, {
    mapVis, mapMode, closeMap, mapWorldTap,
    movedUnderMap: +movedUnderMap.toFixed(4),
    underMapMode: underMap.mode,
    afterMode: afterMap.mode,
    resumedMoved: +resumedMoved.toFixed(3),
  });

  // ---- D08 bag isolation: attack + stick under bag; touch close; stick resume ----
  const bagBtn = page.locator('[data-touch-action="bag"]');
  const bagVis = await bagBtn.isVisible().catch(() => false);
  const bagBox = await bagBtn.boundingBox();
  await page.touchscreen.tap(bagBox.x + bagBox.width / 2, bagBox.y + bagBox.height / 2);
  await page.waitForTimeout(250);
  const bagMode = await page.evaluate(() => window.__sim.mode);
  await page.screenshot({ path: resolve(outDir, 'D08-bag.png') });

  // Isolation: while bag is open, stick input must not move the world.
  // Note: on this viewport the stick hit-box sits under the full-screen
  // modal-back; a stick tap may legitimately close the overlay (touch close).
  // That is still not world locomotion. Then require stick resume after close.
  const bag0 = await readTel(page);
  await touchStickDrag(page, 0, -40, 250);
  const underBag = await readTel(page);
  const movedUnderBag = Math.hypot(underBag.x - bag0.x, underBag.z - bag0.z);
  const atkIdleUnderBag = underBag.attackPhase === 'idle';
  const modeAfterStick = underBag.mode;

  let closeBag = await tapModalClose(page);
  if (!closeBag.ok && modeAfterStick === 'playing') {
    closeBag = { ok: true, via: 'stick-hit-backdrop', mode: modeAfterStick };
  }
  const afterBag = await readTel(page);
  const beforeStick2 = await readTel(page);
  await touchStickDrag(page, 0, -42, 320);
  const afterStick2 = await readTel(page);
  const bagResume = Math.hypot(afterStick2.x - beforeStick2.x, afterStick2.z - beforeStick2.z);

  record('D08-bag-isolation', bagVis && bagMode === 'inventory' && closeBag.ok
    && movedUnderBag < 0.05 && atkIdleUnderBag
    && afterBag.mode === 'playing' && bagResume > 0.05, {
    bagVis, bagMode, closeBag,
    movedUnderBag: +movedUnderBag.toFixed(4),
    attackPhaseUnderStick: underBag.attackPhase,
    modeAfterStick,
    afterMode: afterBag.mode,
    bagResume: +bagResume.toFixed(3),
  });

  // ---- A06 glide: leave cap, re-press Space while falling, land grounded alive ----
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(40);
    await page.keyboard.up('ArrowLeft');
  }
  const startPose = await readTel(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.press('Space');
  for (let i = 0; i < 40; i++) {
    const t = await readTel(page);
    if (t.state === 'airborne' && i > 2) break;
    if (t.y < startPose.y - 2) break;
    await page.waitForTimeout(50);
  }
  for (let i = 0; i < 20; i++) {
    const t = await readTel(page);
    if (t.state !== 'airborne' && t.state !== 'gliding') break;
    if (t.vy < 1.4) {
      await page.keyboard.press('Space');
      break;
    }
    await page.waitForTimeout(40);
  }
  const trace = [];
  let sawGlide = false;
  for (let i = 0; i < 80; i++) {
    const t = await readTel(page);
    trace.push({ i, state: t.state, gliding: t.gliding, y: +t.y.toFixed(2), vy: t.vy, vx: t.vx, vz: t.vz, yaw: t.yaw, hp: t.hp, x: t.x, z: t.z });
    if (t.gliding || t.state === 'gliding') sawGlide = true;
    if (sawGlide && (t.state === 'grounded' || t.state === 'dead')) break;
    if (t.state === 'dead') break;
    await page.waitForTimeout(80);
  }
  await page.keyboard.up('KeyW');
  let land = await readTel(page);
  for (let i = 0; i < 40; i++) {
    land = await readTel(page);
    if (land.state === 'grounded' || land.state === 'dead') break;
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: resolve(outDir, 'A06-land.png') });

  // Steady facing: after landing, measure facing vs velocity over settled frames
  const settle = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(80);
    const t = await readTel(page);
    settle.push(t);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(40);
  }
  const last = settle[settle.length - 1] ?? land;
  const speed = Math.hypot(last.vx, last.vz);
  const fx = -Math.sin(last.yaw);
  const fz = -Math.cos(last.yaw);
  const align = speed > 0.2 ? (last.vx * fx + last.vz * fz) / speed : 0;
  const landOk = land.state === 'grounded' && land.hp > 0 && land.gliding === false;
  const facingOk = speed > 0.2 && align > 0.7;
  record('A06-safe-land', sawGlide && landOk, {
    sawGlide, land: { x: land.x, y: land.y, z: land.z, state: land.state, gliding: land.gliding, hp: land.hp },
    distFromStart: +Math.hypot(land.x - startPose.x, land.z - startPose.z).toFixed(1),
  });
  record('A06-steady-facing', landOk && facingOk, {
    speed: +speed.toFixed(3), align: +align.toFixed(3), yaw: last.yaw,
    vx: last.vx, vz: last.vz,
    note: 'align = (v · forward(yaw))/|v| after settle',
  });
  record('A06-not-climb-pose', sawGlide && land.state !== 'climbing', { state: land.state });

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    dir: outDir,
    errors: report.errors,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  report.failure = String(e && e.stack || e);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await stopOwnedServer(server);
}
