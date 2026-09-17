#!/usr/bin/env node
/**
 * R37 headed: live remaining polyline walk (not nav0/hardcoded).
 * Far shore requires z>16.5. Then altar + ordinary interact.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { worldToStickOffset } from '../../src/game/walk-steer.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-pull-claimed.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `r37-live-poly-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], errors: [], trace: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };

const readTel = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const nav = s.navigationSnapshot();
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      camYaw: +s.cam.yaw.toFixed(3),
      state: p.state,
      vx: +p.vx.toFixed(3),
      vz: +p.vz.toFixed(3),
      hp: p.hp,
      nav: nav?.status,
      navNext: nav?.nextAction,
      navGuidance: nav?.guidance,
      prompt: s.prompt,
      shrinesOn: [...s.shrinesOn],
      orbs: s.orbs,
      navSegs: (nav?.segments || []).map((sg) => ({
        id: sg.id,
        ok: sg.validated,
        from: { x: +sg.from.x.toFixed(3), z: +sg.from.z.toFixed(3) },
        to: { x: +sg.to.x.toFixed(3), z: +sg.to.z.toFixed(3) },
        poly: (sg.polyline || []).map((q) => ({ x: +q.x.toFixed(3), y: +q.y.toFixed(3), z: +q.z.toFixed(3) })),
      })),
    };
  });

async function continueGame(page) {
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: /继续/ }).first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 }).catch(() => {});
  await page.locator('canvas').focus().catch(() => {});
  await page.waitForTimeout(350);
}

async function touchDrag(cdp, x0, y0, dx, dy, ms = 200) {
  const id = 7;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x0, y: y0, id, radiusX: 8, radiusY: 8, force: 1 }],
  });
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps, id, radiusX: 8, radiusY: 8, force: 1 }],
    });
    await new Promise((r) => setTimeout(r, Math.max(16, Math.floor(ms / steps))));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function stickToward(page, cdp, target, ms = 180) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  if (!stick) return null;
  const t = await readTel(page);
  const off = worldToStickOffset({ x: target.x - t.x, z: target.z - t.z }, t.camYaw, 42);
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await touchDrag(cdp, cx, cy, off.dx, off.dy, ms);
  return off;
}

/** Next remaining polyline sample ahead of the player (live nav, not nav0). */
function nextRemainingPoint(tel, minAhead = 1.0) {
  for (const sg of tel.navSegs) {
    if (!sg.ok) continue;
    const poly = sg.poly.length >= 2 ? sg.poly : [sg.to];
    for (const p of poly) {
      const dz = p.z - tel.z;
      const d = Math.hypot(p.x - tel.x, p.z - tel.z);
      // Prefer forward along +Z sidewalk; skip samples clearly behind.
      if (d >= minAhead && dz > -0.6) return p;
    }
  }
  return null;
}

async function tapInteract(page) {
  const btn = page.locator('[data-touch-action="interact"]');
  if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 600 }).catch(() => {});
  else await page.keyboard.press('KeyE');
  await page.waitForTimeout(250);
  return readTel(page);
}

