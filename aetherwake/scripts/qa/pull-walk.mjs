#!/usr/bin/env node
/**
 * Pull shrine traversal from post-rime checkpoint (burst+rime done).
 * Westward-ish to pull door (36, 10.8), enter, then metal-board solve if reached.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer, createWalkerState, onWaypointSwitch, noteProgress } from '../../src/game/walk-steer.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
// Prefer latest rime solve storage if present; else post-rime-attempt
const ckptA = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-rime-attempt.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `pull-walk-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, ring: [], errors: [] };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const enemies = (s.enemies || []).filter((e) => e.alive).map((e) => ({
      id: e.id, d: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2), phase: e.brain?.phase ?? null,
    })).filter((e) => e.d < 18).sort((a, b) => a.d - b.d).slice(0, 3);
    return {
      mode: s.mode, world: s.worldKind, shrine: s.shrine, hp: p.hp,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      camYaw: +s.cam.yaw.toFixed(3), state: p.state, art: s.art,
      orbs: s.orbs, shrinesOn: [...s.shrinesOn], towers: [...s.towersOn],
      metals: (s.metals || []).length, prompt: s.prompt,
      nav: s.navigationSnapshot()?.status, navNext: s.navigationSnapshot()?.nextAction,
      lastDamageWhy: s.lastDamageWhy || '', enemies,
    };
  });

async function pressLook(page, key, ms = 45) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function steerUntilDrive(page, target, maxTurns = 40) {
  for (let i = 0; i < maxTurns; i++) {
    const t = await readTelemetry(page);
    if (t.mode !== 'playing' || t.state === 'dead') return { ok: false, reason: 'terminal', t };
    const d = decideSteer({ x: t.x, z: t.z, camYaw: t.camYaw }, target);
    if (d.kind === 'drive') return { ok: true, t };
    if (d.kind === 'turn') await pressLook(page, d.key);
    else return { ok: false, reason: d.kind, t };
  }
  return { ok: false, reason: 'timeout', t: await readTelemetry(page) };
}
async function driveOnce(page, ms = 200) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 44, { steps: 3 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return readTelemetry(page);
}
async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if (!(await btn.isVisible().catch(() => false))) return readTelemetry(page);
  await btn.tap({ timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(160);
  return readTelemetry(page);
}
async function combatTick(page, enemies) {
  const threat = enemies?.find((e) => e.d < 3.5 && ['windup', 'strike', 'approach', 'recover', 'detect'].includes(e.phase));
  if (!threat) return;
  if (threat.d < 2.6) {
    const atk = page.locator('[data-touch-action="attack"]');
    if (await atk.isVisible().catch(() => false)) await atk.tap({ timeout: 350 }).catch(() => {});
  } else {
    const dodge = page.locator('[data-touch-action="dodge"]');
    if (await dodge.isVisible().catch(() => false)) await dodge.tap({ timeout: 350 }).catch(() => {});
  }
}

let browser;
const server = await maybeStartQaServer({ name: 'pull-walk', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptA), 'need rime checkpoint');
  const raw = JSON.parse(readFileSync(ckptA, 'utf8'));
  const remapped = { ...raw, origins: (raw.origins || []).map((o) => ({ ...o, origin: server.url.replace(/\/$/, '') })) };
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, storageState: remapped });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: /继续/ }).first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForTimeout(250);

  const t0 = await readTelemetry(page);
  record('00-restore', t0.orbs >= 1, { t0 });

  // If still inside rime, leave first
  if (t0.world === 'shrine') {
    for (let i = 0; i < 8; i++) {
      const t = await tapInteract(page);
      if (t.world === 'overworld') break;
      await driveOnce(page, 150);
    }
  }

  // Map select pull
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.waitForTimeout(100);
  await page.locator('.map-legend button', { hasText: '牵引' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Pull door at (36, 10.8). From rime exit (~-72, 36) go east-south.
  const wps = [
    { x: -40, z: 30 },
    { x: -10, z: 22 },
    { x: 15, z: 14 },
    { x: 32, z: 11 },
  ];
  let st = createWalkerState();
  let stopped = null;
  for (let i = 0; i < 180; i++) {
    const pre = await readTelemetry(page);
    if (pre.mode !== 'playing' || pre.state === 'dead') { stopped = { reason: 'terminal', i, pre }; break; }
    let target = wps[st.wpIndex] ?? wps[wps.length - 1];
    let dist = Math.hypot(target.x - pre.x, target.z - pre.z);
    if (dist < 6 && st.wpIndex < wps.length - 1) {
      st = onWaypointSwitch(st, st.wpIndex + 1);
      target = wps[st.wpIndex];
      record(`wp${st.wpIndex}`, true, { target });
    }
    await combatTick(page, pre.enemies);
    const steer = await steerUntilDrive(page, target, 36);
    if (!steer.ok) { stopped = { reason: steer.reason, i }; break; }
    const post = await driveOnce(page, 190);
    st = noteProgress(st, Math.hypot(target.x - post.x, target.z - post.z));
    if (st.noProgress >= 16) { stopped = { reason: 'no-progress', i, post }; break; }
    if (st.wpIndex >= wps.length - 1 && Math.hypot(36 - post.x, 10.8 - post.z) < 6) {
      record('01-arrive-pull-door', true, { post });
      break;
    }
  }

  // Enter pull
  const near = await readTelemetry(page);
  if (Math.hypot(36 - near.x, 8 - near.z) < 12 && near.world === 'overworld') {
    for (let i = 0; i < 6; i++) {
      const steer = await steerUntilDrive(page, { x: 36, z: 10.5 }, 18);
      if (!steer.ok) break;
      await driveOnce(page, 170);
      const t = await tapInteract(page);
      if (t.world === 'shrine' && t.shrine != null) {
        record('02-enter-pull', true, { t });
        break;
      }
    }
  }

  const final = await readTelemetry(page);
  if (final.world === 'shrine') {
    await page.evaluate(() => window.__sim.save());
    await page.waitForTimeout(120);
  }
  try {
    await ctx.storageState({ path: resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-pull-attempt.storage.json') });
    record('03-checkpoint', true);
  } catch { record('03-checkpoint', false); }

  report.stopped = stopped;
  report.final = final;
  report.ok = report.milestones.some((m) => m.name === '02-enter-pull' && m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    stopped,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    final: { world: final.world, shrine: final.shrine, orbs: final.orbs, shrines: final.shrinesOn, x: final.x, z: final.z, hp: final.hp },
    dir: outDir,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  report.failure = e.message;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
