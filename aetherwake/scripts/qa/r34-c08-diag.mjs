#!/usr/bin/env node
/**
 * R34 C08-only diagnostic: stable metal-shrine-* id, same observer point,
 * full polyline + support geometry. Ordinary F grab/throw only. No state writes.
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
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `r34-c08-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], errors: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };

// Pull shrine origin (index 2)
const O = { x: 316, z: 0 };
const PIT = { z0: 10, z1: 16.5, halfW: 4.6, depth: 4.4 };
// Natural entry spawn of pull shrine — reproducible safe observer.
const OBS = { x: O.x, z: O.z + 4.4, tol: 0.4 };
const PLATE_R = 1.15;

const readTel = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const nav = s.navigationSnapshot();
    const extras = (s.extraSupports ? s.extraSupports() : []).map((e) => ({
      id: e.id, x: +e.x.toFixed(3), y: +e.y.toFixed(3), z: +e.z.toFixed(3), r: e.r,
    }));
    const plate = (s.metals || []).find((m) => m.id.startsWith('metal-shrine'));
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      state: p.state,
      hp: p.hp,
      art: s.art,
      orbs: s.orbs,
      heldMetal: s.heldMetal,
      plate: plate
        ? { id: plate.id, x: +plate.x.toFixed(3), y: +plate.y.toFixed(3), z: +plate.z.toFixed(3), held: plate.held }
        : null,
      extras,
      nav: nav?.status,
      navNext: nav?.nextAction,
      navGuidance: nav?.guidance,
      navSegs: (nav?.segments || []).map((sg) => ({
        id: sg.id,
        ok: sg.validated,
        kind: sg.kind,
        from: { x: +sg.from.x.toFixed(3), y: +sg.from.y.toFixed(3), z: +sg.from.z.toFixed(3) },
        to: { x: +sg.to.x.toFixed(3), y: +sg.to.y.toFixed(3), z: +sg.to.z.toFixed(3) },
        why: sg.blockedReason ?? null,
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
  await page.waitForTimeout(300);
}

async function remappedCkpt(name, url) {
  const raw = JSON.parse(readFileSync(resolve(ckptPath), 'utf8'));
  const src = existsSync(resolve(ckptDir(), name))
    ? JSON.parse(readFileSync(resolve(ckptDir(), name), 'utf8'))
    : raw;
  return { ...src, origins: (src.origins || []).map((o) => ({ ...o, origin: url.replace(/\/$/, '') })) };
}
function ckptDir() {
  return resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint');
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

async function driveOnce(page, ms = 150) {
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

/** Walk to observer within tolerance using ordinary input. */
async function returnToObserver(page, label) {
  let t = await readTel(page);
  for (let i = 0; i < 60; i++) {
    t = await readTel(page);
    const d = Math.hypot(t.x - OBS.x, t.z - OBS.z);
    if (d <= OBS.tol) {
      record(label, true, { x: t.x, y: t.y, z: t.z, d: +d.toFixed(3) });
      return t;
    }
    const steer = await steerUntilDrive(page, OBS, 14);
    if (steer.ok) await driveOnce(page, 180);
    else {
      // If steer says timeout, nudge with a short W toward +Z/-Z based on dz
      await driveOnce(page, 120);
    }
  }
  t = await readTel(page);
  record(label, false, { x: t.x, y: t.y, z: t.z, d: +Math.hypot(t.x - OBS.x, t.z - OBS.z).toFixed(3) });
  return t;
}