let browser;
const server = await maybeStartQaServer({ name: 'r37-live-poly', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const raw = JSON.parse(readFileSync(ckptPath, 'utf8'));
  const state = { ...raw, origins: (raw.origins || []).map((o) => ({ ...o, origin: server.url.replace(/\/$/, '') })) };
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, isMobile: true, storageState: state });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  const cdp = await ctx.newCDPSession(page);
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await continueGame(page);

  // Enter pull
  let entered = false;
  const t0 = await readTel(page);
  if (t0.world === 'shrine' && t0.shrine === 2) entered = true;
  else {
    for (let i = 0; i < 14 && !entered; i++) {
      await stickToward(page, cdp, { x: 36, z: 10.5 }, 180);
      const t = await tapInteract(page);
      if (t.world === 'shrine' && t.shrine === 2) entered = true;
    }
  }
  await page.waitForTimeout(400);
  await page.locator('canvas').focus().catch(() => {});
  const inPull = await readTel(page);
  record('enter-pull', entered && inPull.world === 'shrine', {
    x: inPull.x, y: inPull.y, z: inPull.z, nav: inPull.nav, next: inPull.navNext,
  });
  if (!entered) throw new Error('enter pull failed');

  const O = { x: 316, z: 0 };

  // Walk using LIVE remaining polyline each step until far shore z>o.z+16.5
  let sawBacktrack = null;
  let farShore = null;
  for (let i = 0; i < 120; i++) {
    const t = await readTel(page);
    if (t.mode !== 'playing' || t.state === 'dead') break;
    if (t.z > O.z + 16.5) {
      farShore = { x: t.x, y: t.y, z: t.z, i };
      break;
    }
    const wp = nextRemainingPoint(t, 1.0);
    if (!wp) {
      // no remaining sample ahead — stop and record
      report.trace.push({ i, x: t.x, z: t.z, nav: t.nav, segs: t.navSegs.map((s) => ({ id: s.id, to: s.to })) });
      break;
    }
    // Backtrack detector: next point far behind current z while we are on the rim
    if (wp.z < t.z - 1.2) {
      sawBacktrack = { i, here: { x: t.x, z: t.z }, next: wp, nav: t.nav, segs: t.navSegs };
      break;
    }
    report.trace.push({ i, x: t.x, z: t.z, wp, nav: t.nav });
    await stickToward(page, cdp, wp, 160);
    await page.waitForTimeout(25);
  }
  await page.screenshot({ path: resolve(outDir, '01-far-shore.png') });
  const afterFar = await readTel(page);
  record('no-backtrack-on-rim', sawBacktrack === null, { sawBacktrack });
  record('live-far-shore', Boolean(farShore) && afterFar.z > O.z + 16.5 && afterFar.y > 518 && afterFar.state === 'grounded', {
    farShore,
    after: { x: afterFar.x, y: afterFar.y, z: afterFar.z, nav: afterFar.nav, next: afterFar.navNext },
  });

  // From far shore, follow remaining polyline to altar approach
  for (let i = 0; i < 80; i++) {
    const t = await readTel(page);
    if (t.mode !== 'playing' || t.state === 'dead') break;
    if (Math.hypot(t.x - O.x, t.z - (O.z + 20.5)) < 2.8) break;
    const wp = nextRemainingPoint(t, 1.0) ?? { x: O.x, z: O.z + 20.5 };
    if (wp.z < t.z - 1.5 && t.z > O.z + 16) {
      // after far shore only allow altarward (-x toward center or +z)
      if (Math.abs(wp.x - O.x) > Math.abs(t.x - O.x) && wp.z <= t.z) {
        report.trace.push({ i, rejectedBack: wp, here: { x: t.x, z: t.z } });
        break;
      }
    }
    report.trace.push({ i, x: t.x, z: t.z, wp });
    await stickToward(page, cdp, wp, 160);
    await page.waitForTimeout(25);
  }
  await page.screenshot({ path: resolve(outDir, '02-altar.png') });
  const atAltar = await readTel(page);
  const dAltar = Math.hypot(atAltar.x - O.x, atAltar.z - (O.z + 20.5));
  record('walk-altar-approach', dAltar < 3.5 && atAltar.y > 518 && atAltar.state !== 'dead', {
    x: atAltar.x, y: atAltar.y, z: atAltar.z, dAltar: +dAltar.toFixed(2), prompt: atAltar.prompt,
  });

  // Ordinary interact at altar. R38: preexisting pull claim must NOT count
  // as a new interaction. Record before/after and in-range prompt.
  const beforeClaim = await readTel(page);
  const alreadyClaimed = beforeClaim.shrinesOn.includes('pull');
  let claimedNow = false;
  let explicitAlready = false;
  for (let i = 0; i < 8; i++) {
    const t = await readTel(page);
    if (!alreadyClaimed && (t.shrinesOn.includes('pull') || t.orbs > beforeClaim.orbs)) {
      claimedNow = true;
      break;
    }
    await tapInteract(page);
    await page.waitForTimeout(200);
    const t2 = await readTel(page);
    if (/已领取|已经|离开/.test(t2.prompt || '')) {
      explicitAlready = true;
      break;
    }
    if (!alreadyClaimed && t2.shrinesOn.includes('pull')) {
      claimedNow = true;
      break;
    }
  }
  const afterClaim = await readTel(page);
  const dAltarAfter = Math.hypot(afterClaim.x - O.x, afterClaim.z - (O.z + 20.5));
  await page.screenshot({ path: resolve(outDir, '03-claim.png') });
  // Pass only for a genuine new claim while in interact range, or an explicit
  // already-claimed response while in range. Preexisting shrinesOn alone fails.
  const inRange = dAltarAfter < 2.6 || /领取|离开/.test(afterClaim.prompt || '');
  const supported =
    (claimedNow && !alreadyClaimed && inRange) ||
    (explicitAlready && inRange);
  record('altar-interact-reachable', supported, {
    supported,
    alreadyClaimedBefore: alreadyClaimed,
    claimedNow,
    explicitAlready,
    prompt: afterClaim.prompt,
    navNext: afterClaim.navNext,
    shrinesOn: afterClaim.shrinesOn,
    orbs: afterClaim.orbs,
    dAltar: +dAltarAfter.toFixed(2),
    note: 'R38: existing pull claim is not new-interact evidence; route-to-altar is the supported claim',
  });

  record('never-fell-into-pit', afterFar.y > 518 && atAltar.y > 518, {
    farY: afterFar.y, altarY: atAltar.y,
  });

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'trace.json'), JSON.stringify(report.trace, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    dir: outDir,
    errors: report.errors,
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
