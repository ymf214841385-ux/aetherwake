#!/usr/bin/env node
/**
 * Headed layout hit-test: 844x390 and 667x375.
 * Uses elementFromPoint + real taps, not bounds-only.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `layout-hit-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, startedAt: new Date().toISOString(), viewports: [], errors: [] };

const server = await maybeStartQaServer({ name: 'layout-hit', kind: 'preview' });
assert.ok(server.ok, server.error);

async function checkViewport(browser, w, h, name) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.getByRole('button', { name: '开始探索', exact: true }).tap();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForSelector('.touch-pad.is-live', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(outDir, `${name}-playing.png`) });

  const result = await page.evaluate(() => {
    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { sel, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    };
    const hitAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      return {
        tag: el.tagName,
        className: el.className,
        touchAction: el.getAttribute?.('data-touch-action') || el.closest?.('[data-touch-action]')?.getAttribute('data-touch-action') || null,
        isUi: Boolean(el.closest?.('[data-ui]')),
      };
    };
    const overlaps = (a, b) => {
      if (!a || !b) return false;
      return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    };

    const stick = rectOf('[data-touch-kind="stick"]');
    const interact = rectOf('[data-touch-action="interact"]');
    const attack = rectOf('[data-touch-action="attack"]');
    const jump = rectOf('[data-touch-action="jump"]');
    const map = rectOf('[data-touch-action="map"]');
    const minimap = rectOf('.minimap') || rectOf('.minimap-disk');
    const objective = rectOf('.objective');
    const tools = rectOf('.hud-tools');

    return {
      viewport: { w: innerWidth, h: innerHeight },
      stick,
      interact,
      attack,
      jump,
      map,
      minimap,
      objective,
      tools,
      hitStick: stick ? hitAt(stick.cx, stick.cy) : null,
      hitInteract: interact ? hitAt(interact.cx, interact.cy) : null,
      hitAttack: attack ? hitAt(attack.cx, attack.cy) : null,
      hitJump: jump ? hitAt(jump.cx, jump.cy) : null,
      overlapMinimapButtons: overlaps(minimap, interact) || overlaps(minimap, attack) || overlaps(minimap, jump) || overlaps(minimap, map),
      overlapObjectiveTools: overlaps(objective, tools),
      allInViewport: [stick, interact, attack, jump, map].every(
        (r) => r && r.x >= -1 && r.y >= -1 && r.x + r.w <= innerWidth + 1 && r.y + r.h <= innerHeight + 1,
      ),
    };
  });

  // Real taps
  if (result.hitInteract?.touchAction === 'interact') {
    // safe: interact far from targets should not attack
    const phaseBefore = await page.evaluate(() => window.__sim.attack.phase);
    await page.touchscreen.tap(result.interact.cx, result.interact.cy);
    await page.waitForTimeout(150);
    const phaseAfter = await page.evaluate(() => window.__sim.attack.phase);
    result.interactTap = { phaseBefore, phaseAfter, mode: await page.evaluate(() => window.__sim.mode) };
  }
  if (result.hitAttack?.touchAction === 'attack') {
    await page.touchscreen.tap(result.attack.cx, result.attack.cy);
    await page.waitForTimeout(80);
    result.attackTapped = await page.evaluate(() => ({
      phase: window.__sim.attack.phase,
      attackT: window.__sim.player.attackT,
    }));
  }

  const pass =
    result.allInViewport &&
    result.hitStick &&
    result.hitInteract?.touchAction === 'interact' &&
    result.hitAttack?.touchAction === 'attack' &&
    result.hitJump?.touchAction === 'jump' &&
    !result.overlapMinimapButtons &&
    !result.overlapObjectiveTools;

  const entry = { name, w, h, pass, result };
  report.viewports.push(entry);
  await context.close();
  return entry;
}

let browser;
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const a = await checkViewport(browser, 844, 390, '844x390');
  const b = await checkViewport(browser, 667, 375, '667x375');
  report.ok = a.pass && b.pass && report.errors.filter((e) => !/pointer lock/i.test(e)).length === 0;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, a: { pass: a.pass }, b: { pass: b.pass }, dir: outDir, errors: report.errors }));
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