function analyzeBridge(sample, plate) {
  const extra = sample.extras.find((e) => e.id === plate?.id) ?? null;
  const pitPolys = [];
  for (const sg of sample.navSegs) {
    if (!sg.ok || sg.kind !== 'walk') continue;
    for (const q of sg.poly) {
      if (q.z > PIT.z0 - 0.5 && q.z < PIT.z1 + 0.5 && Math.abs(q.x - O.x) < PIT.halfW + 0.5) {
        pitPolys.push({ seg: sg.id, ...q });
      }
    }
  }
  // Gap from pit floor edges to plate support disc (if plate in pit band)
  let gap = null;
  if (plate && !plate.held && plate.z > PIT.z0 - 2 && plate.z < PIT.z1 + 2) {
    const northGap = Math.max(0, PIT.z0 - (plate.z + PLATE_R));
    const southGap = Math.max(0, plate.z - PLATE_R - PIT.z1);
    // Entry lip at z=10, far lip z=16.5 — plate cannot cover both with r=1.15
    gap = {
      plateZ: plate.z,
      plateR: PLATE_R,
      pitZ0: PIT.z0,
      pitZ1: PIT.z1,
      coverNorth: plate.z + PLATE_R >= PIT.z0,
      coverSouth: plate.z - PLATE_R <= PIT.z1,
      spanNeeded: +(PIT.z1 - PIT.z0).toFixed(2),
      plateCover: +(2 * PLATE_R).toFixed(2),
      uncoveredNorth: +northGap.toFixed(2),
      uncoveredSouth: +southGap.toFixed(2),
    };
  }
  return {
    plateExtra: extra,
    pitPolys,
    pitWalkCount: pitPolys.length,
    gap,
    sidewalkLike: sample.navSegs.some((s) => s.ok && Math.abs(s.to.x - (O.x + 7.15)) < 2),
  };
}

