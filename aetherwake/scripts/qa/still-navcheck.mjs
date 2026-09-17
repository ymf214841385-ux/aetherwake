#!/usr/bin/env node
/**
 * R20 still-navcheck: actually walk lip → board center → far shore with real input.
 * Records nav snapshot at each stage (no backtrack). Uses same board geometry as still-solve success.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer } from '../../src/game/walk-steer.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-still-claimed.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `still-navcheck2-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, samples: [], milestones: [], errors: [] };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };

const readState = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const snap = s.navigationSnapshot();
    return {
      world: s.worldKind,
      shrine: s.shrine,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      mode: s.mode,
      state: p.state,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      moveBlock: s.moveBlock
        ? { x: +s.moveBlock.x.toFixed(2), z: +s.moveBlock.z.toFixed(2), frozen: +s.moveBlock.frozen.toFixed(2) }
        : null,
      nav: snap.status,
      guidance: snap.guidance,
      segs: snap.segments.map((g) => ({ id: g.id, v: g.validated, fromZ: +g.from.z.toFixed(1), toZ: +g.to.z.toFixed(1) })),
    };
  });

async function pressLook(page, key, ms = 40) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function driveTo(page, tx, tz, opts = {}) {
  const max = opts.max ?? 24;
  const arrive = opts.arrive ?? 1.6;
  for (let i = 0; i < max; i++) {
    const t = await readState(page);
    if (t.mode !== 'playing' || t.state === 'dead') return t;
    if (t.y < 516) return t; // fell
    const d = decideSteer({ x: t.x, z: t.z, camYaw: await page.evaluate(() => window.__sim.cam.yaw) }, { x: tx, z: tz });
    if (Math.hypot(tx - t.x, tz - t.z) < arrive) return t;
    if (d.kind === 'turn') {
      await pressLook(page, d.key);
      continue;
    }
    if (d.kind === 'drive') {
      const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
      const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 40, { steps: 2 });
      await page.waitForTimeout(140);
      await page.mouse.up();
    } else break;
  }
  return readState(page);
}

let browser;
const server = await maybeStartQaServer({ name: 'still-navcheck2', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath));
  const raw = JSON.parse(readFileSync(ckptPath, 'utf8'));
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

  const t0 = await readState(page);
  record('00-restore', t0.orbs >= 4, { t0 });

  // Re-enter still if outside
  if (t0.world === 'overworld') {
    let lastCam = null;
    for (let i = 0; i < 30; i++) {
      const t = await readState(page);
      const camYaw = await page.evaluate(() => window.__sim.cam.yaw);
      lastCam = camYaw;
      const desired = Math.atan2(-(14 - t.x), -(-75.5 - t.z));
      let err = (desired - camYaw) % (Math.PI * 2);
      if (err > Math.PI) err -= Math.PI * 2;
      if (err < -Math.PI) err += Math.PI * 2;
      const fwdDot = (-Math.sin(camYaw)) * (14 - t.x) + (-Math.cos(camYaw)) * (-75.5 - t.z);
      if (Math.abs(err) > 0.35 && fwdDot < 0.2) {
        const key = err > 0 ? 'ArrowLeft' : 'ArrowRight';
        await pressLook(page, key, 45);
        continue;
      }
      const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
      if (!stick) {
        report.errors.push(`no-stick i=${i}`);
        break;
      }
      const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 44, { steps: 2 });
      await page.waitForTimeout(200);
      await page.mouse.up();
      const btn = page.locator('[data-touch-action="interact"]');
      if (await btn.isVisible().catch(() => false)) {
        await btn.tap({ timeout: 700 }).catch(() => {});
      }
      const t2 = await readState(page);
      if (t2.world === 'shrine') break;
      report.errors.push(`enter${i} cam=${camYaw.toFixed(2)} err=${err.toFixed(2)} x=${t2.x} z=${t2.z}`);
    }
    report.enterDebug = { lastCam, tries: report.errors.length };
  }
  const inside = await readState(page);
  record('01-in-still', inside.world === 'shrine' && inside.shrine === 3, { inside });

  const ox = 364, oz = 0;

  // Safe lip
  await driveTo(page, ox, oz + 8.5, { max: 16, arrive: 2 });
  // Wait align + freeze
  await page.keyboard.press('Digit5');
  for (let i = 0; i < 30; i++) {
    const mb = await page.evaluate(() => ({ x: window.__sim.moveBlock.x, frozen: window.__sim.moveBlock.frozen }));
    if (Math.abs(mb.x - ox) < 1.2) {
      await page.keyboard.press('KeyF');
      await page.waitForTimeout(150);
      break;
    }
    await page.waitForTimeout(100);
  }
  const frozen = await readState(page);
  record('02-freeze-aligned', (frozen.moveBlock?.frozen ?? 0) > 1, { frozen: frozen.moveBlock });

  const boardX = frozen.moveBlock?.x ?? ox;

  // Step onto board front (z≈10.4)
  const onFront = await driveTo(page, boardX, oz + 10.4, { max: 14, arrive: 1.2 });
  await page.screenshot({ path: resolve(outDir, 'board-front.png') });
  report.samples.push({ stage: 'board-front', ...onFront });
  const frontNavOk = !(onFront.segs[0]?.toZ != null && onFront.segs[0].toZ < 8);
  record('03-on-board-nav', onFront.y > 518 && onFront.z > 9 && frontNavOk, { onFront });

  // Cross to back (z≈15.6)
  const onBack = await driveTo(page, boardX, oz + 15.6, { max: 20, arrive: 1.2 });
  await page.screenshot({ path: resolve(outDir, 'board-back.png') });
  report.samples.push({ stage: 'board-back', ...onBack });
  record('04-cross-back', onBack.y > 518 && onBack.z > 14, { onBack });

  // Far shore
  const shore = await driveTo(page, ox, oz + 17.5, { max: 12, arrive: 1.5 });
  await page.screenshot({ path: resolve(outDir, 'far-shore.png') });
  report.samples.push({ stage: 'far-shore', ...shore });
  const shoreForward = shore.segs.every((s) => s.toZ >= 16 || s.toZ > s.fromZ);
  const noFreezeHint = !/凝时/.test(shore.guidance || '');
  record('05-shore-nav', shore.y > 518 && shore.z > 16.5 && shoreForward && noFreezeHint, {
    shore: { z: shore.z, y: shore.y, nav: shore.nav, guidance: shore.guidance, segs: shore.segs },
  });

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    samples: report.samples.map((s) => ({ stage: s.stage, x: s.x, y: s.y, z: s.z, nav: s.nav, segs: s.segs?.slice(0, 2) })),
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
