#!/usr/bin/env node
/**
 * R14 rime solve from post-rime-attempt checkpoint (already inside shrine).
 * Ice → altar claim → auto-exit → reload persistence.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer } from '../../src/game/walk-steer.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-rime-attempt.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `rime-solve-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, errors: [] };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      hp: p.hp,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      camYaw: +s.cam.yaw.toFixed(3),
      state: p.state,
      art: s.art,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      ices: (s.ices || []).length,
      nav: s.navigationSnapshot()?.status,
      navNext: s.navigationSnapshot()?.nextAction,
      prompt: s.prompt,
    };
  });

async function pressLook(page, key, ms = 45) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function steerUntilDrive(page, target, maxTurns = 40) {
  for (let i = 0; i < maxTurns; i++) {
    const t = await readTelemetry(page);
    if (t.mode !== 'playing') return { ok: false, reason: 'terminal', t };
    const d = decideSteer({ x: t.x, z: t.z, camYaw: t.camYaw }, target);
    if (d.kind === 'drive') return { ok: true, t };
    if (d.kind === 'turn') await pressLook(page, d.key);
    else return { ok: false, reason: d.kind, t };
  }
  return { ok: false, reason: 'timeout', t: await readTelemetry(page) };
}
async function driveOnce(page, ms = 200) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 44, { steps: 3 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return readTelemetry(page);
}
async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if (!(await btn.isVisible().catch(() => false))) return readTelemetry(page);
  await btn.tap({ timeout: 1200 }).catch(() => {});
  await page.waitForTimeout(180);
  return readTelemetry(page);
}

let browser;
const server = await maybeStartQaServer({ name: 'rime-solve', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need post-rime checkpoint');
  const raw = JSON.parse(readFileSync(ckptPath, 'utf8'));
  const remapped = {
    ...raw,
    origins: (raw.origins || []).map((o) => ({ ...o, origin: server.url.replace(/\/$/, '') })),
  };
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, storageState: remapped });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: /继续/ }).first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForTimeout(300);

  const t0 = await readTelemetry(page);
  if (!record('00-in-rime', t0.world === 'shrine' && t0.shrine === 0, { t0 })) {
    // Maybe save stored overworld — try enter if near door
    if (t0.world === 'overworld' && Math.hypot(t0.x - -72, t0.z - 36) < 10) {
      for (let i = 0; i < 5; i++) {
        await driveOnce(page, 160);
        const t = await tapInteract(page);
        if (t.world === 'shrine') {
          record('00-in-rime', true, { t });
          break;
        }
      }
    } else {
      throw new Error(`not in rime: ${JSON.stringify(t0)}`);
    }
  }

  // Rime interior: origin for shrine 0 is (220, 520, 0)
  // Ice action area ~ (224, 520, 10); altar (220, 520, 23)
  const ox = 220, oz = 0;

  // 01 nav before ice
  const nav0 = await readTelemetry(page);
  record('01-nav-before-ice', nav0.nav === 'action-required', { nav: nav0.nav, next: nav0.navNext });

  // 02 walk to ice action point
  for (let i = 0; i < 30; i++) {
    const steer = await steerUntilDrive(page, { x: ox + 4, z: oz + 10 }, 20);
    if (!steer.ok) break;
    const t = await driveOnce(page, 200);
    if (Math.hypot(t.x - (ox + 4), t.z - (oz + 10)) < 3) break;
  }
  await page.screenshot({ path: resolve(outDir, '02-at-ice.png') });

  // 03 select rime art (slot 3) and cast several times to spawn ice
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(80);
  // Face pit (+Z)
  await steerUntilDrive(page, { x: ox, z: oz + 16 }, 20);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(200);
  }
  const afterIce = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '03-ice.png') });
  record('02-ice-spawned', afterIce.ices > 0, { ices: afterIce.ices, nav: afterIce.nav });

  // 04 nav should try walk toward altar if ice connected
  const nav1 = await readTelemetry(page);
  record('03-nav-after-ice', nav1.nav !== 'action-required' || /祭坛|领取|霜柱/.test(nav1.navNext || ''), {
    nav: nav1.nav,
    next: nav1.navNext,
  });

  // 05 walk toward altar approach (220, 520, 20.5)
  let claimed = false;
  for (let i = 0; i < 50; i++) {
    const steer = await steerUntilDrive(page, { x: ox, z: oz + 20.5 }, 16);
    if (!steer.ok) {
      // if terminal break
      const t = await readTelemetry(page);
      if (t.mode !== 'playing') break;
      // keep casting ice if stuck
      await page.keyboard.press('Digit3');
      await page.keyboard.press('KeyF');
      await page.waitForTimeout(150);
      continue;
    }
    await driveOnce(page, 200);
    const t = await readTelemetry(page);
    if (t.orbs >= 2 || t.shrinesOn.includes('rime')) {
      claimed = true;
      break;
    }
    if (Math.hypot(t.x - ox, t.z - (oz + 20.5)) < 2.5) {
      const after = await tapInteract(page);
      if (after.orbs >= 2 || after.shrinesOn.includes('rime')) {
        claimed = true;
        break;
      }
    }
  }
  const afterClaim = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '04-claim.png') });
  if (!record('04-claim-rime', claimed && (afterClaim.shrinesOn.includes('rime') || afterClaim.orbs >= 2), { afterClaim })) {
    report.failure = { milestone: '04-claim-rime', afterClaim };
  }

  // 06 reload persistence
  const beforeReload = await readTelemetry(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  const cont = page.getByRole('button', { name: /继续/ });
  if ((await cont.count()) > 0) await cont.first().click();
  await page.waitForTimeout(400);
  const afterReload = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '05-reload.png') });
  record('05-reload-rime', afterReload.shrinesOn.includes('rime') && afterReload.orbs >= 2, {
    before: { shrinesOn: beforeReload.shrinesOn, orbs: beforeReload.orbs },
    after: { shrinesOn: afterReload.shrinesOn, orbs: afterReload.orbs },
  });

  report.ok = report.milestones.some((m) => m.name === '04-claim-rime' && m.pass) &&
    report.milestones.some((m) => m.name === '05-reload-rime' && m.pass);

  // Export complete checkpoint ONLY on success (claim + reload).
  if (report.ok) {
    const completePath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-rime-complete.storage.json');
    try {
      await ctx.storageState({ path: completePath });
      const { createHash } = await import('node:crypto');
      const { readFileSync } = await import('node:fs');
      const hash = createHash('sha256').update(readFileSync(completePath)).digest('hex');
      const provenance = {
        file: 'post-rime-complete.storage.json',
        sha256: hash,
        sourceRun: process.env.QA_RUN_ID || 'rime-solve',
        sourceCommit: process.env.SOURCE_COMMIT || 'see packed meta',
        progress: {
          shrinesOn: afterReload.shrinesOn,
          orbs: afterReload.orbs,
          towers: afterReload.towers,
        },
        note: 'Natural claim+reload storageState; no progress merge.',
      };
      writeFileSync(completePath.replace('.storage.json', '.meta.json'), JSON.stringify(provenance, null, 2) + '\n');
      record('06-export-complete-ckpt', true, provenance);
    } catch (e) {
      record('06-export-complete-ckpt', false, { error: e.message });
    }
  } else {
    record('06-export-complete-ckpt', false, { reason: 'skip: claim+reload not both true; do not overwrite success archive' });
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
