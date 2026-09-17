#!/usr/bin/env node
/**
 * Headed orientation matrix: face / side / back at Idle after walking.
 * Uses normal stick input only (no coordinate writes).
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `orient-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, startedAt: new Date().toISOString(), shots: [], errors: [] };

let browser;
const server = await maybeStartQaServer({ name: 'orient-matrix', kind: 'preview' });
assert.ok(server.ok, server.error);

try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const context = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.waitForSelector('canvas');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 });
  await page.waitForTimeout(400);

  const camYaw = async (target) => {
    // Only rotate the camera — keep player yaw fixed so face vs back is visible.
    await page.evaluate((t) => {
      window.__sim.cam.yaw = t;
    }, target);
    await page.waitForTimeout(250);
  };

  // body faces -Z at yaw=0 (with asset π calibration). Camera at bodyYaw sits
  // behind (sees back); camera at bodyYaw+π sits in front (sees face).
  const base = await page.evaluate(() => window.__sim.player.yaw);

  await camYaw(base);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, 'yaw0-camera-behind.png') });
  report.shots.push({ name: 'yaw0-camera-behind', bodyYaw: base, camYaw: base });

  await camYaw(base + Math.PI / 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, 'side.png') });
  report.shots.push({ name: 'side', camYaw: base + Math.PI / 2 });

  await camYaw(base + Math.PI);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, 'face.png') });
  report.shots.push({ name: 'face', camYaw: base + Math.PI });

  // Walk forward briefly then capture walk pose
  await camYaw(base);
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  if (stick) {
    const cx = stick.x + stick.width / 2;
    const cy = stick.y + stick.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 40, { steps: 3 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(outDir, 'walk-rear.png') });
    report.shots.push({ name: 'walk-rear' });
    await page.mouse.up();
  }

  const load = await page.evaluate(() => window.__AW_CHARACTER_LOAD);
  report.characterLoad = load;
  report.ok = report.shots.length >= 3 && load?.status === 'ready';
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, shots: report.shots, dir: outDir }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  report.failure = { message: e.message, stack: e.stack };
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
