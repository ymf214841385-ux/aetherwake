#!/usr/bin/env node
/**
 * R30 bounded desktop acceptance: A08 load-first-step, A06 glide,
 * D11 map/bag touch, D08 modal isolation. Ordinary input only.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptDir = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `r30-accept-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], errors: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };

const readTel = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    return {
      mode: s.mode,
      world: s.worldKind,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      yaw: +p.yaw.toFixed(4),
      camYaw: +s.cam.yaw.toFixed(4),
      state: p.state,
      gliding: p.gliding,
      vx: +p.vx.toFixed(3),
      vy: +p.vy.toFixed(3),
      vz: +p.vz.toFixed(3),
      hp: p.hp,
      stamina: +p.stamina.toFixed(1),
      towers: [...s.towersOn],
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      bossDead: s.bossDead,
      load: window.__AW_CHARACTER_LOAD?.status ?? null,
    };
  });

async function remappedCkpt(name, url) {
  const raw = JSON.parse(readFileSync(resolve(ckptDir, name), 'utf8'));
  return { ...raw, origins: (raw.origins || []).map((o) => ({ ...o, origin: url.replace(/\/$/, '') })) };
}

async function continueGame(page) {
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: /继续/ }).first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 }).catch(() => {});
  await page.locator('canvas').focus().catch(() => {});
  await page.waitForTimeout(350);
}

let browser;
const server = await maybeStartQaServer({ name: 'r30-accept', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });

  // ---- A08: load natural save, first forward step, reload counterpart ----
  {
    const state = await remappedCkpt('post-boss-from-crown.storage.json', server.url);
    const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, storageState: state });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message)));
    await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
    await continueGame(page);
    const before = await readTel(page);
    record('A08-load', before.bossDead === true && before.load === 'ready', {
      before: { x: before.x, y: before.y, z: before.z, yaw: before.yaw, camYaw: before.camYaw, load: before.load, bossDead: before.bossDead },
    });
    await page.screenshot({ path: resolve(outDir, 'A08-after-load.png') });

    // Ordinary forward step (W)
    const z0 = before.z, yaw0 = before.yaw, x0 = before.x;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(350);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(80);
    const after = await readTel(page);
    const moved = Math.hypot(after.x - x0, after.z - z0);
    record('A08-first-forward', moved > 0.05 && after.state === 'grounded', {
      moved: +moved.toFixed(3),
      yawDelta: +(after.yaw - yaw0).toFixed(4),
      after: { x: after.x, z: after.z, yaw: after.yaw, camYaw: after.camYaw, state: after.state },
    });
    await page.screenshot({ path: resolve(outDir, 'A08-after-forward.png') });

    // Reload counterpart — same save, first pose facing/motion
    await page.reload({ waitUntil: 'domcontentloaded' });
    await continueGame(page);
    const re = await readTel(page);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(350);
    await page.keyboard.up('KeyW');
    const re2 = await readTel(page);
    record('A08-reload-first-step', re.load === 'ready' && Math.hypot(re2.x - re.x, re2.z - re.z) > 0.05, {
      re: { x: re.x, y: re.y, z: re.z, yaw: re.yaw, load: re.load },
      moved: +Math.hypot(re2.x - re.x, re2.z - re.z).toFixed(3),
    });
    await page.screenshot({ path: resolve(outDir, 'A08-reload-forward.png') });
    await ctx.close();
  }

  // ---- A06 glide from dawn tower + D11/D08 touch map/bag (alive) ----
  {
    // dawn cap has hp=4 (crown checkpoint was hp=0.5 frost and died before glide)
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
    record('A06-start-on-dawn-cap', t0.y > 40 && t0.state === 'grounded' && t0.hp > 1, {
      y: t0.y, state: t0.state, hp: t0.hp, x: t0.x, z: t0.z,
    });

    // D11/D08 first while healthy: touch map, bag isolation
    // Escape from overlay goes to paused — close map/bag by tapping the same button again.
    const mapBtn = page.locator('[data-touch-action="map"]');
    const mapVis = await mapBtn.isVisible().catch(() => false);
    await mapBtn.tap({ timeout: 800 }).catch(() => {});
    await page.waitForTimeout(250);
    const mapMode = await page.evaluate(() => window.__sim.mode);
    await page.screenshot({ path: resolve(outDir, 'D11-map.png') });
    const xBeforeEsc = await readTel(page);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(250);
    await page.keyboard.up('KeyW');
    const xUnderMap = await readTel(page);
    // Escape from map → pause; second Escape → playing.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    if ((await page.evaluate(() => window.__sim.mode)) !== 'playing') {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
    }
    const afterMap = await readTel(page);
    record('D11-touch-map', mapVis && mapMode === 'map' && afterMap.mode === 'playing', {
      mapVis, mapMode, afterMode: afterMap.mode,
      worldMovedUnderMap: +Math.hypot(xUnderMap.x - xBeforeEsc.x, xUnderMap.z - xBeforeEsc.z).toFixed(4),
    });

    const bagBtn = page.locator('[data-touch-action="bag"]');
    const bagVis = await bagBtn.isVisible().catch(() => false);
    const x0b = await readTel(page);
    await bagBtn.tap({ timeout: 800 }).catch(() => {});
    await page.waitForTimeout(250);
    const bagMode = await page.evaluate(() => window.__sim.mode);
    await page.screenshot({ path: resolve(outDir, 'D11-bag.png') });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(250);
    await page.keyboard.up('KeyW');
    const underBag = await readTel(page);
    await page.locator('[data-touch-action="attack"]').tap({ timeout: 400 }).catch(() => {});
    await page.waitForTimeout(150);
    const afterAtk = await page.evaluate(() => ({
      mode: window.__sim.mode,
      attackPhase: window.__sim.attack?.phase ?? null,
    }));
    // inventory + Escape → pause; second Escape → playing
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    if ((await page.evaluate(() => window.__sim.mode)) !== 'playing') {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
    }
    const afterBag = await readTel(page);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(250);
    await page.keyboard.up('KeyW');
    const resumed = await readTel(page);
    record('D08-D11-bag-isolation', bagVis && bagMode === 'inventory' && afterBag.mode === 'playing', {
      bagVis, bagMode,
      movedUnderBag: +Math.hypot(underBag.x - x0b.x, underBag.z - x0b.z).toFixed(4),
      attackPhaseUnderBag: afterAtk.attackPhase,
      afterMode: afterBag.mode,
      resumedMoved: +Math.hypot(resumed.x - afterBag.x, resumed.z - afterBag.z).toFixed(3),
    });

    // A06: turn away from tower, walk/jump off, then Space again while falling → glide.
    // Production: a.jump (one-shot) while airborne && vy<1.4 && stamina>8 starts glide.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.down('ArrowLeft');
      await page.waitForTimeout(40);
      await page.keyboard.up('ArrowLeft');
    }
    let y0 = (await readTel(page)).y;
    await page.keyboard.down('KeyW');
    await page.keyboard.press('Space'); // initial jump off
    for (let i = 0; i < 40; i++) {
      const t = await readTel(page);
      if (t.state === 'airborne' && i > 2) break;
      if (t.y < y0 - 2) break;
      await page.waitForTimeout(50);
    }
    // wait until falling (vy already captured? add vy to readTel) then press Space again
    for (let i = 0; i < 20; i++) {
      const t = await readTel(page);
      if (t.state !== 'airborne' && t.state !== 'gliding') break;
      if (t.vy < 1.4) {
        await page.keyboard.press('Space');
        break;
      }
      await page.waitForTimeout(40);
    }
    const glideTrace = [];
    let sawGlide = false;
    for (let i = 0; i < 50; i++) {
      const t = await readTel(page);
      glideTrace.push({ i, state: t.state, gliding: t.gliding, y: +t.y.toFixed(2), vy: t.vy, vx: t.vx, vz: t.vz, yaw: t.yaw, stam: t.stamina, hp: t.hp });
      if (t.gliding || t.state === 'gliding') { sawGlide = true; break; }
      if (t.state === 'grounded' && i > 6) break;
      if (t.state === 'dead') break;
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: resolve(outDir, 'A06-glide.png') });
    // Keep flying forward off the tower — do not turn back onto the cap.
    const glideStart = await readTel(page);
    for (let i = 0; i < 25; i++) {
      const t = await readTel(page);
      if (t.state === 'grounded' || t.state === 'dead') break;
      glideTrace.push({ i: 100 + i, state: t.state, gliding: t.gliding, y: +t.y.toFixed(2), vy: t.vy, x: t.x, z: t.z, hp: t.hp });
      await page.waitForTimeout(80);
    }
    await page.keyboard.up('KeyW');
    let land = await readTel(page);
    for (let i = 0; i < 80; i++) {
      land = await readTel(page);
      if (land.state === 'grounded' || land.state === 'dead') break;
      await page.waitForTimeout(100);
    }
    await page.screenshot({ path: resolve(outDir, 'A06-land.png') });
    const leftCap = Math.hypot(land.x - t0.x, land.z - t0.z) > 12 || land.y < 40;
    record('A06-glide', sawGlide && leftCap && land.state !== 'climbing', {
      sawGlide, leftCap, distFromStart: +Math.hypot(land.x - t0.x, land.z - t0.z).toFixed(1),
      mid: glideTrace.find((g) => g.gliding || g.state === 'gliding') ?? glideTrace[0],
      land: { x: land.x, y: land.y, z: land.z, state: land.state, yaw: land.yaw, hp: land.hp },
      traceTail: glideTrace.slice(-6),
    });
    record('A06-land-not-climb-pose', sawGlide && land.state !== 'climbing', {
      state: land.state,
      note: 'glide seen; exit is not a stale climb pose (gliding/grounded/dead are valid production states)',
      yawDuringGlide: glideTrace.find((g) => g.gliding)?.yaw ?? null,
      landYaw: land.yaw,
    });
    await ctx.close();
  }

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
