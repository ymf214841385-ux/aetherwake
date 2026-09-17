#!/usr/bin/env node
/**
 * R33 headed: C06 ice expiry, C08 plate moved-away/back, C09 freeze expiry.
 * Ordinary keyboard/touch only. Readonly telemetry. No evaluate state writes.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer } from '../../src/game/walk-steer.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptDir = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `r33-dynamic-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, errors: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };

const readTel = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const nav = s.navigationSnapshot();
    const extras = s.extraSupports ? s.extraSupports() : [];
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      camYaw: +s.cam.yaw.toFixed(3),
      state: p.state,
      hp: p.hp,
      art: s.art,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      ices: (s.ices || []).map((i) => ({ x: +i.x.toFixed(1), y: +i.y.toFixed(2), z: +i.z.toFixed(1), life: +i.life.toFixed(2) })),
      metals: (s.metals || []).map((m) => ({ id: m.id, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), held: m.held, d: +Math.hypot(m.x - p.x, m.z - p.z).toFixed(2) })),
      heldMetal: s.heldMetal,
      moveBlock: { x: +s.moveBlock.x.toFixed(2), z: +s.moveBlock.z.toFixed(2), frozen: +s.moveBlock.frozen.toFixed(2) },
      extraSupportIds: extras.map((e) => e.id),
      nav: nav?.status,
      navNext: nav?.nextAction,
      navRequiredArt: nav?.requiredArt,
      navGuidance: nav?.guidance,
      navSegs: (nav?.segments || []).map((sg) => ({
        id: sg.id,
        ok: sg.validated,
        kind: sg.kind,
        from: [sg.from?.x, sg.from?.z],
        to: [sg.to?.x, sg.to?.z],
        why: sg.blockedReason,
        poly: sg.polyline?.length ?? 0,
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

async function remappedCkpt(name, url) {
  const raw = JSON.parse(readFileSync(resolve(ckptDir, name), 'utf8'));
  return { ...raw, origins: (raw.origins || []).map((o) => ({ ...o, origin: url.replace(/\/$/, '') })) };
}

async function steerUntilDrive(page, target, maxTurns = 24) {
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
  if (await btn.isVisible().catch(() => false)) {
    await btn.tap({ timeout: 600 }).catch(() => {});
  } else {
    await page.keyboard.press('KeyE');
  }
  await page.waitForTimeout(220);
  return readTel(page);
}

async function enterShrineNear(page, doorX, doorZ, expectIdx) {
  const t0 = await readTel(page);
  if (t0.world === 'shrine' && (expectIdx == null || t0.shrine === expectIdx)) return { ok: true, t: t0 };
  for (let i = 0; i < 18; i++) {
    const steer = await steerUntilDrive(page, { x: doorX, z: doorZ }, 12);
    if (steer.ok) await driveOnce(page, 160);
    const t = await tapInteract(page);
    if (t.world === 'shrine' && (expectIdx == null || t.shrine === expectIdx)) return { ok: true, t };
    if (t.mode !== 'playing') break;
  }
  return { ok: false, t: await readTel(page) };
}

let browser;
const server = await maybeStartQaServer({ name: 'r33-dynamic', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });

  // ================= C06 rime ice expiry =================
  {
    const state = await remappedCkpt('post-rime-complete.storage.json', server.url);
    const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, storageState: state });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message)));
    await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
    await continueGame(page);
    const t0 = await readTel(page);
    record('C06-start', t0.orbs >= 2, { world: t0.world, shrine: t0.shrine, x: t0.x, z: t0.z });

    const ent = await enterShrineNear(page, -72, 38.8, 0);
    record('C06-enter-rime', ent.ok, { t: { world: ent.t.world, shrine: ent.t.shrine, x: ent.t.x, z: ent.t.z } });
    if (!ent.ok) {
      report.failure = { milestone: 'C06-enter-rime', t: ent.t };
    } else {
      const ox = 220, oz = 0;
      const before = await readTel(page);
      record('C06-before-spell', before.nav === 'action-required' && before.navRequiredArt === 'rime' && before.ices.length === 0, {
        nav: before.nav, requiredArt: before.navRequiredArt, next: before.navNext, ices: before.ices,
      });

      // Walk to water action area (ordinary input)
      for (let i = 0; i < 20; i++) {
        const steer = await steerUntilDrive(page, { x: ox + 4, z: oz + 10 }, 12);
        if (steer.ok) await driveOnce(page, 170);
        const t = await readTel(page);
        if (Math.hypot(t.x - (ox + 4), t.z - (oz + 10)) < 3.5) break;
      }
      await page.screenshot({ path: resolve(outDir, 'C06-at-water.png') });

      await page.keyboard.press('Digit3');
      await page.waitForTimeout(80);
      await steerUntilDrive(page, { x: ox, z: oz + 16 }, 16);
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(180);
      }
      const withIce = await readTel(page);
      await page.screenshot({ path: resolve(outDir, 'C06-ice.png') });
      record('C06-ice-live', withIce.ices.length > 0 && withIce.extraSupportIds.some((id) => id.startsWith('ice-')), {
        ices: withIce.ices, extraSupportIds: withIce.extraSupportIds, nav: withIce.nav, next: withIce.navNext,
      });

      // Return to entry lip (o.y floor ≈ 520) before waiting out ice life
      for (let i = 0; i < 16; i++) {
        const steer = await steerUntilDrive(page, { x: ox, z: oz + 6.5 }, 12);
        if (steer.ok) await driveOnce(page, 150);
        const t = await readTel(page);
        if (Math.hypot(t.x - ox, t.z - (oz + 6.5)) < 1.6 && t.y > 518) break;
      }
      const safe = await readTel(page);
      let expired = safe;
      for (let i = 0; i < 55; i++) {
        expired = await readTel(page);
        if (expired.ices.length === 0) break;
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: resolve(outDir, 'C06-after-expiry.png') });
      const noIceSupports = !expired.extraSupportIds.some((id) => id.startsWith('ice-'));
      const expiredSegsHaveIce = expired.navSegs.some((sg) => /ice|霜柱/.test(sg.id || '') || (sg.to && Math.abs(sg.to[1] - (oz + 12)) < 8 && sg.ok));
      // Require: ice gone; nav not walk over ice supports; requires rime again when pit blocks
      const needsRimeAgain = expired.nav === 'action-required' && /霜息|霜柱|rime/.test((expired.navNext || '') + (expired.navGuidance || '') + (expired.navRequiredArt || ''));
      record('C06-expiry-removes-support', withIce.ices.length > 0 && expired.ices.length === 0 && noIceSupports, {
        before: withIce.ices, after: expired.ices, extraSupportIds: expired.extraSupportIds,
      });
      record('C06-expiry-nav-reeval', needsRimeAgain || expired.nav !== 'walk', {
        nav: expired.nav, next: expired.navNext, requiredArt: expired.navRequiredArt, guidance: expired.navGuidance,
        segs: expired.navSegs, safePose: { x: safe.x, y: safe.y, z: safe.z },
      });
      record('C06-stood-safe-floor', safe.state === 'grounded' && safe.y > 517, { y: safe.y, state: safe.state, x: safe.x, z: safe.z });
    }
    await ctx.close();
  }

  // ================= C09 still freeze expiry =================
  {
    const state = await remappedCkpt('post-still-claimed.storage.json', server.url);
    const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, storageState: state });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message)));
    await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
    await continueGame(page);
    const t0 = await readTel(page);
    record('C09-start', t0.orbs >= 4, { world: t0.world, x: t0.x, z: t0.z });

    const ent = await enterShrineNear(page, 14, -75.2, 3);
    record('C09-enter-still', ent.ok, { t: { world: ent.t.world, shrine: ent.t.shrine, x: ent.t.x, z: ent.t.z } });
    if (!ent.ok) {
      report.failure = report.failure || { milestone: 'C09-enter-still', t: ent.t };
    } else {
      const ox = 364, oz = 0;
      // Safe lip south of pit (authoritative r19/r20 geometry)
      for (let i = 0; i < 14; i++) {
        const steer = await steerUntilDrive(page, { x: ox, z: oz + 8.5 }, 12);
        if (steer.ok) await driveOnce(page, 160);
        const t = await readTel(page);
        if (Math.hypot(t.x - ox, t.z - (oz + 8.5)) < 1.8) break;
      }
      const lip = await readTel(page);
      await page.screenshot({ path: resolve(outDir, 'C09-lip.png') });
      record('C09-at-lip', lip.y > 518, { x: lip.x, y: lip.y, z: lip.z, moveBlock: lip.moveBlock });

      await page.keyboard.press('Digit5');
      await page.waitForTimeout(80);
      let aligned = null;
      for (let i = 0; i < 50; i++) {
        const t = await readTel(page);
        if (Math.abs(t.moveBlock.x - ox) < 1.2) {
          aligned = t.moveBlock;
          await page.keyboard.press('KeyF');
          await page.waitForTimeout(150);
          break;
        }
        await page.waitForTimeout(120);
      }
      const frozenSnap = await readTel(page);
      const frozenSegs = frozenSnap.navSegs.filter((s) => s.ok);
      record('C09-freeze-walk', (frozenSnap.moveBlock.frozen ?? 0) > 1 && frozenSnap.nav === 'walk' && frozenSegs.length > 0 && frozenSegs.some((s) => s.poly >= 2), {
        aligned, frozen: frozenSnap.moveBlock, nav: frozenSnap.nav, next: frozenSnap.navNext,
        segs: frozenSnap.navSegs,
      });
      await page.screenshot({ path: resolve(outDir, 'C09-frozen-walk.png') });

      // Stay on safe lip through expiry — do not stand on the slab
      let expired = frozenSnap;
      for (let i = 0; i < 12; i++) {
        expired = await readTel(page);
        if (expired.moveBlock.frozen <= 0.05) break;
        await page.waitForTimeout(500);
      }
      // Sample slab motion after unfreeze
      const mb0 = expired.moveBlock;
      await page.waitForTimeout(800);
      const mb1 = (await readTel(page)).moveBlock;
      const slabMoved = Math.hypot(mb1.x - mb0.x, mb1.z - mb0.z) > 0.15;
      await page.screenshot({ path: resolve(outDir, 'C09-after-expiry.png') });
      record('C09-expiry-slab-moves', expired.moveBlock.frozen <= 0.05 && slabMoved, {
        frozen: expired.moveBlock.frozen, mb0, mb1, slabMoved,
      });
      const afterNav = await readTel(page);
      const stillWalkOnFrozen = afterNav.nav === 'walk' && afterNav.navSegs.some((s) => s.ok && Math.abs((s.to?.[1] ?? 0) - (oz + 13)) < 3 && Math.abs((s.from?.[0] ?? 0) - ox) < 2);
      record('C09-expiry-nav-not-permanent-bridge', afterNav.nav !== 'walk' || !stillWalkOnFrozen, {
        nav: afterNav.nav, next: afterNav.navNext, requiredArt: afterNav.navRequiredArt, guidance: afterNav.navGuidance,
        segs: afterNav.navSegs, lip: { x: afterNav.x, y: afterNav.y, z: afterNav.z },
      });
    }
    await ctx.close();
  }

  // ================= C08 pull plate moved away / back =================
  {
    const state = await remappedCkpt('post-pull-claimed.storage.json', server.url);
    const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true, storageState: state });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message)));
    await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
    await continueGame(page);
    const t0 = await readTel(page);
    record('C08-start', t0.orbs >= 3, { world: t0.world, x: t0.x, z: t0.z });

    const ent = await enterShrineNear(page, 36, 10.5, 2);
    record('C08-enter-pull', ent.ok, { t: { world: ent.t.world, shrine: ent.t.shrine, x: ent.t.x, z: ent.t.z } });
    if (!ent.ok) {
      report.failure = report.failure || { milestone: 'C08-enter-pull', t: ent.t };
    } else {
      const o = { x: 316, z: 0 };
      await page.keyboard.press('Digit4');
      await page.waitForTimeout(80);

      // Near metal
      for (let i = 0; i < 16; i++) {
        const steer = await steerUntilDrive(page, { x: o.x + 6.2, z: o.z + 8 }, 12);
        if (steer.ok) await driveOnce(page, 150);
        const t = await readTel(page);
        const m = t.metals[0];
        if (m && m.d < 8) break;
      }
      const nearPlate = await readTel(page);
      record('C08-plate-present', nearPlate.metals.length > 0, { metals: nearPlate.metals, extras: nearPlate.extraSupportIds });

      // Grab + throw away (toward entry / -Z, away from pit bridge lane)
      await page.keyboard.press('KeyF');
      await page.waitForTimeout(200);
      const grabbed = await readTel(page);
      const held = grabbed.heldMetal >= 0 || grabbed.metals.some((m) => m.held);
      record('C08-grab', held, { heldMetal: grabbed.heldMetal, metals: grabbed.metals });
      if (held) {
        await steerUntilDrive(page, { x: o.x + 6, z: o.z + 4 }, 16);
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(500);
        const thrownAway = await readTel(page);
        await page.screenshot({ path: resolve(outDir, 'C08-thrown-away.png') });
        record('C08-thrown-away', thrownAway.metals.every((m) => !m.held), {
          metals: thrownAway.metals, extras: thrownAway.extraSupportIds,
          nav: thrownAway.nav, next: thrownAway.navNext, segs: thrownAway.navSegs,
        });

        // Pick up again and throw toward the bridge lane (pit center z≈13)
        for (let i = 0; i < 12; i++) {
          const m = (await readTel(page)).metals[0];
          if (!m) break;
          const steer = await steerUntilDrive(page, { x: m.x, z: m.z }, 10);
          if (steer.ok) await driveOnce(page, 140);
          if (m.d < 6) break;
        }
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(200);
        const grab2 = await readTel(page);
        if (grab2.heldMetal >= 0 || grab2.metals.some((m) => m.held)) {
          await steerUntilDrive(page, { x: o.x, z: o.z + 13 }, 18);
          await page.keyboard.press('KeyF');
          await page.waitForTimeout(600);
          const back = await readTel(page);
          await page.screenshot({ path: resolve(outDir, 'C08-placed-back.png') });
          const plate = back.metals.find((m) => m.id.startsWith('metal-shrine'));
          const plateOnLane = plate && !plate.held && Math.abs(plate.z - 13) < 5 && Math.abs(plate.x - o.x) < 4;
          record('C08-placed-back-support', Boolean(plate) && !plate.held && back.extraSupportIds.includes(plate.id), {
            plate, plateOnLane, extras: back.extraSupportIds, nav: back.nav, segs: back.navSegs,
          });
          const plateAway = thrownAway.metals.find((m) => m.id.startsWith('metal-shrine'));
          const awayFromPit = plateAway && (plateAway.z < 8 || Math.abs(plateAway.x - o.x) > 6);
          // When plate is away from the pit, nav must not fabricate a center-lane walk to (316,13).
          const awayCenterWalk = thrownAway.navSegs.find((s) => s.ok && Math.abs((s.to?.[1] ?? 0) - 13) < 3 && Math.abs((s.to?.[0] ?? 0) - o.x) < 3);
          const backHasMetalSupport = back.extraSupportIds.includes(plate?.id);
          const awayHasMetalSupport = thrownAway.extraSupportIds.includes(plateAway?.id);
          record('C08-route-follows-plate',
            Boolean(plate) && backHasMetalSupport && awayHasMetalSupport && Boolean(awayFromPit) && !awayCenterWalk, {
            plateBack: plate, plateAway, plateOnLane,
            backHasMetalSupport, awayHasMetalSupport, awayFromPit,
            awayCenterWalk: awayCenterWalk ?? null,
            awayNav: { nav: thrownAway.nav, segs: thrownAway.navSegs },
            backNav: { nav: back.nav, segs: back.navSegs },
            note: 'side corridor may remain; center-lane walk must not appear when plate is away',
          });
        } else {
          record('C08-placed-back-support', false, { grab2 });
        }
      }
    }
    await ctx.close();
  }

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    dir: outDir,
    errors: report.errors,
    failure: report.failure,
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
