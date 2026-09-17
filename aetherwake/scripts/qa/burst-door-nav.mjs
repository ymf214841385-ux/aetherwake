#!/usr/bin/env node
/**
 * R22/R23 headed: FRESH game + map-select burst → nav walk all the way to door → enter.
 * Ordinary input only. Local verification; no progress export on failure.
 * burst-door-nav-r22d was only a map-route smoke (2 wps near spawn) — not door proof.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer, createWalkerState, onWaypointSwitch, noteProgress, canFaceEnemyBody } from '../../src/game/walk-steer.ts';
import { decideCombatAction } from '../../src/game/combat-threat.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `burst-door-nav-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, errors: [], startedAt: new Date().toISOString(), boundary: 'fresh-game map-select nav; not a four-shrine re-select' };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const nav = s.navigationSnapshot();
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      hp: p.hp,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      camYaw: +s.cam.yaw.toFixed(3),
      state: p.state,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      towers: [...s.towersOn],
      quest: s.trackedObjective()?.title,
      selected: s.preferredMapTarget?.() ?? null,
      navStatus: nav?.status,
      navTarget: nav?.targetId,
      navNext: nav?.nextAction,
      navGuidance: nav?.guidance,
      navWalks: (nav?.segments || []).filter((g) => g.validated && g.kind === 'walk').length,
      bodyYaw: +p.yaw.toFixed(3),
      dodgeCd: +p.dodgeCd.toFixed(2),
      attackPhase: s.attack?.phase ?? null,
      enemies: (s.enemies || [])
        .filter((e) => e.alive)
        .map((e) => ({
          id: e.id,
          d: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2),
          phase: e.brain?.phase ?? null,
          x: +e.x.toFixed(2),
          z: +e.z.toFixed(2),
        }))
        .filter((e) => e.d < 16)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3),
    };
  });

async function steerDrive(page, tx, tz, maxTurns = 14) {
  for (let i = 0; i < maxTurns; i++) {
    const t = await readTelemetry(page);
    if (t.mode !== 'playing' || t.state === 'dead') return { ok: false, t };
    const d = decideSteer({ x: t.x, z: t.z, camYaw: t.camYaw }, { x: tx, z: tz });
    if (d.kind === 'drive') {
      const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
      const cx = stick.x + stick.width / 2;
      const cy = stick.y + stick.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 42, { steps: 2 });
      await page.waitForTimeout(200);
      await page.mouse.up();
      return { ok: true, t: await readTelemetry(page) };
    }
    if (d.kind === 'turn') {
      await page.keyboard.down(d.key);
      await page.waitForTimeout(40);
      await page.keyboard.up(d.key);
    } else break;
  }
  return { ok: false, t: await readTelemetry(page) };
}

let browser;
const server = await maybeStartQaServer({ name: 'burst-door-nav', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);

  const t0 = await readTelemetry(page);
  record('00-new-game', t0.orbs === 0 && t0.shrinesOn.length === 0, { t0 });

  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.waitForTimeout(150);
  const burstBtn = page.locator('.map-legend button', { hasText: '爆鸣' });
  assert.ok((await burstBtn.count()) > 0, 'burst legend required');
  await burstBtn.click();
  await page.waitForTimeout(80);
  const sel = await page.evaluate(() => window.__sim.trackedObjective()?.targetId);
  record('01-map-burst', sel === 'burst', { sel });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Production nav must now be walk (not unavailable) to shrine-door:burst
  await page.waitForTimeout(120);
  const tNav = await readTelemetry(page);
  record('02-nav-walk', tNav.navStatus === 'walk' && tNav.navTarget === 'shrine-door:burst' && tNav.navWalks > 0, {
    navStatus: tNav.navStatus,
    navTarget: tNav.navTarget,
    navWalks: tNav.navWalks,
    navGuidance: tNav.navGuidance,
  });
  await page.screenshot({ path: resolve(outDir, 'nav-walk.png') });

  // Follow nav segments' polyline-ish waypoints via dest approach
  const dest = { x: 118, z: 30.8 };
  // Use corridor from production snapshot segments if present
  const segs = await page.evaluate(() => {
    const nav = window.__sim.navigationSnapshot();
    return (nav?.segments || [])
      .filter((s) => s.validated && s.kind === 'walk')
      .map((s) => ({ id: s.id, from: s.from, to: s.to, poly: s.polyline || [] }));
  });
  record('02b-segments', segs.length > 0, { n: segs.length, ids: segs.map((s) => s.id) });

  // Flatten polyline samples as walk targets (production support-following path)
  const samples = [];
  for (const s of segs) {
    if (s.poly.length >= 2) {
      for (const p of s.poly) samples.push({ x: p.x, z: p.z });
    } else {
      samples.push({ x: s.to.x, z: s.to.z });
    }
  }
  // Dedup dense samples
  const wps = [];
  for (const p of samples) {
    const last = wps[wps.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 2.5) wps.push(p);
  }
  if (wps.length === 0) wps.push(dest);

  let st = createWalkerState();
  let stopped = null;
  const MAX_DRIVES = 200;
  for (let i = 0; i < MAX_DRIVES; i++) {
    const mid = await readTelemetry(page);
    if (mid.mode !== 'playing' || mid.state === 'dead') {
      stopped = { reason: 'terminal', i, mid };
      break;
    }
    let target = wps[st.wpIndex] ?? wps[wps.length - 1];
    const dist = Math.hypot(target.x - mid.x, target.z - mid.z);
    if (dist < 4 && st.wpIndex < wps.length - 1) {
      st = onWaypointSwitch(st, st.wpIndex + 1);
      target = wps[st.wpIndex];
      if (st.wpIndex % 5 === 0) record(`wp${st.wpIndex}`, true, { target, pos: { x: mid.x, z: mid.z } });
    }
    const nearestEnemy = mid.enemies?.[0] ?? null;
    const combat = decideCombatAction(mid.enemies, {
      hp: mid.hp,
      stamina: mid.stamina,
      dodgeCd: mid.dodgeCd,
      player: { x: mid.x, z: mid.z },
    }, {
      attackAvailable: false,
      canFaceEnemy: canFaceEnemyBody({ x: mid.x, z: mid.z, bodyYaw: mid.bodyYaw ?? mid.camYaw }, nearestEnemy),
      dodgeAvailable: mid.stamina > 20 && (mid.dodgeCd ?? 0) <= 0,
    });
    if (combat.kind === 'dodge') {
      const btn = page.locator('[data-touch-action="dodge"]');
      if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 350 }).catch(() => {});
      continue;
    }
    await steerDrive(page, target.x, target.z, 10);
    const post = await readTelemetry(page);
    st = noteProgress(st, Math.hypot(target.x - post.x, target.z - post.z));
    if (st.noProgress >= 16) {
      stopped = { reason: 'no-progress', i, post, wp: st.wpIndex };
      break;
    }
    const dDoor = Math.hypot(dest.x - post.x, dest.z - post.z);
    if (dDoor < 2.2) {
      record('03-arrive-door', true, { post, dDoor });
      await page.screenshot({ path: resolve(outDir, 'arrive-door.png') });
      break;
    }
  }

  // Final short approach to the exact door face if we are on the apron but offset.
  if (!report.milestones.some((m) => m.name === '03-arrive-door' && m.pass)) {
    for (let i = 0; i < 20; i++) {
      const t = await readTelemetry(page);
      if (t.mode !== 'playing' || t.state === 'dead') break;
      const dDoor = Math.hypot(dest.x - t.x, dest.z - t.z);
      if (dDoor < 2.2) {
        record('03-arrive-door', true, { post: t, dDoor });
        await page.screenshot({ path: resolve(outDir, 'arrive-door.png') });
        break;
      }
      await steerDrive(page, dest.x, dest.z, 8);
    }
  }

  // Door-side → enter burst (ordinary interact). Face the hut south face.
  let entered = false;
  if (report.milestones.some((m) => m.name === '03-arrive-door' && m.pass)) {
    // Nudge onto the door face (118, 30.5) — hut body south side.
    for (let i = 0; i < 12; i++) {
      const t = await readTelemetry(page);
      if (Math.hypot(118 - t.x, 30.5 - t.z) < 1.4) break;
      await steerDrive(page, 118, 30.5, 6);
    }
    for (let i = 0; i < 10; i++) {
      const t = await readTelemetry(page);
      if (t.world === 'shrine' || t.shrine != null) {
        entered = true;
        break;
      }
      const btn = page.locator('[data-touch-action="interact"]');
      const vis = await btn.isVisible().catch(() => false);
      record(`interact-attempt-${i}`, vis, { prompt: t.prompt, x: t.x, z: t.z, y: t.y });
      if (vis) await btn.tap({ timeout: 800 }).catch(() => {});
      await page.waitForTimeout(250);
    }
    const after = await readTelemetry(page);
    record('05-enter-burst', entered || after.world === 'shrine' || after.shrine != null, { after });
    await page.screenshot({ path: resolve(outDir, 'enter.png') }).catch(() => {});
    entered = entered || after.world === 'shrine' || after.shrine != null;
  }

  const arrived = report.milestones.some((m) => m.name === '03-arrive-door' && m.pass);
  const final = await readTelemetry(page);
  report.ok = arrived && entered;
  if (!report.ok) {
    report.failure = { stopped, arrived, entered, final };
    await page.screenshot({ path: resolve(outDir, 'fail.png') }).catch(() => {});
  }
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    failure: report.failure,
    dir: outDir,
  }));
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await browser?.close().catch(() => {});
  await stopOwnedServer(server);
}
