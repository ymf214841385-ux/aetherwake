#!/usr/bin/env node
/**
 * R17 pull metal mechanism from post-pull-complete (enter-only, orbs2).
 * Digit4 牵引 → F grab → F throw (look*16, vy4) → walk/claim → reload.
 * Side-path claim is labeled separately from metal-bridge success.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer } from '../../src/game/walk-steer.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-pull-complete.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `pull-solve-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, errors: [] };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const metals = (s.metals || [])
      .filter((m) => String(m.id).includes('shrine'))
      .map((m) => ({
        id: m.id,
        x: +m.x.toFixed(2),
        y: +m.y.toFixed(2),
        z: +m.z.toFixed(2),
        vx: +m.vx.toFixed(2),
        vy: +m.vy.toFixed(2),
        vz: +m.vz.toFixed(2),
        held: !!m.held,
        d: +Math.hypot(m.x - p.x, m.z - p.z).toFixed(2),
      }));
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      hp: p.hp,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      camYaw: +s.cam.yaw.toFixed(3),
      bodyYaw: +p.yaw.toFixed(3),
      state: p.state,
      art: s.art,
      heldMetal: s.heldMetal,
      metals,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      towers: [...s.towersOn],
      prompt: s.prompt,
      nav: s.navigationSnapshot()?.status,
      navNext: s.navigationSnapshot()?.nextAction,
      lastDamageWhy: s.lastDamageWhy || '',
    };
  });

async function pressLook(page, key, ms = 45) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function steerUntilDrive(page, target, maxTurns = 30) {
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
async function driveOnce(page, ms = 200) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 42, { steps: 3 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return readTelemetry(page);
}
async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if (!(await btn.isVisible().catch(() => false))) return readTelemetry(page);
  await btn.tap({ timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(180);
  return readTelemetry(page);
}

let browser;
const server = await maybeStartQaServer({ name: 'pull-solve', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need post-pull-complete');
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
  await page.waitForTimeout(300);

  const t0 = await readTelemetry(page);
  record('00-restore', t0.orbs === 2 && t0.shrinesOn.includes('burst') && t0.shrinesOn.includes('rime'), { t0 });

  // If saved at door (overworld), re-enter with normal interact only
  if (t0.world === 'overworld') {
    let entered = false;
    for (let i = 0; i < 8 && !entered; i++) {
      const steer = await steerUntilDrive(page, { x: 36, z: 10.5 }, 16);
      if (steer.ok) await driveOnce(page, 160);
      const t = await tapInteract(page);
      if (t.world === 'shrine') entered = true;
    }
    if (!record('01-reenter-pull', entered, { last: await readTelemetry(page) })) {
      throw new Error('could not re-enter pull');
    }
  } else {
    record('01-in-pull', t0.world === 'shrine' && t0.shrine === 2, { t0 });
  }

  const o = { x: 316, z: 0 }; // pull origin index 2

  // 02 Select 牵引 art (Digit4)
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(80);
  const art = await readTelemetry(page);
  record('02-select-pull-art', art.art === 3, { art: art.art });

  // 03 Walk near metal (spawned at o.x+6.2, o.z+8)
  const metal0 = (await readTelemetry(page)).metals[0];
  if (!record('03-metal-present', Boolean(metal0), { metal0 })) {
    throw new Error('no shrine metal');
  }
  for (let i = 0; i < 16; i++) {
    const steer = await steerUntilDrive(page, { x: o.x + 6.2, z: o.z + 8 }, 14);
    if (steer.ok) await driveOnce(page, 160);
    const t = await readTelemetry(page);
    const m = t.metals[0];
    if (m && m.d < 8) break;
  }
  await page.screenshot({ path: resolve(outDir, '03-near-metal.png') });

  // 04 Grab (first F)
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(200);
  const afterGrab = await readTelemetry(page);
  const held = afterGrab.heldMetal >= 0 && afterGrab.metals.some((m) => m.held);
  record('04-grab-metal', held, { heldMetal: afterGrab.heldMetal, metals: afterGrab.metals });
  if (!held) {
    report.failure = { milestone: '04-grab-metal', afterGrab };
  }

  // 05 Face pit (o.z+13) and throw (second F)
  if (held) {
    await steerUntilDrive(page, { x: o.x, z: o.z + 13 }, 20);
    const beforeThrow = await readTelemetry(page);
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(80);
    const thrown = await readTelemetry(page);
    record('05-throw-metal', thrown.heldMetal < 0 && thrown.metals.some((m) => !m.held), {
      before: beforeThrow.metals,
      after: thrown.metals,
      camYaw: thrown.camYaw,
    });
    await page.waitForTimeout(400);
    const settled = await readTelemetry(page);
    await page.screenshot({ path: resolve(outDir, '05-after-throw.png') });
    record('06-metal-settled', settled.metals.every((m) => !m.held), { metals: settled.metals });
  }

  // 06 Nav after throw
  const nav1 = await readTelemetry(page);
  record('07-nav-after-throw', true, { nav: nav1.nav, next: nav1.navNext, guidance: true });

  // 07 Try walk toward altar; if pit blocks, use side sidewalk (legal alternate)
  let claimed = false;
  let claimPath = null;
  // Try center first
  for (let i = 0; i < 24 && !claimed; i++) {
    const steer = await steerUntilDrive(page, { x: o.x, z: o.z + 20.5 }, 12);
    if (!steer.ok) break;
    await driveOnce(page, 180);
    const t = await readTelemetry(page);
    if (t.y < 510) break; // fell into pit — stop center attempt
    if (Math.hypot(t.x - o.x, t.z - (o.z + 20.5)) < 2.5) {
      const after = await tapInteract(page);
      if (after.orbs >= 3 || after.shrinesOn.includes('pull')) {
        claimed = true;
        claimPath = 'center-or-throw';
      }
    }
  }
  if (!claimed) {
    // Legal explorer rim: stay on +X sidewalk, then +Z, then altar approach.
    // More drives; abort if y drops (pit).
    const waypoints = [
      { x: o.x + 7.15, z: o.z + 6 },
      { x: o.x + 7.15, z: o.z + 12 },
      { x: o.x + 7.15, z: o.z + 18 },
      { x: o.x + 7.15, z: o.z + 22 },
      { x: o.x + 2, z: o.z + 22 },
      { x: o.x, z: o.z + 21 },
    ];
    let wi = 0;
    for (let i = 0; i < 70 && !claimed; i++) {
      const mid = await readTelemetry(page);
      if (mid.mode !== 'playing' || mid.state === 'dead') break;
      if (mid.y < 512) {
        report.fell = mid;
        break;
      }
      const target = waypoints[Math.min(wi, waypoints.length - 1)];
      const dist = Math.hypot(target.x - mid.x, target.z - mid.z);
      if (dist < 1.8 && wi < waypoints.length - 1) {
        wi += 1;
        record(`rim-wp${wi}`, true, { target });
        continue;
      }
      const steer = await steerUntilDrive(page, target, 14);
      if (steer.ok) await driveOnce(page, 170);
      const t = await readTelemetry(page);
      // Claim when close to altar approach
      if (Math.hypot(t.x - o.x, t.z - (o.z + 21)) < 2.8) {
        const after = await tapInteract(page);
        if (after.orbs >= 3 || after.shrinesOn.includes('pull')) {
          claimed = true;
          claimPath = 'sidewalk-alternate';
        }
      }
    }
  }
  const afterClaim = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '06-claim.png') });
  record('08-claim-pull', claimed && afterClaim.orbs >= 3 && afterClaim.shrinesOn.includes('pull'), {
    claimPath,
    afterClaim: { orbs: afterClaim.orbs, shrinesOn: afterClaim.shrinesOn, x: afterClaim.x, y: afterClaim.y, z: afterClaim.z, prompt: afterClaim.prompt },
  });
  report.claimPath = claimPath;
  report.metalBridge = claimPath === 'center-or-throw';
  report.finalPos = { x: afterClaim.x, y: afterClaim.y, z: afterClaim.z, prompt: afterClaim.prompt, world: afterClaim.world };

  // 08 Reload
  const beforeReload = await readTelemetry(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  const cont = page.getByRole('button', { name: /继续/ });
  if ((await cont.count()) > 0) await cont.first().click();
  await page.waitForTimeout(400);
  const afterReload = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, '07-reload.png') });
  record('09-reload-pull', afterReload.shrinesOn.includes('pull') && afterReload.orbs >= 3, {
    before: { shrinesOn: beforeReload.shrinesOn, orbs: beforeReload.orbs },
    after: { shrinesOn: afterReload.shrinesOn, orbs: afterReload.orbs },
  });

  // Export claim-complete only on success
  if (report.milestones.some((m) => m.name === '09-reload-pull' && m.pass)) {
    const ckpt = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-pull-claimed.storage.json');
    try {
      await ctx.storageState({ path: ckpt });
      record('10-export-claimed', true, { path: ckpt, claimPath });
    } catch { record('10-export-claimed', false); }
  } else {
    record('10-export-claimed', false, { reason: 'skip: reload pull not confirmed' });
  }

  report.ok = report.milestones.some((m) => m.name === '09-reload-pull' && m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    claimPath,
    metalBridge: report.metalBridge,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    dir: outDir,
  }));
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  report.failure = { milestone: report.failure?.milestone || 'exception', message: e.message, ...(report.failure || {}) };
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify({ ok: false, failure: report.failure, milestones: report.milestones }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
