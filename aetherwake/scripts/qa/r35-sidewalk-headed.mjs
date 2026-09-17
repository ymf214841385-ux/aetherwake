#!/usr/bin/env node
/**
 * R35 headed: entry → +X sidewalk → far shore → altar with natural pull save.
 * Ordinary input only. No plate throwing. Readonly nav telemetry.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer } from '../../src/game/walk-steer.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-pull-claimed.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `r35-sidewalk-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], errors: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };

const O = { x: 316, z: 0 };

const readTel = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const nav = s.navigationSnapshot();
    const plate = (s.metals || []).find((m) => m.id.startsWith('metal-shrine'));
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      state: p.state,
      hp: p.hp,
      plate: plate ? { id: plate.id, x: +plate.x.toFixed(2), z: +plate.z.toFixed(2), held: plate.held } : null,
      nav: nav?.status,
      navNext: nav?.nextAction,
      navGuidance: nav?.guidance,
      navSegs: (nav?.segments || []).map((sg) => ({
        id: sg.id,
        ok: sg.validated,
        to: { x: +sg.to.x.toFixed(2), z: +sg.to.z.toFixed(2) },
        polyN: sg.polyline?.length ?? 0,
      })),
    };
  });

async function continueGame(page) {
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: /继续/ }).first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 }).catch(() => {});
  await page.locator('canvas').focus().catch(() => {});
  await page.waitForTimeout(300);
}

async function steerUntilDrive(page, target, maxTurns = 16) {
  for (let i = 0; i < maxTurns; i++) {
    const t = await readTel(page);
    if (t.mode !== 'playing' || t.state === 'dead') return { ok: false, t };
    const d = decideSteer({ x: t.x, z: t.z, camYaw: t.camYaw }, target);
    if (d.kind === 'drive') return { ok: true, t };
    if (d.kind === 'turn') {
      await page.keyboard.down(d.key);
      await page.waitForTimeout(40);
      await page.keyboard.up(d.key);
    } else break;
  }
  return { ok: false, t: await readTel(page) };
}

async function driveOnce(page, ms = 160) {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(ms);
  await page.keyboard.up('KeyW');
  return readTel(page);
}

async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 600 }).catch(() => {});
  else await page.keyboard.press('KeyE');
  await page.waitForTimeout(220);
  return readTel(page);
}

async function walkTo(page, target, arrive = 1.8, maxSteps = 50) {
  for (let i = 0; i < maxSteps; i++) {
    const t = await readTel(page);
    if (t.mode !== 'playing' || t.state === 'dead') return t;
    const dist = Math.hypot(t.x - target.x, t.z - target.z);
    if (dist < arrive) return t;
    // Turn-only until roughly facing, then short drive.
    let turned = false;
    for (let k = 0; k < 24; k++) {
      const s = await readTel(page);
      const d = decideSteer({ x: s.x, z: s.z, camYaw: s.camYaw }, target);
      if (d.kind === 'drive') break;
      if (d.kind === 'turn') {
        await page.keyboard.down(d.key);
        await page.waitForTimeout(45);
        await page.keyboard.up(d.key);
        turned = true;
      } else break;
    }
    await driveOnce(page, turned ? 180 : 140);
  }
  return readTel(page);
}

let browser;
const server = await maybeStartQaServer({ name: 'r35-sidewalk', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const raw = JSON.parse(readFileSync(ckptPath, 'utf8'));
  const state = { ...raw, origins: (raw.origins || []).map((o) => ({ ...o, origin: server.url.replace(/\/$/, '') })) };
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, storageState: state });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await continueGame(page);

  // Enter pull
  let entered = false;
  const t0 = await readTel(page);
  if (t0.world === 'shrine' && t0.shrine === 2) entered = true;
  else {
    for (let i = 0; i < 16 && !entered; i++) {
      const steer = await steerUntilDrive(page, { x: 36, z: 10.5 }, 12);
      if (steer.ok) await driveOnce(page, 150);
      const t = await tapInteract(page);
      if (t.world === 'shrine' && t.shrine === 2) entered = true;
    }
  }
  const inPull = await readTel(page);
  record('enter-pull', entered, { x: inPull.x, y: inPull.y, z: inPull.z, plate: inPull.plate, mode: inPull.mode });
  if (!entered) throw new Error('could not enter pull');
  // After shrine enter, re-focus canvas and let interactLock clear.
  await page.waitForTimeout(500);
  await page.locator('canvas').focus().catch(() => {});
  await page.waitForTimeout(200);
  // Face roughly +X (sidewalk) with a short look burst — cam starts at door.
  for (let i = 0; i < 18; i++) {
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(40);
    await page.keyboard.up('ArrowLeft');
  }

  const navAtEntry = await readTel(page);
  record('nav-at-entry', navAtEntry.nav === 'walk' && navAtEntry.navSegs.every((s) => s.ok), {
    nav: navAtEntry.nav, next: navAtEntry.navNext, guidance: navAtEntry.navGuidance, segs: navAtEntry.navSegs,
  });

  // Walk production sidewalk: entry → rim x+7.15 → far shore → altar
  const rim = { x: O.x + 7.15, z: O.z + 8 };
  const rimFar = { x: O.x + 7.15, z: O.z + 17.5 };
  const altar = { x: O.x, z: O.z + 20.5 };

  const atRim = await walkTo(page, rim, 2.0, 60);
  await page.screenshot({ path: resolve(outDir, '01-rim.png') });
  const rimD = Math.hypot(atRim.x - rim.x, atRim.z - rim.z);
  record('walk-rim', rimD < 3 && atRim.y > 518, {
    x: atRim.x, y: atRim.y, z: atRim.z, rimD: +rimD.toFixed(2), mode: atRim.mode,
  });

  const atFar = await walkTo(page, rimFar, 2.0, 40);
  await page.screenshot({ path: resolve(outDir, '02-far-shore.png') });
  record('walk-far-shore', Math.hypot(atFar.x - rimFar.x, atFar.z - rimFar.z) < 3 && atFar.z > O.z + 16 && atFar.y > 518, {
    x: atFar.x, y: atFar.y, z: atFar.z,
  });

  const atAltar = await walkTo(page, altar, 2.5, 40);
  await page.screenshot({ path: resolve(outDir, '03-altar.png') });
  const dAltar = Math.hypot(atAltar.x - altar.x, atAltar.z - altar.z);
  record('walk-altar', dAltar < 3.5 && atAltar.y > 518 && atAltar.state !== 'dead', {
    x: atAltar.x, y: atAltar.y, z: atAltar.z, dAltar: +dAltar.toFixed(2),
  });

  // Never fell into pit (y stayed near floor 520)
  const neverFell = atRim.y > 518 && atFar.y > 518 && atAltar.y > 518;
  record('never-fell-into-pit', neverFell, {
    rimY: atRim.y, farY: atFar.y, altarY: atAltar.y,
  });

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    dir: outDir,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  report.failure = String(e && e.stack || e);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await stopOwnedServer(server);
}
