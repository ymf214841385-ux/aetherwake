#!/usr/bin/env node
/**
 * Rime shrine segment from natural post-burst checkpoint.
 * Remaps storageState origin to current QA server (does not alter save fields).
 * Fails clearly if Continue/save missing — never silent new-game replace.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-dawn.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `rime-seg-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, errors: [] };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };
const fail = (n, d) => { report.failure = { milestone: n, ...d }; record(n, false, d); };

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
      mode: s.mode, world: s.worldKind, shrine: s.shrine,
      x: p.x, y: p.y, z: p.z, camYaw: s.cam.yaw, state: p.state, stamina: p.stamina,
      prompt: s.prompt, orbs: s.orbs, shrinesOn: [...s.shrinesOn], towers: [...s.towersOn],
      nav: s.navigationSnapshot()?.status, navNext: s.navigationSnapshot()?.nextAction,
      ices: s.ices?.length ?? 0,
    };
  });

async function steerToward(page, tx, tz, maxSteps = 24) {
  for (let i = 0; i < maxSteps; i++) {
    const t = await readTelemetry(page);
    const desired = Math.atan2(-(tx - t.x), -(tz - t.z));
    const err = angDiff(desired, t.camYaw);
    if (Math.abs(err) < 0.3) return true;
    const key = err > 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key);
    await page.waitForTimeout(35);
    await page.keyboard.up(key);
  }
  return false;
}
async function driveStick(page, dy = -42, ms = 280) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 3 });
  await page.waitForTimeout(ms);
  const t = await readTelemetry(page);
  await page.mouse.up();
  await page.waitForTimeout(50);
  return t;
}
async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if ((await btn.count()) === 0) return null;
  if (!(await btn.isVisible().catch(() => false))) return readTelemetry(page);
  await btn.tap({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(180);
  return readTelemetry(page);
}

let browser;
const server = await maybeStartQaServer({ name: 'rime-seg', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'checkpoint required');
  const stateRaw = JSON.parse(readFileSync(ckptPath, 'utf8'));
  // Remap origin to current server URL; keep localStorage payloads unchanged.
  const remapped = {
    ...stateRaw,
    origins: (stateRaw.origins || []).map((o) => ({
      ...o,
      origin: server.url.replace(/\/$/, ''),
    })),
  };
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 500 },
    hasTouch: true,
    storageState: remapped,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));

  const hasSave = await page.evaluate(() => Boolean(localStorage.getItem('aetherwake-save-v2')));
  if (!hasSave) {
    fail('00-restore', { reason: 'checkpoint localStorage not present after origin remap', url: server.url });
    throw new Error('no save in remapped checkpoint');
  }
  const cont = page.getByRole('button', { name: /继续/ });
  if ((await cont.count()) === 0) {
    fail('00-restore', { reason: 'no continue button' });
    throw new Error('no continue');
  }
  await cont.first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing', { timeout: 8000 });
  await page.waitForTimeout(300);
  const restored = await readTelemetry(page);
  if (!record('00-continue-checkpoint', restored.shrinesOn.includes('burst') && restored.orbs >= 1, { restored })) {
    fail('00-continue-checkpoint', { restored });
    throw new Error('restore mismatch');
  }

  // Map select rime
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.waitForTimeout(120);
  await page.locator('.map-legend button', { hasText: '霜息' }).click();
  await page.waitForTimeout(80);
  const sel = await page.evaluate(() => window.__sim.trackedObjective()?.targetId);
  if (!record('01-map-rime', sel === 'rime', { sel })) {
    fail('01-map-rime', { sel });
    throw new Error('map rime failed');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Walk to rime door (-72, 38.8) from checkpoint pos (~115,30) — long haul; bound drives.
  let prev = Infinity;
  let arrived = false;
  const samples = [];
  for (let i = 0; i < 100; i++) {
    await steerToward(page, -72, 38.8, 18);
    const t = await driveStick(page, -44, 260);
    const d = Math.hypot(-72 - t.x, 38.8 - t.z);
    samples.push({ i, x: +t.x.toFixed(1), z: +t.z.toFixed(1), d: +d.toFixed(1) });
    if (d < 5) { arrived = true; break; }
    if (d > prev + 0.5) {
      const t2 = await driveStick(page, -44, 240);
      if (Math.hypot(-72 - t2.x, 38.8 - t2.z) > d + 0.3) {
        fail('02-arrive-rime', { reason: 'moving-away', last: t2, samples: samples.slice(-8) });
        writeFileSync(resolve(outDir, 'walk-trace.json'), JSON.stringify(samples, null, 2));
        throw new Error('moving away');
      }
    }
    prev = d;
  }
  const last = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '02-approach-rime.png') });
  if (!record('02-arrive-rime', arrived, { last, tail: samples.slice(-5) })) {
    fail('02-arrive-rime', { last, reason: 'bounded', samples: samples.slice(-5) });
    writeFileSync(resolve(outDir, 'walk-trace.json'), JSON.stringify(samples, null, 2));
    throw new Error('arrive rime failed');
  }

  // Enter rime
  await steerToward(page, -72, 36, 14);
  let entered = false;
  for (let i = 0; i < 6 && !entered; i++) {
    await driveStick(page, -28, 180);
    const t = await tapInteract(page);
    if (t.world === 'shrine' && t.shrine != null) entered = true;
  }
  const inRime = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '03-enter-rime.png') });
  if (!record('03-enter-rime', entered, { inRime })) {
    fail('03-enter-rime', { inRime });
    throw new Error('enter rime failed');
  }

  // Nav before ice
  const nav0 = await readTelemetry(page);
  record('04-nav-before-ice', nav0.nav === 'action-required', { nav: nav0.nav, next: nav0.navNext });

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ name: m.name, pass: m.pass })),
    dir: outDir,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  if (!report.failure) report.failure = { milestone: 'exception', message: e.message };
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify({ ok: false, failure: report.failure, milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
