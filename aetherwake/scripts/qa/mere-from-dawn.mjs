#!/usr/bin/env node
/**
 * R24: mere tower from post-dawn-from-shrines (four shrines + dawn).
 * Ordinary input. Same APPROACH_CONTACT + R10 climb executor as dawn.
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
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-dawn-from-shrines.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `mere-from-dawn-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, ring: [], errors: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };
const TW = { x: -108, z: 8, id: 'mere', prefix: 'mere' };

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
      prompt: s.prompt,
      interactVisible: Boolean(document.querySelector('[data-touch-action="interact"]')),
      nearestClimb: (() => {
        const probe = typeof s.probeClimbWall === 'function' ? s.probeClimbWall() : null;
        if (probe) {
          return { id: probe.id, d: +probe.centerDistance.toFixed(2), touchingClimbable: Boolean(probe.climbable) };
        }
        let best = null;
        for (const sol of s.solids || []) {
          if (!sol.climbable) continue;
          const d = Math.hypot(p.x - sol.x, p.z - sol.z);
          if (!best || d < best.d) best = { id: sol.id, d: +d.toFixed(2), touchingClimbable: false };
        }
        return best;
      })(),
      lastDamageWhy: s.lastDamageWhy || '',
      enemies: (s.enemies || [])
        .filter((e) => e.alive)
        .map((e) => ({
          id: e.id,
          d: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2),
          phase: e.brain?.phase ?? null,
          x: +e.x.toFixed(2),
          z: +e.z.toFixed(2),
        }))
        .filter((e) => e.d < 18)
        .sort((a, b) => a.d - b.d)
        .slice(0, 4),
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
const server = await maybeStartQaServer({ name: 'mere-from-dawn', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need post-dawn-from-shrines');
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
  record('00-restore', t0.orbs >= 4 && t0.towers.includes('dawn') && t0.shrinesOn.length >= 4, { t0 });

  if (t0.world === 'shrine') {
    for (let i = 0; i < 6; i++) {
      const btn = page.locator('[data-touch-action="interact"]');
      if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 600 }).catch(() => {});
      const t = await readTelemetry(page);
      if (t.world === 'overworld') break;
    }
  }

  // Map select mere
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.waitForTimeout(150);
  await page.locator('.map-legend button', { hasText: '镜湖塔' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  const sel = await page.evaluate(() => window.__sim.trackedObjective()?.targetId);
  record('01-map-mere', sel === 'mere', { sel });

  // Corridor dawn(10,68) → mere(-108,8); avoid camp-a(42,52), camp-c(-18,16)
  const wps = [
    { x: 0, z: 50 },
    { x: -30, z: 40 },
    { x: -55, z: 28 },
    { x: -80, z: 18 },
    { x: -100, z: 14 },
    { x: -108, z: 14 },
  ];
  let st = createWalkerState();
  let stopped = null;
  for (let i = 0; i < 280; i++) {
    const mid = await readTelemetry(page);
    if (mid.mode !== 'playing' || mid.state === 'dead') {
      stopped = { reason: 'terminal', i, mid };
      break;
    }
    let target = wps[st.wpIndex] ?? wps[wps.length - 1];
    if (Math.hypot(target.x - mid.x, target.z - mid.z) < 8 && st.wpIndex < wps.length - 1) {
      st = onWaypointSwitch(st, st.wpIndex + 1);
      target = wps[st.wpIndex];
      record(`wp${st.wpIndex}`, true, { target });
    }
    const nearestEnemy = mid.enemies?.[0] ?? null;
    const combat = decideCombatAction(mid.enemies, {
      hp: mid.hp, stamina: mid.stamina, dodgeCd: mid.dodgeCd,
      player: { x: mid.x, z: mid.z },
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
    if (st.noProgress >= 22) {
      stopped = { reason: 'no-progress', i, post, wp: st.wpIndex };
      break;
    }
    if (Math.hypot(TW.x - post.x, TW.z - post.z) < 8) {
      record('01-arrive-mere', true, { post });
      break;
    }
  }

  const arrived = report.milestones.some((m) => m.name === '01-arrive-mere' && m.pass);
  let preClimb = await readTelemetry(page);
  let approach = { steps: 0, t0: Date.now(), start: null, end: null, decision: null };

  if (arrived) {
    approach.start = { x: preClimb.x, z: preClimb.z, d: preClimb.nearestClimb?.d ?? null, contact: preClimb.nearestClimb?.touchingClimbable === true };
    let noProgress = 0;
    let prevD = Math.hypot(TW.x - preClimb.x, TW.z - preClimb.z);
    for (let i = 0; i < 40; i++) {
      const t = await readTelemetry(page);
      if (t.mode !== 'playing' || t.state === 'dead') {
        approach.decision = { kind: 'stop', reason: 'terminal' };
        break;
      }
      const dec = decideApproachContact({
        sample: {
          x: t.x, z: t.z, camYaw: t.camYaw, hp: t.hp, state: t.state,
          touchingClimbable: t.nearestClimb?.touchingClimbable === true,
          nearestClimbId: t.nearestClimb?.id ?? null,
          nearestClimbDistance: t.nearestClimb?.d ?? null,
        },
        target: TW,
        requiredClimbPrefix: 'mere',
        noProgress,
        maxNoProgress: 14,
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
    approach.end = {
      x: preClimb.x, z: preClimb.z,
      d: preClimb.nearestClimb?.d ?? null,
      contact: preClimb.nearestClimb?.touchingClimbable === true,
      id: preClimb.nearestClimb?.id ?? null,
      elapsedMs: Date.now() - approach.t0,
    };
    record('01a-approach-contact', approach.decision?.kind === 'handoff', approach);
  }

  const handoff = canHandoffToClimb({
    world: preClimb.world,
    mode: preClimb.mode,
    alive: preClimb.hp > 0 && preClimb.state !== 'dead',
    nearestClimbDistance: preClimb.nearestClimb?.d ?? null,
    nearestClimbId: preClimb.nearestClimb?.id ?? null,
    touchingClimbable: preClimb.nearestClimb?.touchingClimbable === true,
    requiredClimbPrefix: 'mere',
  });
  record('01b-climb-handoff', handoff.ok && arrived && approach.decision?.kind === 'handoff', {
    handoff, arrived, approachDecision: approach.decision, nearestClimb: preClimb.nearestClimb,
    pos: { x: preClimb.x, y: preClimb.y, z: preClimb.z },
  });

  if (!handoff.ok || !arrived || approach.decision?.kind !== 'handoff') {
    report.walkFailure = {
      reason: !arrived ? 'not-arrived' : `approach-${approach.decision?.kind ?? 'none'}:${approach.decision?.reason ?? handoff.reason}`,
      pos: { x: preClimb.x, y: preClimb.y, z: preClimb.z },
      nearestClimb: preClimb.nearestClimb, approach, stopped, hp: preClimb.hp, why: preClimb.lastDamageWhy,
    };
    report.ok = false;
    writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ok: false, walkFailure: report.walkFailure, milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })), dir: outDir }));
    process.exitCode = 1;
  } else {
    const baseY = preClimb.towerBaseY ?? 3.4;
    const climb = await runClimbExecutor({
      page,
      readTelemetry,
      activateY: baseY + 38 - 2.2,
      targetX: TW.x,
      targetZ: TW.z,
      targetTowerId: 'mere',
      maxIters: 200,
      snap: (tag, sample, extra) => {
        report.ring.push({ tag, y: sample.y, stam: sample.stamina, state: sample.state, support: sample.nearestClimb?.id, ...extra });
        if (report.ring.length > 40) report.ring.shift();
      },
    });
    if (climb.failure) {
      report.climbFailure = climb.failure;
      writeFileSync(resolve(outDir, 'climb-trace.json'), JSON.stringify(climb.trace, null, 2));
    }
    const final = await readTelemetry(page);
    await page.screenshot({ path: resolve(outDir, 'mere-final.png') });
    record('02-climb', climb.climbingSeen, { maxY: climb.maxY, final: { y: final.y, state: final.state } });
    record('03-activate-mere', final.towers.includes('mere'), { maxY: climb.maxY, towers: final.towers, executorActivated: climb.activated });

    const before = await readTelemetry(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__sim));
    const cont = page.getByRole('button', { name: /继续/ });
    if ((await cont.count()) > 0) await cont.first().click();
    await page.waitForTimeout(400);
    const after = await readTelemetry(page);
    record('04-reload-mere', after.towers.includes('mere') && after.towers.includes('dawn'), {
      before: { towers: before.towers, shrines: before.shrinesOn },
      after: { towers: after.towers, shrines: after.shrinesOn, orbs: after.orbs },
    });

    report.ok = report.milestones.some((m) => m.name === '04-reload-mere' && m.pass);
    if (report.ok) {
      const ckpt = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-mere-from-dawn.storage.json');
      const meta = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-mere-from-dawn.meta.json');
      try {
        await ctx.storageState({ path: ckpt });
        writeFileSync(meta, JSON.stringify({
          source: 'mere-from-dawn.mjs',
          sourceCheckpoint: 'post-dawn-from-shrines.storage.json',
          progressAtExport: { shrines: ['burst', 'rime', 'pull', 'still'], towers: ['dawn', 'mere'], note: 'natural chain; no splice' },
          pid: process.pid,
          exportedAt: new Date().toISOString(),
        }, null, 2) + '\n');
        record('05-export', true, { path: ckpt });
      } catch { record('05-export', false); }
    }
    writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({
      ok: report.ok,
      stopped,
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
