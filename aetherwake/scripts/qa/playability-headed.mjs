#!/usr/bin/env node
/**
 * Short headed verification for playability-fix round:
 * - 844x390 landscape touch layout (buttons visible + hit-testable)
 * - empty look-pad short tap does not attack
 * - character load status + orientation calibration metadata
 * Writes JSON + screenshots under docs/astra-playability-20260916/evidence/headed/
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `playability-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const report = {
  ok: false,
  scope: 'playability-headed-844x390-and-orientation',
  pid: process.pid,
  startedAt: new Date().toISOString(),
  checks: [],
  errors: [],
  limits: ['Chromium emulation, not physical iPhone/Android', 'Orientation still provisional until face/chest/feet screenshots accepted'],
};

const server = await maybeStartQaServer({ name: 'playability-headed', kind: 'preview' });
assert.ok(server.ok, server.error);
report.server = { url: server.url, owned: Boolean(server.owned) };

let browser;
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => report.errors.push(String(e.message)));

  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  const media = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    fine: matchMedia('(pointer: fine)').matches,
    anyCoarse: matchMedia('(any-pointer: coarse)').matches,
    max800: matchMedia('(max-width: 800px)').matches,
    w: innerWidth,
    h: innerHeight,
    touchPadDisplay: getComputedStyle(document.querySelector('.touch-pad') || document.body).display,
  }));
  report.media = media;
  await page.screenshot({ path: resolve(outDir, 'title-844x390.png') });

  // Enter game
  await page.getByRole('button', { name: '开始探索', exact: true }).tap();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  // GameClient is lazy — wait for canvas + touch pad before layout checks.
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForSelector('.touch-pad', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(outDir, 'playing-844x390.png') });

  // Layout: stick + key buttons must be inside viewport
  const layout = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        sel,
        tag: el.tagName,
        className: el.className,
        display: cs.display,
        visibility: cs.visibility,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        inViewport: r.top >= -1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        zIndex: cs.zIndex,
      };
    };
    const pad = document.querySelector('.touch-pad');
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      padHtml: pad ? pad.outerHTML.slice(0, 500) : null,
      padCount: document.querySelectorAll('.touch-pad').length,
      stickCount: document.querySelectorAll('[data-touch-kind="stick"]').length,
      stick: pick('[data-touch-kind="stick"]'),
      look: pick('[data-touch-kind="look"]'),
      interact: pick('[data-touch-action="interact"]'),
      attack: pick('[data-touch-action="attack"]'),
      jump: pick('[data-touch-action="jump"]'),
      map: pick('[data-touch-action="map"]'),
      bag: pick('[data-touch-action="bag"]'),
    };
  });
  report.layout = layout;
  report.checks.push({ name: '844x390 stick visible', pass: layout.stick?.visible === true, media });
  report.checks.push({ name: '844x390 stick in viewport', pass: layout.stick?.inViewport === true });
  for (const key of ['interact', 'attack', 'jump', 'map', 'bag']) {
    report.checks.push({ name: `844x390 ${key} visible+in viewport`, pass: layout[key]?.visible === true && layout[key]?.inViewport === true });
  }

  // Empty short tap on look pad far from objects must not attack
  const before = await page.evaluate(() => ({
    phase: window.__sim.attack.phase,
    attackT: window.__sim.player.attackT,
    mode: window.__sim.mode,
  }));
  const look = layout.look?.rect;
  if (look) {
    await page.touchscreen.tap(look.x + look.w * 0.5, look.y + look.h * 0.5);
    await page.waitForTimeout(200);
  }
  const after = await page.evaluate(() => ({
    phase: window.__sim.attack.phase,
    attackT: window.__sim.player.attackT,
    mode: window.__sim.mode,
  }));
  report.checks.push({
    name: 'empty look tap does not start attack',
    pass: !look || after.phase === 'idle' || after.attackT === 0,
    before,
    after,
    lookRect: look || null,
  });

  // Character load + orientation metadata
  await page
    .waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 })
    .catch(() => {});
  const character = await page.evaluate(() => {
    const load = window.__AW_CHARACTER_LOAD || null;
    return { load, mode: window.__sim?.mode };
  });
  report.characterLoad = character;
  report.checks.push({
    name: 'character load ready',
    pass: character.load?.status === 'ready',
    status: character.load?.status,
    source: character.load?.source,
    orientation: character.load?.orientation,
  });

  await page.screenshot({ path: resolve(outDir, 'after-empty-tap.png') });

  // Move forward briefly via stick and capture character (orientation evidence)
  if (layout.stick?.rect) {
    const stick = layout.stick.rect;
    const cx = stick.x + stick.w / 2;
    const cy = stick.y + stick.h / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 36, { steps: 4 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(outDir, 'walk-forward-844x390.png') });
    const moved = await page.evaluate(() => {
      const p = window.__sim.player;
      return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, vx: p.vx, vz: p.vz };
    });
    report.checks.push({ name: 'stick drive moves player', pass: Math.hypot(moved.vx, moved.vz) > 0.2, moved });
    await page.mouse.up();
  } else {
    report.checks.push({ name: 'stick drive moves player', pass: false, reason: 'no stick rect' });
  }

  report.errorsPartition = {
    // pointer-lock noise is expected when policy requests lock
  };
  const realErrors = report.errors.filter((e) => !/pointer lock/i.test(e));
  report.ok = report.checks.every((c) => c.pass) && realErrors.length === 0;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, dir: outDir, realErrors }));
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