let browser;
const server = await maybeStartQaServer({ name: 'r34-c08', kind: 'preview' });
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

  const t0 = await readTel(page);
  record('start', t0.orbs >= 3, { world: t0.world, x: t0.x, z: t0.z });

  // Enter pull
  let entered = t0.world === 'shrine' && t0.shrine === 2;
  if (!entered) {
    for (let i = 0; i < 16 && !entered; i++) {
      const steer = await steerUntilDrive(page, { x: 36, z: 10.5 }, 12);
      if (steer.ok) await driveOnce(page, 150);
      const t = await tapInteract(page);
      if (t.world === 'shrine' && t.shrine === 2) entered = true;
    }
  }
  const inPull = await readTel(page);
  record('enter-pull', entered, { world: inPull.world, shrine: inPull.shrine, x: inPull.x, z: inPull.z });
  if (!entered) {
    writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    process.exitCode = 1;
    console.log(JSON.stringify({ ok: false, milestones: report.milestones, dir: outDir }));
    await browser.close();
    await stopOwnedServer(server);
    process.exit(1);
  }

  await page.keyboard.press('Digit4');
  await page.waitForTimeout(80);

  // Stable plate id
  const startTel = await readTel(page);
  const plateId = startTel.plate?.id;
  record('plate-id', Boolean(plateId && plateId.startsWith('metal-shrine')), { plateId, plate: startTel.plate });
  assert.ok(plateId, 'need metal-shrine plate');

  // Walk to shrine plate only
  async function approachPlate() {
    for (let i = 0; i < 20; i++) {
      const t = await readTel(page);
      if (!t.plate) return t;
      const d = Math.hypot(t.plate.x - t.x, t.plate.z - t.z);
      if (d < 5) return t;
      const steer = await steerUntilDrive(page, { x: t.plate.x, z: t.plate.z }, 10);
      if (steer.ok) await driveOnce(page, 140);
    }
    return readTel(page);
  }

  // --- A: plate AWAY from pit (throw toward entry +X) ---
  await approachPlate();
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(180);
  let g = await readTel(page);
  record('grab-away', g.plate?.held === true && g.heldMetal >= 0, { plate: g.plate, heldMetal: g.heldMetal });
  if (g.plate?.held) {
    await steerUntilDrive(page, { x: O.x + 6, z: O.z + 5 }, 14);
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(500);
  }
  const awayPlate = (await readTel(page)).plate;
  await page.screenshot({ path: resolve(outDir, 'C08-plate-away.png') });
  const obsAway = await returnToObserver(page, 'observer-away');
  const snapAway = await readTel(page);
  const awayAnalysis = analyzeBridge(snapAway, awayPlate);
  record('away-snapshot', snapAway.world === 'shrine' && snapAway.shrine === 2 && snapAway.plate && !snapAway.plate.held, {
    observer: { x: snapAway.x, y: snapAway.y, z: snapAway.z },
    plate: snapAway.plate,
    plateExtra: awayAnalysis.plateExtra,
    nav: snapAway.nav,
    navSegs: snapAway.navSegs,
    pitWalkCount: awayAnalysis.pitWalkCount,
    sidewalkLike: awayAnalysis.sidewalkLike,
  });

  // --- B: plate back toward pit lane ---
  await approachPlate();
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(180);
  g = await readTel(page);
  record('grab-back', g.plate?.held === true && g.heldMetal >= 0, { plate: g.plate });
  if (g.plate?.held) {
    // Stand on entry centerline facing the pit lane, then throw.
    await steerUntilDrive(page, { x: O.x, z: O.z + 8 }, 12);
    await driveOnce(page, 120);
    await steerUntilDrive(page, { x: O.x, z: O.z + 14 }, 10);
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(600);
  }
  const backPlate = (await readTel(page)).plate;
  await page.screenshot({ path: resolve(outDir, 'C08-plate-pit.png') });
  const obsBack = await returnToObserver(page, 'observer-back');
  const snapBack = await readTel(page);
  const backAnalysis = analyzeBridge(snapBack, backPlate);
  record('back-snapshot', snapBack.world === 'shrine' && snapBack.shrine === 2 && snapBack.plate && !snapBack.plate.held, {
    observer: { x: snapBack.x, y: snapBack.y, z: snapBack.z },
    plate: snapBack.plate,
    plateExtra: backAnalysis.plateExtra,
    nav: snapBack.nav,
    navSegs: snapBack.navSegs,
    pitWalkCount: backAnalysis.pitWalkCount,
    sidewalkLike: backAnalysis.sidewalkLike,
    gap: backAnalysis.gap,
  });

  // Same observer?
  const sameObs = Math.hypot(obsAway.x - obsBack.x, obsAway.z - obsBack.z) <= OBS.tol * 2;
  record('same-observer', sameObs, {
    away: { x: obsAway.x, z: obsAway.z },
    back: { x: obsBack.x, z: obsBack.z },
    delta: +Math.hypot(obsAway.x - obsBack.x, obsAway.z - obsBack.z).toFixed(3),
  });

  // Plate-dependent claim: do NOT require status toggle. Report geometry.
  // Bridge walk exists only if polyline enters pit AND plate support disc covers that sample.
  function coveredByPlate(polyPt, plate, extra) {
    if (!plate || plate.held) return false;
    const r = extra?.r ?? PLATE_R;
    return Math.hypot(polyPt.x - plate.x, polyPt.z - plate.z) <= r + 0.35;
  }
  const backBridgePolys = backAnalysis.pitPolys.filter((q) => coveredByPlate(q, snapBack.plate, backAnalysis.plateExtra));
  const awayBridgePolys = awayAnalysis.pitPolys.filter((q) => coveredByPlate(q, snapAway.plate, awayAnalysis.plateExtra));

  // Honest diagnostic summary
  const canSinglePlateBridge = backAnalysis.gap
    ? backAnalysis.gap.coverNorth && backAnalysis.gap.coverSouth && backAnalysis.gap.plateCover >= backAnalysis.gap.spanNeeded
    : false;

  record('C08-diagnosis', true, {
    plateId,
    away: {
      plate: snapAway.plate,
      support: awayAnalysis.plateExtra,
      nav: snapAway.nav,
      pitPolys: awayAnalysis.pitPolys.length,
      bridgePolys: awayBridgePolys.length,
      sidewalkLike: awayAnalysis.sidewalkLike,
    },
    back: {
      plate: snapBack.plate,
      support: backAnalysis.plateExtra,
      nav: snapBack.nav,
      pitPolys: backAnalysis.pitPolys.length,
      bridgePolys: backBridgePolys.length,
      sidewalkLike: backAnalysis.sidewalkLike,
      gap: backAnalysis.gap,
    },
    canSinglePlateBridge,
    conclusion: canSinglePlateBridge
      ? 'single plate geometrically spans pit'
      : 'single plate cannot span pit z-band; side corridor remains the valid walk; no fabricated bridge',
  });

  // Pass criteria: same observer, both snapshots recorded, plate always the shrine id,
  // support present when unheld, and we did NOT invent a bridge walk when plate is away.
  const plateStable = snapAway.plate?.id === plateId && snapBack.plate?.id === plateId;
  const supportWhenUnheld = Boolean(awayAnalysis.plateExtra) && Boolean(backAnalysis.plateExtra);
  const noFakeAwayBridge = awayBridgePolys.length === 0;
  report.ok = sameObs && plateStable && supportWhenUnheld && noFakeAwayBridge
    && report.milestones.every((m) => m.pass);

  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'C08-geometry.json'), JSON.stringify({
    plateId, OBS, PIT, PLATE_R, away: snapAway, back: snapBack, awayAnalysis, backAnalysis,
  }, null, 2) + '\n');
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
