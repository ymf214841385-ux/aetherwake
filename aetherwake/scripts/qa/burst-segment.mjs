#!/usr/bin/env node
/**
 * Burst shrine bounded segment (ordinary input).
 * Prefers storageState checkpoint; never synthesizes progress.
 * Milestones: map-select burst → arrive door → enter → art1 place+explode wall →
 * altar claim once → leave → reload persistence.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptDir = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint');
const ckptPath = resolve(ckptDir, 'post-dawn.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `burst-seg-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
mkdirSync(ckptDir, { recursive: true });

const report = {
  ok: false,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  checkpoint: null,
  milestones: [],
  failure: null,
  errors: [],
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

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      x: p.x,
      y: p.y,
      z: p.z,
      camYaw: s.cam.yaw,
      state: p.state,
      stamina: p.stamina,
      prompt: s.prompt,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      towers: [...s.towersOn],
      cracked: [...s.crackedBroken],
      art: s.art,
      nav: s.navigationSnapshot()?.status,
      navNext: s.navigationSnapshot()?.nextAction,
      navGuidance: s.navigationSnapshot()?.guidance,
      quest: s.trackedObjective()?.title,
      selected: s.preferredMapTarget?.() ?? null,
    };
  });

async function steerToward(page, tx, tz, maxSteps = 30) {
  for (let i = 0; i < maxSteps; i++) {
    const t = await readTelemetry(page);
    const desired = Math.atan2(-(tx - t.x), -(tz - t.z));
    const err = angDiff(desired, t.camYaw);
    if (Math.abs(err) < 0.3) return true;
    // cam.yaw -= lookX; ArrowRight +lookX decreases yaw
    const key = err > 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key);
    await page.waitForTimeout(35);
    await page.keyboard.up(key);
  }
  return false;
}

async function driveStick(page, dy = -42, ms = 300) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 3 });
  await page.waitForTimeout(ms);
  const t = await readTelemetry(page);
  await page.mouse.up();
  await page.waitForTimeout(60);
  return t;
}

async function walkToward(page, tx, tz, { maxDrives = 80, arrive = 3.5, name }) {
  let prev = Infinity;
  const samples = [];
  for (let i = 0; i < maxDrives; i++) {
    await steerToward(page, tx, tz, 20);
    const t = await driveStick(page, -44, 280);
    const d = Math.hypot(tx - t.x, tz - t.z);
    samples.push({ i, x: +t.x.toFixed(1), z: +t.z.toFixed(1), d: +d.toFixed(1), world: t.world, mode: t.mode });
    if (d < arrive) return { ok: true, last: t, samples };
    if (d > prev + 0.4) {
      // moving away twice
      const t2 = await driveStick(page, -44, 250);
      const d2 = Math.hypot(tx - t2.x, tz - t2.z);
      if (d2 > d + 0.3) return { ok: false, reason: 'moving-away', last: t2, samples };
    }
    prev = d;
  }
  const last = await readTelemetry(page);
  return { ok: false, reason: 'bounded-drives', last, samples };
}

async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if ((await btn.count()) === 0) return null;
  if (!(await btn.isVisible().catch(() => false))) return readTelemetry(page);
  await btn.tap({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(200);
  return readTelemetry(page);
}

let browser;
const server = await maybeStartQaServer({ name: 'burst-seg', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  const launchOpts = { ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 };
  if (existsSync(ckptPath)) {
    const state = JSON.parse(readFileSync(ckptPath, 'utf8'));
    browser = await chromium.launch(launchOpts);
    var ctx = await browser.newContext({
      viewport: { width: 900, height: 500 },
      hasTouch: true,
      storageState: state,
    });
    report.checkpoint = { path: ckptPath, source: 'storageState' };
  } else {
    browser = await chromium.launch(launchOpts);
    var ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
    report.checkpoint = { path: null, source: 'fresh-context-no-checkpoint-on-disk' };
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => report.errors.push(String(e.message)));

  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.waitForSelector('canvas');

  // Continue if natural save present; else start new (documented).
  const hasSave = await page.evaluate(() => {
    try {
      return Boolean(localStorage.getItem('aetherwake-save-v2') || localStorage.getItem('aetherwake-save-v1'));
    } catch {
      return false;
    }
  });
  const cont = page.getByRole('button', { name: /继续/ });
  if (hasSave && (await cont.count()) > 0) {
    await cont.first().click();
    await page.waitForFunction(() => window.__sim?.mode === 'playing', { timeout: 8000 });
    record('00-continue-save', true, { hasSave: true });
  } else {
    await page.getByRole('button', { name: '开始探索', exact: true }).click();
    await page.waitForFunction(() => window.__sim?.mode === 'playing');
    record('00-new-game', true, { hasSave: false, note: 'no prior checkpoint on disk; fresh start' });
  }
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 });
  await page.waitForTimeout(300);

  // 01 map select burst
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map', { timeout: 8000 });
  await page.waitForTimeout(150);
  const burstBtn = page.locator('.map-legend button', { hasText: '爆鸣' });
  if ((await burstBtn.count()) === 0) {
    fail('01-map-burst', { reason: 'no burst legend' });
    throw new Error('no burst map target');
  }
  await burstBtn.click();
  await page.waitForTimeout(80);
  const sel = await page.evaluate(() => window.__sim.trackedObjective()?.targetId);
  if (!record('01-map-burst', sel === 'burst', { sel })) {
    fail('01-map-burst', { sel });
    throw new Error('map select burst failed');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // 02 follow route toward burst door (118, 28+2.8)
  const nav0 = await readTelemetry(page);
  record('02-route-hint', true, { nav: nav0.nav, next: nav0.navNext, guidance: nav0.navGuidance });

  const doorWalk = await walkToward(page, 118, 30.8, { arrive: 4.2, maxDrives: 150, name: 'burst-door' });
  await page.screenshot({ path: resolve(outDir, '02-approach-door.png') });
  if (!record('03-arrive-door', doorWalk.ok, { reason: doorWalk.reason, last: doorWalk.last, tail: doorWalk.samples.slice(-5) })) {
    fail('03-arrive-door', doorWalk);
    writeFileSync(resolve(outDir, 'approach-trace.json'), JSON.stringify(doorWalk.samples, null, 2) + '\n');
    throw new Error('arrive door failed');
  }

  // 03 enter shrine
  await steerToward(page, 118, 28, 16);
  let entered = false;
  for (let i = 0; i < 8; i++) {
    await driveStick(page, -30, 200);
    const t = await tapInteract(page);
    if (t.world === 'shrine' && t.shrine != null) {
      entered = true;
      break;
    }
  }
  const inShrine = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '03-enter.png') });
  if (!record('04-enter-shrine', entered && inShrine.world === 'shrine', { inShrine })) {
    fail('04-enter-shrine', { inShrine, prompt: inShrine.prompt });
    throw new Error('enter shrine failed');
  }

  // 04 before wall: nav should be action-required
  const beforeWall = await readTelemetry(page);
  record('05-before-wall-nav', beforeWall.nav === 'action-required', {
    nav: beforeWall.nav,
    next: beforeWall.navNext,
    guidance: beforeWall.navGuidance,
  });

  // 05 walk to action anchor south of wall (origin z+11.2), place+explode burst art
  // Burst origin for index 1: x=220+48=268, z=0
  const wallWalk = await walkToward(page, 268, 11.2, { arrive: 2.5, maxDrives: 25, name: 'wall' });
  if (!record('06-at-wall-action', wallWalk.ok, { last: wallWalk.last })) {
    fail('06-at-wall-action', wallWalk);
    throw new Error('at wall failed');
  }
  // Face +Z (toward wall) via look keys only
  await steerToward(page, 268, 20, 20);
  // Select art slot 1 (爆鸣) then place + explode
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(80);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(200);
  const afterBoom = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '04-after-boom.png') });
  const wallBroken = afterBoom.cracked?.[1] === true || afterBoom.cracked?.[1] === 1;
  if (!record('07-wall-broken', wallBroken, { afterBoom: { cracked: afterBoom.cracked, nav: afterBoom.nav, prompt: afterBoom.prompt } })) {
    fail('07-wall-broken', { afterBoom, wallWalk });
    throw new Error('wall not broken');
  }

  // 06 route should update toward altar
  const afterRoute = await readTelemetry(page);
  record('08-route-after-wall', afterRoute.nav !== 'action-required' || /祭坛|领取/.test(afterRoute.navNext || ''), {
    nav: afterRoute.nav,
    next: afterRoute.navNext,
    guidance: afterRoute.navGuidance,
  });

  // 07 claim altar at (268, 23) approach
  const altarWalk = await walkToward(page, 268, 20.5, { arrive: 2.0, maxDrives: 30, name: 'altar' });
  let claimed = false;
  for (let i = 0; i < 6 && !claimed; i++) {
    await driveStick(page, -20, 180);
    const t = await tapInteract(page);
    if ((t.orbs ?? 0) >= 1 || (t.shrinesOn || []).includes('burst')) claimed = true;
  }
  const afterClaim = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '05-claim.png') });
  if (!record('09-claim-orb', claimed && afterClaim.orbs >= 1, { afterClaim, altarWalkOk: altarWalk.ok })) {
    fail('09-claim-orb', { afterClaim, altarWalk });
    throw new Error('claim failed');
  }

  // 08 leave: production altar claim calls exitShrine — already overworld.
  // If still inside, walk to exit and interact once (no spam re-enter).
  let afterLeave = await readTelemetry(page);
  let left = afterLeave.world === 'overworld';
  if (!left) {
    const leaveWalk = await walkToward(page, 268, 2.0, { arrive: 2.2, maxDrives: 20, name: 'exit' });
    for (let i = 0; i < 3 && !left; i++) {
      afterLeave = await tapInteract(page);
      if (afterLeave.world === 'overworld') {
        left = true;
        break;
      }
      await driveStick(page, 22, 140);
    }
    afterLeave = await readTelemetry(page);
    left = afterLeave.world === 'overworld';
    record('10a-exit-walk', leaveWalk.ok || left, { leaveWalkOk: leaveWalk.ok });
  }
  await page.screenshot({ path: resolve(outDir, '06-leave.png') });
  if (!record('10-leave-shrine', left && afterLeave.world === 'overworld', { afterLeave, autoExit: afterClaim.world === 'overworld' })) {
    fail('10-leave-shrine', { afterLeave });
    throw new Error('leave failed');
  }

  // 09 save storageState as natural checkpoint for future segments
  try {
    await ctx.storageState({ path: ckptPath });
    record('11-save-checkpoint', true, { path: ckptPath });
  } catch (e) {
    record('11-save-checkpoint', false, { error: e.message });
  }

  // 10 reload persistence
  const beforeReload = await readTelemetry(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  const cont2 = page.getByRole('button', { name: /继续/ });
  if ((await cont2.count()) > 0) await cont2.first().click();
  await page.waitForTimeout(500);
  const afterReload = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '07-reload.png') });
  if (!record('12-reload-burst-orb', (afterReload.shrinesOn || []).includes('burst') && afterReload.orbs >= 1, {
    before: { shrinesOn: beforeReload.shrinesOn, orbs: beforeReload.orbs },
    after: { shrinesOn: afterReload.shrinesOn, orbs: afterReload.orbs, mode: afterReload.mode },
  })) {
    fail('12-reload-burst-orb', { afterReload });
    throw new Error('reload persistence failed');
  }

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    checkpoint: report.checkpoint,
    milestones: report.milestones.map((m) => ({ name: m.name, pass: m.pass })),
    dir: outDir,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  if (!report.failure) report.failure = { milestone: 'exception', message: e.message, stack: e.stack };
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify({
    ok: false,
    failure: report.failure,
    milestones: report.milestones.map((m) => ({ name: m.name, pass: m.pass })),
  }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
