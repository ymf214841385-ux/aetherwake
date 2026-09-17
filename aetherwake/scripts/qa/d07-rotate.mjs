#!/usr/bin/env node
/**
 * D07 viewport rotation: portrait pause then landscape resume without stuck input.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `d07-rot-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, checks: [] };

let browser;
const server = await maybeStartQaServer({ name: 'd07-rot', kind: 'preview' });
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForTimeout(200);

  // Hold stick then rotate to portrait — input must clear
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  await page.mouse.move(stick.x + stick.width / 2, stick.y + stick.height / 2);
  await page.mouse.down();
  await page.mouse.move(stick.x + stick.width / 2, stick.y + stick.height / 2 - 36, { steps: 3 });
  await page.waitForTimeout(200);
  const moving = await page.evaluate(() => ({ vx: window.__sim.player.vx, vz: window.__sim.player.vz, portrait: window.__sim.portrait }));

  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(300);
  const portrait = await page.evaluate(() => ({
    portrait: window.__sim.portrait,
    mode: window.__sim.mode,
    stickX: window.__touch?.stickX ?? null,
    vx: window.__sim.player.vx,
    vz: window.__sim.player.vz,
  }));
  await page.screenshot({ path: resolve(outDir, 'portrait.png') });
  report.checks.push({ name: 'portrait pause flag', pass: portrait.portrait === true, portrait });

  await page.setViewportSize({ width: 900, height: 500 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  const landscape = await page.evaluate(() => ({
    portrait: window.__sim.portrait,
    mode: window.__sim.mode,
    vx: window.__sim.player.vx,
    vz: window.__sim.player.vz,
  }));
  await page.waitForTimeout(400);
  const settled = await page.evaluate(() => ({
    vx: window.__sim.player.vx,
    vz: window.__sim.player.vz,
    mode: window.__sim.mode,
  }));
  await page.screenshot({ path: resolve(outDir, 'landscape.png') });
  report.checks.push({ name: 'landscape resume no stuck velocity', pass: landscape.portrait === false && Math.hypot(settled.vx, settled.vz) < 0.4, settled, landscape });

  report.ok = report.checks.every((c) => c.pass);
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
