#!/usr/bin/env node
/**
 * Headed: real map click changes selectedMarkerId + quest target; Walk/Run pose.
 * No direct store writes for selection — uses native clicks on map pins/legend.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `r6-headed-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, checks: [], errors: [] };
let browser;
const server = await maybeStartQaServer({ name: 'r6-headed', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.waitForSelector('canvas');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForTimeout(400);

  // Open map via UI button (not keyboard only).
  await page.locator('.hud-tools button[aria-label="地图"]').click();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.waitForTimeout(200);

  // Click legend button for mere (镜湖塔) — real UI event.
  const mereBtn = page.locator('.map-legend button', { hasText: '镜湖塔' });
  await mereBtn.click();
  await page.waitForTimeout(150);
  const afterClick = await page.evaluate(() => {
    const s = window.__sim;
    const t = s.trackedObjective();
    const nav = s.navigationSnapshot();
    return {
      selected: document.querySelector('.pin.selected') != null || document.querySelector('.map-legend .selected') != null,
      targetId: t.targetId,
      title: t.title,
      navTarget: nav.targetId,
      mode: s.mode,
    };
  });
  report.afterClick = afterClick;
  report.checks.push({ name: 'map click selects mere', pass: afterClick.targetId === 'mere' && /镜湖/.test(afterClick.title) });
  report.checks.push({ name: 'nav follows selection', pass: String(afterClick.navTarget).includes('mere') });
  await page.screenshot({ path: resolve(outDir, 'map-selected-mere.png') });

  // Close map
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing' || window.__sim?.mode === 'paused');
  if (await page.evaluate(() => window.__sim.mode === 'paused')) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__sim?.mode === 'playing');
  }

  // Walk with stick then check anim state; sprint for run
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  if (stick) {
    const cx = stick.x + stick.width / 2;
    const cy = stick.y + stick.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 28, { steps: 3 });
    await page.waitForTimeout(400);
    const walking = await page.evaluate(() => {
      const p = window.__sim.player;
      return { spd: Math.hypot(p.vx, p.vz), yaw: p.yaw, state: p.state };
    });
    report.checks.push({ name: 'stick produces walk speed', pass: walking.spd > 0.3, walking });
    await page.screenshot({ path: resolve(outDir, 'walk.png') });
    // Outer ring sprint
    await page.mouse.move(cx, cy - 48, { steps: 2 });
    await page.waitForTimeout(300);
    const running = await page.evaluate(() => {
      const p = window.__sim.player;
      return { spd: Math.hypot(p.vx, p.vz), sprint: window.__sim.player.stamina < 100 || Math.hypot(p.vx, p.vz) > 3.5 };
    });
    report.checks.push({ name: 'outer stick can reach run speed', pass: running.spd > 2.5, running });
    await page.screenshot({ path: resolve(outDir, 'run.png') });
    await page.mouse.up();
  }

  report.ok = report.checks.every((c) => c.pass) && report.errors.filter((e) => !/pointer lock/i.test(e)).length === 0;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.map((c) => ({ name: c.name, pass: c.pass })), dir: outDir }));
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
