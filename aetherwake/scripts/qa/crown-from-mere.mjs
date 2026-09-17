#!/usr/bin/env node
/**
 * R24: crown tower from post-mere-from-dawn (four shrines + dawn + mere).
 * Frost climb — ensure spicy if inventory has pepper. Ordinary input.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer, createWalkerState, onWaypointSwitch, noteProgress, canFaceEnemyBody, canHandoffToClimb, decideApproachContact } from '../../src/game/walk-steer.ts';
import { runClimbExecutor } from './climb-executor.mjs';
import { decideCombatAction } from '../../src/game/combat-threat.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-mere-from-dawn.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `crown-from-mere-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, ring: [], errors: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };
const TW = { x: 48, z: -128, id: 'crown', prefix: 'crown' };

const readTelemetry = (page) =>
  page.evaluate((tw) => {
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
      bodyYaw: +p.yaw.toFixed(3),
      state: p.state,
      stamina: +p.stamina.toFixed(1),
      towers: [...s.towersOn],
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      spicy: p.spicy,
      mats: { pepper: s.mats?.pepper ?? 0, apple: s.mats?.apple ?? 0 },
      prompt: s.prompt,
      interactVisible: Boolean(document.querySelector('[data-touch-action="interact"]')),
      nearestClimb: (() => {
        const probe = typeof s.probeClimbWall === 'function' ? s.probeClimbWall() : null;
        if (probe) return { id: probe.id, d: +probe.centerDistance.toFixed(2), touchingClimbable: Boolean(probe.climbable) };
        return null;
      })(),
      lastDamageWhy: s.lastDamageWhy || '',
      enemies: (s.enemies || []).filter((e) => e.alive).map((e) => ({
        id: e.id, d: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2), phase: e.brain?.phase ?? null, x: e.x, z: e.z,
      })).filter((e) => e.d < 18).sort((a, b) => a.d - b.d).slice(0, 4),
      attackPhase: s.attack?.phase ?? null,
      dodgeCd: +p.dodgeCd.toFixed(2),
      towerBaseY: s.heightFn(tw.x, tw.z),
    };
  }, TW);

async function steerDrive(page, tx, tz, maxTurns = 12) {
  for (let i = 0; i < maxTurns; i++) {
    const t = await readTelemetry(page);
    if (t.mode !== 'playing' || t.state === 'dead') return { ok: false, t };
    const d = decideSteer({ x: t.x, z: t.z, camYaw: t.camYaw }, { x: tx, z: tz });
    if (d.kind === 'drive') {
      const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
      const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 40, { steps: 2 });
      await page.waitForTimeout(180);
      await page.mouse.up();
      return { ok: true, t: await readTelemetry(page) };
    }
    if (d.kind === 'turn') {
      await page.keyboard.down(d.key);
      await page.waitForTimeout(40);
      await page.keyboard.up(d.key);
    } else break;
  }
  return { ok: false, t: await readTelemetry(page) };
}

let browser;
const server = await maybeStartQaServer({ name: 'crown-from-mere', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need post-mere-from-dawn');
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
  record('00-restore', t0.towers.includes('dawn') && t0.towers.includes('mere') && t0.shrinesOn.length >= 4, { t0 });

  // Map select crown
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.waitForTimeout(150);
  await page.locator('.map-legend button', { hasText: '雪冠' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  const sel = await page.evaluate(() => window.__sim.trackedObjective()?.targetId);
  record('01-map-crown', sel === 'crown', { sel });

  // mere(-108,8) → crown fire(57.2,-116.5) → crown(48,-128).
  // Frost: cook+eat pepper at 雪线篝火 before the climb.
  const FIRE = { x: 57.2, z: -116.5 };
  const wps = [
    { x: -80, z: -10 },
    { x: -40, z: -40 },
    { x: 0, z: -70 },
    { x: 20, z: -100 },
    { x: 40, z: -112 },
    { x: FIRE.x, z: FIRE.z },
  ];
  let st = createWalkerState();
  let stopped = null;
  for (let i = 0; i < 320; i++) {
    const mid = await readTelemetry(page);
    if (mid.mode !== 'playing' || mid.state === 'dead') {
      stopped = { reason: 'terminal', i, mid };
      break;
    }
    // Frost: eat pepper if spicy expired and we have mats
    if (mid.spicy < 1 && mid.mats.pepper > 0 && mid.y > 20) {
      // bag eat is complex; rely on climb shelter. Record only.
    }
    let target = wps[st.wpIndex] ?? wps[wps.length - 1];
    if (Math.hypot(target.x - mid.x, target.z - mid.z) < 10 && st.wpIndex < wps.length - 1) {
      st = onWaypointSwitch(st, st.wpIndex + 1);
      target = wps[st.wpIndex];
      record(`wp${st.wpIndex}`, true, { target });
    }
    const nearestEnemy = mid.enemies?.[0] ?? null;
    const combat = decideCombatAction(mid.enemies, {
      hp: mid.hp, stamina: mid.stamina, dodgeCd: mid.dodgeCd, player: { x: mid.x, z: mid.z },
    }, {
      attackAvailable: false,
      canFaceEnemy: canFaceEnemyBody({ x: mid.x, z: mid.z, bodyYaw: mid.bodyYaw ?? mid.camYaw }, nearestEnemy),
      dodgeAvailable: mid.stamina > 20 && (mid.dodgeCd ?? 0) <= 0,
    });
    if (combat.kind === 'dodge') {
      const btn = page.locator('[data-touch-action="dodge"]');
      if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 350 }).catch(() => {});
      continue;
    }
    await steerDrive(page, target.x, target.z, 10);
    const post = await readTelemetry(page);
    st = noteProgress(st, Math.hypot(target.x - post.x, target.z - post.z));
    if (st.noProgress >= 24) {
      stopped = { reason: 'no-progress', i, post, wp: st.wpIndex };
      break;
    }
    if (Math.hypot(FIRE.x - post.x, FIRE.z - post.z) < 3.5) {
      record('01-arrive-fire', true, { post, spicy: post.spicy, mats: post.mats });
      break;
    }
    if (Math.hypot(TW.x - post.x, TW.z - post.z) < 10) {
      record('01-arrive-crown-early', true, { post });
      break;
    }
  }

  // Cook + eat pepper at the snow-line fire (ordinary UI).
  {
    const tFire = await readTelemetry(page);
    if (tFire.spicy < 5 && tFire.mats.pepper > 0) {
      for (let i = 0; i < 8; i++) {
        const btn = page.locator('[data-touch-action="interact"]');
        if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 800 }).catch(() => {});
        await page.waitForTimeout(200);
        const mode = await page.evaluate(() => window.__sim.mode);
        if (mode === 'cooking') break;
      }
      const cookBtn = page.getByRole('button', { name: /烹饪.*火棘椒|烹饪.*椒/ });
      if ((await cookBtn.count()) > 0) {
        await cookBtn.first().click();
        await page.waitForTimeout(150);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      // Bag → eat 辣炒椒
      await page.locator('[data-touch-action="bag"]').tap().catch(() => {});
      await page.waitForTimeout(150);
      const meal = page.getByRole('button', { name: /辣炒椒/ });
      if ((await meal.count()) > 0) {
        await meal.first().click();
        await page.waitForTimeout(150);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
      const tAfter = await readTelemetry(page);
      record('01c-spicy', tAfter.spicy > 5, { spicy: tAfter.spicy, mats: tAfter.mats, mode: tAfter.mode });
    } else {
      record('01c-spicy', tFire.spicy > 5, { spicy: tFire.spicy, note: 'already-spicy-or-no-pepper' });
    }
  }

  // Walk from fire to tower if not already there
  if (!report.milestones.some((m) => m.name === '01-arrive-crown' && m.pass)) {
    for (let i = 0; i < 30; i++) {
      const t = await readTelemetry(page);
      if (t.mode !== 'playing' || t.state === 'dead') break;
      if (Math.hypot(TW.x - t.x, TW.z - t.z) < 10) {
        record('01-arrive-crown', true, { post: t });
        break;
      }
      await steerDrive(page, TW.x, TW.z, 8);
    }
  }

  const arrived = report.milestones.some((m) => m.name === '01-arrive-crown' && m.pass);
  let preClimb = await readTelemetry(page);
  let approach = { steps: 0, t0: Date.now(), start: null, end: null, decision: null };
  if (arrived) {
    approach.start = { x: preClimb.x, z: preClimb.z, d: preClimb.nearestClimb?.d ?? null };
    let noProgress = 0;
    let prevD = Math.hypot(TW.x - preClimb.x, TW.z - preClimb.z);
    for (let i = 0; i < 40; i++) {
      const t = await readTelemetry(page);
      if (t.mode !== 'playing' || t.state === 'dead') { approach.decision = { kind: 'stop', reason: 'terminal' }; break; }
      const dec = decideApproachContact({
        sample: {
          x: t.x, z: t.z, camYaw: t.camYaw, hp: t.hp, state: t.state,
          touchingClimbable: t.nearestClimb?.touchingClimbable === true,
          nearestClimbId: t.nearestClimb?.id ?? null,
          nearestClimbDistance: t.nearestClimb?.d ?? null,
        },
        target: TW, requiredClimbPrefix: 'crown', noProgress, maxNoProgress: 14,
      });
      approach.steps = i + 1;
      approach.decision = dec;
      if (dec.kind === 'handoff' || dec.kind === 'stop') break;
      if (dec.kind === 'turn') {
        await page.keyboard.down(dec.key);
        await page.waitForTimeout(40);
        await page.keyboard.up(dec.key);
      } else if (dec.kind === 'drive') {
        const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
        if (stick) {
          const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          await page.mouse.move(cx, cy - 36, { steps: 2 });
          await page.waitForTimeout(160);
          await page.mouse.up();
        }
      }
      const post = await readTelemetry(page);
      const dNow = Math.hypot(TW.x - post.x, TW.z - post.z);
      noProgress = dNow < prevD - 0.04 ? 0 : noProgress + 1;
      prevD = dNow;
    }
    preClimb = await readTelemetry(page);
    approach.end = { x: preClimb.x, z: preClimb.z, d: preClimb.nearestClimb?.d ?? null, contact: preClimb.nearestClimb?.touchingClimbable === true, id: preClimb.nearestClimb?.id, elapsedMs: Date.now() - approach.t0 };
    record('01a-approach-contact', approach.decision?.kind === 'handoff', approach);
  }

  const handoff = canHandoffToClimb({
    world: preClimb.world, mode: preClimb.mode,
    alive: preClimb.hp > 0 && preClimb.state !== 'dead',
    nearestClimbDistance: preClimb.nearestClimb?.d ?? null,
    nearestClimbId: preClimb.nearestClimb?.id ?? null,
    touchingClimbable: preClimb.nearestClimb?.touchingClimbable === true,
    requiredClimbPrefix: 'crown',
  });
  record('01b-climb-handoff', handoff.ok && arrived && approach.decision?.kind === 'handoff', { handoff, approach, nearestClimb: preClimb.nearestClimb });

  if (!handoff.ok || !arrived || approach.decision?.kind !== 'handoff') {
    report.walkFailure = {
      reason: !arrived ? 'not-arrived' : `approach-${approach.decision?.kind}`,
      pos: { x: preClimb.x, y: preClimb.y, z: preClimb.z },
      nearestClimb: preClimb.nearestClimb, approach, stopped, hp: preClimb.hp, why: preClimb.lastDamageWhy,
    };
    writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ok: false, walkFailure: report.walkFailure, milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })), dir: outDir }));
    process.exitCode = 1;
  } else {
    const baseY = preClimb.towerBaseY ?? 23;
    const climb = await runClimbExecutor({
      page, readTelemetry,
      activateY: baseY + 38 - 2.2,
      targetX: TW.x, targetZ: TW.z,
      targetTowerId: 'crown',
      maxIters: 220,
      snap: (tag, sample, extra) => {
        report.ring.push({ tag, y: sample.y, stam: sample.stamina, state: sample.state, support: sample.nearestClimb?.id, hp: sample.hp, ...extra });
        if (report.ring.length > 50) report.ring.shift();
      },
    });
    if (climb.failure) {
      report.climbFailure = climb.failure;
      writeFileSync(resolve(outDir, 'climb-trace.json'), JSON.stringify(climb.trace, null, 2));
    }
    const final = await readTelemetry(page);
    await page.screenshot({ path: resolve(outDir, 'crown-final.png') });
    record('02-climb', climb.climbingSeen, { maxY: climb.maxY, final: { y: final.y, state: final.state, hp: final.hp } });
    record('03-activate-crown', final.towers.includes('crown'), { maxY: climb.maxY, towers: final.towers });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__sim));
    const cont = page.getByRole('button', { name: /继续/ });
    if ((await cont.count()) > 0) await cont.first().click();
    await page.waitForTimeout(400);
    const after = await readTelemetry(page);
    record('04-reload-crown', after.towers.includes('crown') && after.towers.includes('mere') && after.towers.includes('dawn'), {
      after: { towers: after.towers, shrines: after.shrinesOn, orbs: after.orbs },
    });

    report.ok = report.milestones.some((m) => m.name === '04-reload-crown' && m.pass);
    if (report.ok) {
      const ckpt = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-crown-from-mere.storage.json');
      const meta = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-crown-from-mere.meta.json');
      try {
        await ctx.storageState({ path: ckpt });
        writeFileSync(meta, JSON.stringify({
          source: 'crown-from-mere.mjs',
          sourceCheckpoint: 'post-mere-from-dawn.storage.json',
          progressAtExport: { shrines: ['burst', 'rime', 'pull', 'still'], towers: ['dawn', 'mere', 'crown'], note: 'natural chain; seal should open' },
          pid: process.pid, exportedAt: new Date().toISOString(),
        }, null, 2) + '\n');
        record('05-export', true, { path: ckpt });
      } catch { record('05-export', false); }
    }
    writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({
      ok: report.ok, stopped,
      milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
      final: { towers: final.towers, orbs: final.orbs, shrines: final.shrinesOn, x: final.x, z: final.z, y: final.y, why: final.lastDamageWhy },
      dir: outDir,
    }));
    if (!report.ok) process.exitCode = 1;
  }
} catch (e) {
  report.failure = e.message;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopOwnedServer(server);
}
