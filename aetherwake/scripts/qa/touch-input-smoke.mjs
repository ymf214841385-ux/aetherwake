#!/usr/bin/env node
// Headed native browser input checks. No Sim, input, save or resource writes.
// Mouse+touch verifies mixed-pointer ownership, not physical-device multitouch.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const dir = resolve('../docs/rebuild-evidence/runs', process.env.QA_RUN_ID || `root-touch-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const report = { ok: false, scope: 'headed-native-touch-and-mixed-pointer-smoke', checks: [], errors: [],
  limits: ['Chromium emulation, not iOS/Android physical multitouch', 'No full gameplay acceptance in this smoke'] };
const server = await maybeStartQaServer({ name: 'touch-input-smoke', kind: 'preview' });
assert.ok(server.ok, server.error);
let browser, page;
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const context = await browser.newContext({ viewport: { width: 780, height: 420 }, isMobile: true, hasTouch: true });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: '开始探索', exact: true }).tap();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  const read = () => page.evaluate(() => {
    const s = window.__sim, p = s.player;
    return { mode: s.mode, x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz,
      aiming: p.aiming, attack: s.attack.phase, state: p.state, hp: p.hp };
  });
  const record = async name => { const s = await read(); report.checks.push({ name, snapshot: s }); return s; };
  const bow = page.locator('[data-touch-action="bow"]');
  await bow.tap();
  await page.waitForFunction(() => window.__sim.player.aiming);
  await record('native bow tap enables aiming');
  await bow.tap();
  await page.waitForFunction(() => !window.__sim.player.aiming);
  await record('second native bow tap disables aiming');

  const b = await bow.boundingBox(); assert.ok(b);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.locator('[data-touch-action="pause"]').tap();
  await page.waitForFunction(() => window.__sim.mode === 'paused');
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim.mode === 'playing');
  await page.waitForTimeout(120);
  assert.equal((await record('reset rejects unfinished pointer bow click')).aiming, false);

  await bow.focus();
  await page.keyboard.down('Space');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim.mode === 'paused');
  await page.keyboard.up('Space');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim.mode === 'playing');
  await page.waitForTimeout(120);
  assert.equal((await record('reset cancels native held-Space default activation')).aiming, false);

  const st = await page.locator('[data-touch-kind="stick"]').boundingBox(); assert.ok(st);
  const lk = await page.locator('[data-touch-kind="look"]').boundingBox(); assert.ok(lk);
  const sx = st.x + st.width / 2, sy = st.y + st.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy - 40, { steps: 3 });
  await page.waitForTimeout(250);
  const before = await record('mixed-pointer stick held');
  await page.touchscreen.tap(lk.x + lk.width * 0.35, lk.y + lk.height * 0.35);
  await page.waitForTimeout(250);
  const after = await record('look pointer release preserves held stick');
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0.25);
  await page.mouse.up();
  await page.waitForTimeout(800);
  const stopped = await read();
  await page.waitForTimeout(200);
  const still = await record('released stick settles');
  assert.ok(Math.hypot(still.x - stopped.x, still.z - stopped.z) < 0.04);
  assert.equal(report.errors.length, 0);
  report.ok = true;
} catch (e) {
  report.failure = { message: e.message, stack: e.stack };
  process.exitCode = 1;
} finally {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(dir, 'screen.png') }).catch(() => {});
  if (browser) await browser.close();
  report.serverCleanup = await stopOwnedServer(server);
  writeFileSync(resolve(dir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, failure: report.failure?.message, dir }));
}
