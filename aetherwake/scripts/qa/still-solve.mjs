#!/usr/bin/env node
/**
 * R17 still shrine from post-pull-claimed (burst+rime+pull, orbs3).
 * Enter still → Digit5 freeze block → walk/claim → reload.
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
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `still-solve-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, errors: [] };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    return {
      mode: s.mode, world: s.worldKind, shrine: s.shrine, hp: p.hp,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      camYaw: +s.cam.yaw.toFixed(3), state: p.state, art: s.art,
      orbs: s.orbs, shrinesOn: [...s.shrinesOn], towers: [...s.towersOn],
      moveBlock: s.moveBlock
        ? { x: +s.moveBlock.x.toFixed(2), z: +s.moveBlock.z.toFixed(2), frozen: +s.moveBlock.frozen.toFixed(2) }
        : null,
      prompt: s.prompt,
      nav: s.navigationSnapshot()?.status,
      navNext: s.navigationSnapshot()?.nextAction,
    };
  });

async function pressLook(page, key, ms = 45) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function steerUntilDrive(page, target, maxTurns = 24) {
  for (let i = 0; i < maxTurns; i++) {
    const t = await readTelemetry(page);
    if (t.mode !== 'playing' || t.state === 'dead') return { ok: false, t };
    const d = decideSteer({ x: t.x, z: t.z, camYaw: t.camYaw }, target);
    if (d.kind === 'drive') return { ok: true, t };
    if (d.kind === 'turn') await pressLook(page, d.key);
    else return { ok: false, t };
  }
  return { ok: false, t: await readTelemetry(page) };
}
async function driveOnce(page, ms = 180) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 40, { steps: 3 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return readTelemetry(page);
}
async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if (!(await btn.isVisible().catch(() => false))) return readTelemetry(page);
  await btn.tap({ timeout: 900 }).catch(() => {});
  await page.waitForTimeout(160);
  return readTelemetry(page);
}

let browser;
const server = await maybeStartQaServer({ name: 'still-solve', kind: 'preview' });
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

  const t0 = await readTelemetry(page);
  record('00-restore', t0.orbs >= 3 && t0.shrinesOn.includes('pull'), { t0 });

  if (t0.world === 'shrine') {
    for (let i = 0; i < 6; i++) {
      const t = await tapInteract(page);
      if (t.world === 'overworld') break;
      await driveOnce(page, 140);
    }
  }

  // Map select still (凝时)
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.locator('.map-legend button', { hasText: '凝时' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Still door at (14, -78+2.8). From pull (~36, 8) go south-west.
  const wps = [
    { x: 30, z: -10 },
    { x: 24, z: -35 },
    { x: 18, z: -60 },
    { x: 14, z: -75 },
  ];
  let wi = 0;
  let arrived = false;
  for (let i = 0; i < 160; i++) {
    const mid = await readTelemetry(page);
    if (mid.mode !== 'playing' || mid.state === 'dead') break;
    let target = wps[wi] ?? wps[wps.length - 1];
    if (Math.hypot(target.x - mid.x, target.z - mid.z) < 6 && wi < wps.length - 1) {
      wi += 1;
      target = wps[wi];
      record(`wp${wi}`, true, { target });
    }
    const steer = await steerUntilDrive(page, target, 16);
    if (steer.ok) await driveOnce(page, 160);
    const after = await readTelemetry(page);
    if (Math.hypot(14 - after.x, -75.2 - after.z) < 6) {
      arrived = true;
      break;
    }
  }
  const near = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '01-near-still.png') });
  record('01-arrive-still', arrived || Math.hypot(14 - near.x, -75 - near.z) < 10, { near });

  // Enter still
  let entered = false;
  for (let i = 0; i < 20 && !entered; i++) {
    const steer = await steerUntilDrive(page, { x: 14, z: -75.5 }, 12);
    if (steer.ok) await driveOnce(page, 150);
    const t = await tapInteract(page);
    if (t.world === 'shrine' && t.shrine === 3) entered = true;
    // If still far, keep approaching
    if (Math.hypot(14 - t.x, -75.2 - t.z) > 12) {
      await driveOnce(page, 180);
    }
  }
  const inStill = await readTelemetry(page);
  record('02-enter-still', entered, { inStill });
  if (!entered) {
    report.failure = { milestone: '02-enter-still', inStill };
  }

  // Still origin index 3: x=220+144=364
  // Board: w=3.2, d=7, zOff=13. Safe lip z<10. Stay on board center until z>16.5.
  const ox = 364, oz = 0;
  if (entered) {
    // 1) Go to safe lip south of pit
    for (let i = 0; i < 12; i++) {
      const steer = await steerUntilDrive(page, { x: ox, z: oz + 8.5 }, 12);
      if (steer.ok) await driveOnce(page, 170);
      const t = await readTelemetry(page);
      if (Math.hypot(t.x - ox, t.z - (oz + 8.5)) < 1.8) break;
    }
    await page.screenshot({ path: resolve(outDir, '02a-lip.png') });

    // 2) Select 凝时 and wait until block X aligns with lane (|dx| < 1.2)
    await page.keyboard.press('Digit5');
    await page.waitForTimeout(80);
    let aligned = null;
    for (let i = 0; i < 40; i++) {
      const t = await readTelemetry(page);
      const mb = t.moveBlock;
      if (!mb) break;
      const dx = mb.x - ox;
      if (Math.abs(dx) < 1.2) {
        aligned = mb;
        // Freeze immediately
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(150);
        break;
      }
      await page.waitForTimeout(120);
    }
    const frozen = await readTelemetry(page);
    record('03-freeze-aligned', (frozen.moveBlock?.frozen ?? 0) > 1, {
      aligned,
      frozen: frozen.moveBlock,
      player: { x: frozen.x, z: frozen.z },
    });
    await page.screenshot({ path: resolve(outDir, '02-freeze.png') });

    // 3) Walk board: stay on block center X, front → back only
    const mb = (await readTelemetry(page)).moveBlock;
    if (mb && mb.frozen > 0.3) {
      const boardX = mb.x;
      const frontZ = mb.z - 2.6; // halfD 3.5 - margin
      const backZ = mb.z + 2.6;
      // Step onto front
      for (let i = 0; i < 10; i++) {
        const t = await readTelemetry(page);
        if (t.y < 516) break;
        const steer = await steerUntilDrive(page, { x: boardX, z: frontZ }, 10);
        if (steer.ok) await driveOnce(page, 140);
        if (Math.hypot(t.x - boardX, t.z - frontZ) < 1.2) break;
      }
      // Across board to far shore (z > 16.5) before any altar turn
      for (let i = 0; i < 24; i++) {
        const t = await readTelemetry(page);
        if (t.y < 516) {
          report.fell = t;
          break;
        }
        // Re-freeze while still over pit if needed
        if (t.z < 16.5 && (t.moveBlock?.frozen ?? 0) < 0.6) {
          await steerUntilDrive(page, { x: boardX, z: oz + 13 }, 8);
          await page.keyboard.press('KeyF');
          await page.waitForTimeout(100);
        }
        const steer = await steerUntilDrive(page, { x: boardX, z: oz + 17.5 }, 8);
        if (steer.ok) await driveOnce(page, 130);
        const t2 = await readTelemetry(page);
        if (t2.z > 16.8 && t2.y > 518) break;
      }
      const afterBoard = await readTelemetry(page);
      record('04-cross-board', afterBoard.y > 518 && afterBoard.z > 16.5, {
        afterBoard: { x: afterBoard.x, y: afterBoard.y, z: afterBoard.z, frozen: afterBoard.moveBlock },
      });

      // 4) Only now turn toward altar
      let claimed = false;
      if (afterBoard.y > 518 && afterBoard.z > 16) {
        for (let i = 0; i < 20 && !claimed; i++) {
          // Re-freeze if still on board and expired
          const mid = await readTelemetry(page);
          if (Math.abs(mid.z - (oz + 13)) < 4 && (mid.moveBlock?.frozen ?? 0) < 0.6) {
            await page.keyboard.press('KeyF');
            await page.waitForTimeout(100);
          }
          const steer = await steerUntilDrive(page, { x: ox, z: oz + 21 }, 10);
          if (steer.ok) await driveOnce(page, 150);
          const t = await readTelemetry(page);
          if (Math.hypot(t.x - ox, t.z - (oz + 21)) < 2.5) {
            const after = await tapInteract(page);
            if (after.orbs >= 4 || after.shrinesOn.includes('still')) claimed = true;
          }
        }
      }
      const afterClaim = await readTelemetry(page);
      await page.screenshot({ path: resolve(outDir, '03-claim.png') });
      record('05-claim-still', claimed && afterClaim.orbs >= 4 && afterClaim.shrinesOn.includes('still'), {
        afterClaim: { orbs: afterClaim.orbs, shrinesOn: afterClaim.shrinesOn, x: afterClaim.x, y: afterClaim.y, z: afterClaim.z },
      });
    }
  }

  // Reload
  const beforeReload = await readTelemetry(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  const cont = page.getByRole('button', { name: /继续/ });
  if ((await cont.count()) > 0) await cont.first().click();
  await page.waitForTimeout(400);
  const afterReload = await readTelemetry(page);
  record('06-reload-still', afterReload.shrinesOn.includes('still') && afterReload.orbs >= 4, {
    before: { shrinesOn: beforeReload.shrinesOn, orbs: beforeReload.orbs },
    after: { shrinesOn: afterReload.shrinesOn, orbs: afterReload.orbs },
  });

  report.ok = report.milestones.some((m) => m.name === '06-reload-still' && m.pass);
  if (report.ok) {
    const ckpt = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-still-claimed.storage.json');
    try {
      await ctx.storageState({ path: ckpt });
      record('07-export-still', true, { path: ckpt });
    } catch { record('07-export-still', false); }
  }
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    dir: outDir,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  report.failure = { milestone: 'exception', message: e.message };
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
