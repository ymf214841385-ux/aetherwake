#!/usr/bin/env node
/**
 * R14 focused traversal: burst checkpoint → rime door.
 * Shared walk-steer: turn until facing + forward·target>0 before every drive.
 * Waypoints westward from burst (115,30) — no north backtrack through camp.
 * First HP loss stops diagnosis; then legal combat for survival.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import {
  decideSteer,
  createWalkerState,
  onWaypointSwitch,
  noteProgress,
  noteSteerStep,
} from '../../src/game/walk-steer.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-dawn.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `rime-walk-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = {
  ok: false,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  milestones: [],
  firstDamage: null,
  failure: null,
  ring: [],
  errors: [],
};
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };
const RING = 30;
const pushRing = (s, tag) => {
  report.ring.push({ tag, ...s });
  if (report.ring.length > RING) report.ring.shift();
};

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const enemies = (s.enemies || [])
      .filter((e) => e.alive)
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        x: +e.x.toFixed(2),
        z: +e.z.toFixed(2),
        d: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2),
        phase: e.brain?.phase ?? null,
      }))
      .filter((e) => e.d < 20)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      hp: p.hp,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      vx: +p.vx.toFixed(3),
      vz: +p.vz.toFixed(3),
      camYaw: +s.cam.yaw.toFixed(3),
      state: p.state,
      stamina: +p.stamina.toFixed(1),
      lastDamageWhy: s.lastDamageWhy || '',
      prompt: s.prompt,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      enemies,
      nav: s.navigationSnapshot()?.status,
    };
  });

async function pressLook(page, key, ms = 45) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function steerUntilDrive(page, target, maxTurns = 50) {
  for (let i = 0; i < maxTurns; i++) {
    const t = await readTelemetry(page);
    if (t.mode !== 'playing' || t.state === 'dead' || t.hp <= 0) {
      return { ok: false, reason: 'terminal', sample: t };
    }
    const d = decideSteer({ x: t.x, z: t.z, camYaw: t.camYaw, vx: t.vx, vz: t.vz }, target);
    if (d.kind === 'drive') return { ok: true, err: d.err, dot: d.dot, sample: t };
    if (d.kind === 'turn') await pressLook(page, d.key);
    else return { ok: false, reason: d.kind, sample: t };
  }
  const t = await readTelemetry(page);
  return { ok: false, reason: 'steer-timeout', sample: t };
}

async function driveOnce(page, ms = 200) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 44, { steps: 3 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return readTelemetry(page);
}

async function combatTick(page, enemies) {
  const threat = enemies?.find((e) => e.d < 3.5 && ['windup', 'strike', 'approach', 'recover', 'detect'].includes(e.phase));
  if (!threat) return;
  if (threat.d < 2.6) {
    const atk = page.locator('[data-touch-action="attack"]');
    if (await atk.isVisible().catch(() => false)) {
      await atk.tap({ timeout: 400 }).catch(() => {});
      pushRing(await readTelemetry(page), `atk-${threat.id}`);
    }
  } else {
    const dodge = page.locator('[data-touch-action="dodge"]');
    if (await dodge.isVisible().catch(() => false)) {
      await dodge.tap({ timeout: 400 }).catch(() => {});
      pushRing(await readTelemetry(page), `dodge-${threat.id}`);
    }
  }
}

let browser;
const server = await maybeStartQaServer({ name: 'rime-walk', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need burst checkpoint');
  const raw = JSON.parse(readFileSync(ckptPath, 'utf8'));
  const remapped = {
    ...raw,
    origins: (raw.origins || []).map((o) => ({ ...o, origin: server.url.replace(/\/$/, '') })),
  };
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, storageState: remapped });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  assert.ok(await page.evaluate(() => Boolean(localStorage.getItem('aetherwake-save-v2'))));
  await page.getByRole('button', { name: /继续/ }).first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForTimeout(250);

  const t0 = await readTelemetry(page);
  if (!record('00-restore', t0.shrinesOn.includes('burst') && t0.hp === 3, { t0 })) {
    throw new Error('restore failed');
  }
  pushRing(t0, 'restore');

  // Map rime
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.locator('.map-legend button', { hasText: '霜息' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Westward corridor from burst (~115,30) to rime door (−72,38.8)
  // Avoid northern camp/bramble cluster (~40–55, 45–63).
  const wps = [
    { x: 100, z: 30 },
    { x: 75, z: 31 },
    { x: 50, z: 33 },
    { x: 20, z: 35 },
    { x: -10, z: 36 },
    { x: -40, z: 37 },
    { x: -68, z: 38.5 },
  ];
  let st = createWalkerState();
  let stopped = null;

  for (let i = 0; i < 200; i++) {
    const pre = await readTelemetry(page);
    if (pre.mode !== 'playing' || pre.state === 'dead' || pre.hp <= 0) {
      stopped = { reason: 'terminal', i, pre };
      break;
    }
    if (pre.hp < 3 - 1e-6 && !report.firstDamage) {
      report.firstDamage = { when: `i${i}`, pre, ring: [...report.ring] };
      await page.screenshot({ path: resolve(outDir, 'first-damage.png') });
      // Continue with combat — this is acceptance traversal after diagnosis.
    }

    // Advance waypoint
    let target = wps[st.wpIndex] ?? wps[wps.length - 1];
    let dist = Math.hypot(target.x - pre.x, target.z - pre.z);
    if (dist < 7 && st.wpIndex < wps.length - 1) {
      st = onWaypointSwitch(st, st.wpIndex + 1);
      target = wps[st.wpIndex];
      dist = Math.hypot(target.x - pre.x, target.z - pre.z);
      record(`wp${st.wpIndex}`, true, { target });
    }

    // Combat first (legal), then steer, then drive only if facing ok
    await combatTick(page, pre.enemies);
    const steer = await steerUntilDrive(page, target, 40);
    if (!steer.ok) {
      if (steer.reason === 'terminal') {
        stopped = { reason: 'terminal-steer', i, sample: steer.sample };
        break;
      }
      stopped = { reason: steer.reason, i, sample: steer.sample };
      break;
    }

    const post = await driveOnce(page, 200);
    pushRing(post, `i${i}`);
    st = noteProgress(st, Math.hypot(target.x - post.x, target.z - post.z));
    if (st.noProgress >= 16) {
      stopped = { reason: 'no-progress', i, post, wp: st.wpIndex };
      break;
    }
    if (post.state === 'dead' || post.mode !== 'playing') {
      stopped = { reason: 'dead-after-drive', i, post };
      break;
    }
    if (st.wpIndex >= wps.length - 1 && Math.hypot(-72 - post.x, 38.8 - post.z) < 6) {
      record('01-arrive-rime-door', true, { post });
      break;
    }
  }

  // Enter rime if near
  const near = await readTelemetry(page);
  if (Math.hypot(-72 - near.x, 38.8 - near.z) < 8 && near.world === 'overworld') {
    for (let i = 0; i < 6; i++) {
      const steer = await steerUntilDrive(page, { x: -72, z: 36 }, 20);
      if (!steer.ok) break;
      await driveOnce(page, 180);
      const t = await readTelemetry(page);
      const btn = page.locator('[data-touch-action="interact"]');
      if (await btn.isVisible().catch(() => false)) {
        await btn.tap({ timeout: 800 }).catch(() => {});
      }
      const t2 = await readTelemetry(page);
      if (t2.world === 'shrine') {
        record('02-enter-rime', true, { t2 });
        break;
      }
    }
  }

  const final = await readTelemetry(page);
  report.final = final;
  report.stopped = stopped;
  // Persist legitimate in-shrine state (production save, not synthesized progress).
  if (final.world === 'shrine') {
    await page.evaluate(() => {
      window.__sim.save();
    });
    await page.waitForTimeout(150);
  }
  report.ok = report.milestones.some((m) => m.name === '02-enter-rime' && m.pass) ||
    report.milestones.some((m) => m.name === '01-arrive-rime-door' && m.pass);
  // Persist checkpoint at last milestone
  try {
    await ctx.storageState({ path: resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-rime-attempt.storage.json') });
    record('03-save-checkpoint', true);
  } catch (e) {
    record('03-save-checkpoint', false, { error: e.message });
  }
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    stopped,
    firstDamage: report.firstDamage ? { why: report.firstDamage.pre?.lastDamageWhy, pos: report.firstDamage.pre && { x: report.firstDamage.pre.x, z: report.firstDamage.pre.z } } : null,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    final: { hp: final.hp, world: final.world, shrine: final.shrine, x: final.x, z: final.z, why: final.lastDamageWhy },
    dir: outDir,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  report.failure = e.message;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify({ ok: false, failure: e.message, milestones: report.milestones }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
