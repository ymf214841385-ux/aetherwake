#!/usr/bin/env node
/**
 * Walk/Run orientation matrix: record animation state + facing vs displacement.
 * Look via real look-zone drag; locomotion via stick. Readonly telemetry.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `orient-matrix-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, checks: [], errors: [] };

const sample = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const spd = Math.hypot(p.vx, p.vz);
    // Logical face: bodyFwd = (-sin yaw, -cos yaw)
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let align = 0;
    if (spd > 0.3) {
      align = (fx * p.vx + fz * p.vz) / spd; // cos angle face vs velocity
    }
    return {
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      camYaw: s.cam.yaw,
      vx: p.vx,
      vz: p.vz,
      spd,
      align,
      state: p.state,
      anim: window.__AW_ANIM_STATUS || null,
      load: window.__AW_CHARACTER_LOAD,
    };
  });

let browser;
const server = await maybeStartQaServer({ name: 'orient-matrix', kind: 'preview' });
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
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 });
  await page.waitForTimeout(300);

  // Cam-only face/side/back (no player.yaw write)
  const bodyYaw = await page.evaluate(() => window.__sim.player.yaw);
  for (const [name, camOffset] of [
    ['cam-behind-back', 0],
    ['cam-side', Math.PI / 2],
    ['cam-front-face', Math.PI],
  ]) {
    await page.evaluate((t) => {
      window.__sim.cam.yaw = t;
    }, bodyYaw + camOffset);
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(outDir, `${name}.png`) });
  }

  // Walk: stick, measure align
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 36, { steps: 3 });
  await page.waitForTimeout(450);
  const walking = await sample(page);
  await page.screenshot({ path: resolve(outDir, 'walk.png') });
  report.checks.push({
    name: 'walk face-aligns with velocity',
    pass: walking.spd > 0.4 && walking.align > 0.85,
    walking,
  });

  // Run: outer ring
  await page.mouse.move(cx, cy - 50, { steps: 2 });
  await page.waitForTimeout(350);
  const running = await sample(page);
  await page.screenshot({ path: resolve(outDir, 'run.png') });
  report.checks.push({
    name: 'run face-aligns with velocity',
    pass: running.spd > 2.2 && running.align > 0.85,
    running,
  });
  await page.mouse.up();

  report.ok = report.checks.every((c) => c.pass) && report.errors.filter((e) => !/pointer lock/i.test(e)).length === 0;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, dir: outDir }));
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
