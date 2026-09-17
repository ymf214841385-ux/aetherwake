#!/usr/bin/env node
/**
 * R19/E04: dawn tower from post-still-claimed (four shrines, orbs4, towers=[]).
 * Ordinary input only. Uses walk-steer + climb-controller. No old dawn save splice.
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
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-still-claimed.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `dawn-from-4shrines-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, ring: [], errors: [] };
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
      bodyYaw: +p.yaw.toFixed(3),
      state: p.state,
      stamina: +p.stamina.toFixed(1),
      towers: [...s.towersOn],
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      prompt: s.prompt,
      climbBtn: Boolean(document.querySelector('[data-touch-action="climb"]')),
      interactVisible: Boolean(document.querySelector('[data-touch-action="interact"]')),
      // Production climb contact (probeClimbWall) is authoritative for handoff.
      nearestClimb: (() => {
        const probe = typeof s.probeClimbWall === 'function' ? s.probeClimbWall() : null;
        if (probe) {
          return {
            id: probe.id,
            d: +probe.centerDistance.toFixed(2),
            touchingClimbable: Boolean(probe.climbable),
          };
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
    };
  });

async function pressLook(page, key, ms = 40) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function steerDrive(page, tx, tz, maxTurns = 14) {
  for (let i = 0; i < maxTurns; i++) {
    const t = await readTelemetry(page);
    if (t.mode !== 'playing' || t.state === 'dead') return { ok: false, t };
    const d = decideSteer({ x: t.x, z: t.z, camYaw: t.camYaw }, { x: tx, z: tz });
    if (d.kind === 'drive') {
      const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
      const cx = stick.x + stick.width / 2;
      const cy = stick.y + stick.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 42, { steps: 2 });
      await page.waitForTimeout(180);
      await page.mouse.up();
      return { ok: true, t: await readTelemetry(page) };
    }
    if (d.kind === 'turn') await pressLook(page, d.key);
    else break;
  }
  return { ok: false, t: await readTelemetry(page) };
}

let browser;
const server = await maybeStartQaServer({ name: 'dawn-4shrines', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need post-still-claimed');
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
  record('00-restore', t0.orbs >= 4 && t0.shrinesOn.length >= 4, { t0 });

  // Leave shrine if inside
  if (t0.world === 'shrine') {
    for (let i = 0; i < 6; i++) {
      const btn = page.locator('[data-touch-action="interact"]');
      if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 600 }).catch(() => {});
      const t = await readTelemetry(page);
      if (t.world === 'overworld') break;
    }
  }

  // Map select dawn
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.locator('.map-legend button', { hasText: '晨光塔' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Walk to dawn tower base (10, 68).
  // R22: keep east of s-0 (13,-24) aggro 22m AND clear of camps
  // (camp-c -18,16 / camp-b 88,-8 / camp-a 42,52). Enemies also roam —
  // do not stop to trade blows; dodge windup only and keep walking.
  const S0 = { x: 13, z: -24, aggro: 22 };
  const wps = [
    { x: 16, z: -55 },
    { x: 40, z: -35 },
    { x: 35, z: -5 },
    { x: 25, z: 20 },
    { x: 16, z: 50 },
    { x: 10, z: 64 },
  ];
  let st = createWalkerState();
  let stopped = null;
  let firstDamage = null;
  for (let i = 0; i < 240; i++) {
    const mid = await readTelemetry(page);
    if (mid.mode !== 'playing' || mid.state === 'dead') {
      stopped = { reason: 'terminal', i, mid };
      break;
    }
    if (mid.hp < 3 && !firstDamage) {
      firstDamage = { i, hp: mid.hp, x: mid.x, z: mid.z, why: mid.lastDamageWhy, enemies: mid.enemies };
      record('first-damage', true, firstDamage);
      await page.screenshot({ path: resolve(outDir, 'first-damage.png') }).catch(() => {});
    }
    const dS0 = Math.hypot(S0.x - mid.x, S0.z - mid.z);
    let target = wps[st.wpIndex] ?? wps[wps.length - 1];
    let dist = Math.hypot(target.x - mid.x, target.z - mid.z);
    if (dist < 7 && st.wpIndex < wps.length - 1) {
      st = onWaypointSwitch(st, st.wpIndex + 1);
      target = wps[st.wpIndex];
      record(`wp${st.wpIndex}`, true, { target, dS0: +dS0.toFixed(1) });
    }
      // Legal combat: dodge only for real strike windup. Do NOT stand and
      // attack/turn-loop while walk speed can leave the aggro circle.
      const nearestEnemy = mid.enemies?.[0] ?? null;
      const combat = decideCombatAction(mid.enemies, {
        hp: mid.hp,
        stamina: mid.stamina,
        dodgeCd: mid.dodgeCd,
        player: { x: mid.x, z: mid.z },
      }, {
        attackAvailable: false, // traversal: do not stop to trade blows
        canFaceEnemy: canFaceEnemyBody({ x: mid.x, z: mid.z, bodyYaw: mid.bodyYaw ?? mid.camYaw }, nearestEnemy),
        dodgeAvailable: mid.stamina > 20 && (mid.dodgeCd ?? 0) <= 0,
      });
    if (combat.kind === 'dodge') {
      const btn = page.locator('[data-touch-action="dodge"]');
      if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 350 }).catch(() => {});
      continue;
    }
    // Keep driving toward the waypoint — walk speed outruns approach if we do not stall.
    const drive = await steerDrive(page, target.x, target.z, 12);
    if (!drive.ok && drive.t?.mode !== 'playing') {
      stopped = { reason: 'terminal-steer', i };
      break;
    }
    const post = await readTelemetry(page);
    st = noteProgress(st, Math.hypot(target.x - post.x, target.z - post.z));
    if (st.noProgress >= 24) {
      stopped = { reason: 'no-progress', i, post, wp: st.wpIndex, dS0: +Math.hypot(S0.x - post.x, S0.z - post.z).toFixed(1) };
      break;
    }
    if (Math.hypot(10 - post.x, 68 - post.z) < 7) {
      record('01-arrive-dawn', true, { post, dS0Final: +Math.hypot(S0.x - post.x, S0.z - post.z).toFixed(1) });
      break;
    }
  }

  // 01-arrive is near-tower only (d<7). R24: APPROACH_CONTACT walks the last
  // meters until probeClimbWall actually hits dawn — then handoff once.
  const arrived = report.milestones.some((m) => m.name === '01-arrive-dawn' && m.pass);
  const TW = { x: 10, z: 68 };
  let approach = { steps: 0, t0: Date.now(), start: null, end: null, decision: null };
  let preClimb = await readTelemetry(page);

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
          x: t.x,
          z: t.z,
          camYaw: t.camYaw,
          hp: t.hp,
          state: t.state,
          touchingClimbable: t.nearestClimb?.touchingClimbable === true,
          nearestClimbId: t.nearestClimb?.id ?? null,
          nearestClimbDistance: t.nearestClimb?.d ?? null,
        },
        target: TW,
        requiredClimbPrefix: 'dawn',
        noProgress,
        maxNoProgress: 14,
      });
      approach.steps = i + 1;
      approach.decision = dec;
      if (dec.kind === 'handoff') break;
      if (dec.kind === 'stop') break;
      if (dec.kind === 'turn') {
        await page.keyboard.down(dec.key);
        await page.waitForTimeout(40);
        await page.keyboard.up(dec.key);
      } else if (dec.kind === 'drive') {
        const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
        if (stick) {
          const cx = stick.x + stick.width / 2;
          const cy = stick.y + stick.height / 2;
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
      x: preClimb.x,
      z: preClimb.z,
      d: preClimb.nearestClimb?.d ?? null,
      contact: preClimb.nearestClimb?.touchingClimbable === true,
      id: preClimb.nearestClimb?.id ?? null,
      elapsedMs: Date.now() - approach.t0,
    };
    record('01a-approach-contact', approach.decision?.kind === 'handoff' && preClimb.nearestClimb?.touchingClimbable === true, approach);
  }

  const handoff = canHandoffToClimb({
    world: preClimb.world,
    mode: preClimb.mode,
    alive: preClimb.hp > 0 && preClimb.state !== 'dead',
    nearestClimbDistance: preClimb.nearestClimb?.d ?? null,
    nearestClimbId: preClimb.nearestClimb?.id ?? null,
    touchingClimbable: preClimb.nearestClimb?.touchingClimbable === true,
    requiredClimbPrefix: 'dawn',
  });
  record('01b-climb-handoff', handoff.ok && arrived && approach.decision?.kind === 'handoff', {
    handoff,
    arrived,
    approachDecision: approach.decision,
    nearestClimb: preClimb.nearestClimb,
    pos: { x: preClimb.x, y: preClimb.y, z: preClimb.z },
  });

  if (!handoff.ok || !arrived || approach.decision?.kind !== 'handoff') {
    report.walkFailure = {
      reason: !arrived ? 'not-arrived' : (approach.decision?.kind !== 'handoff' ? `approach-${approach.decision?.kind ?? 'none'}:${approach.decision?.reason ?? handoff.reason}` : handoff.reason),
      pos: { x: preClimb.x, y: preClimb.y, z: preClimb.z },
      nearestClimb: preClimb.nearestClimb,
      approach,
      stopped,
      hp: preClimb.hp,
      why: preClimb.lastDamageWhy,
    };
    report.ok = false;
    writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({
      ok: false,
      walkFailure: report.walkFailure,
      milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
      dir: outDir,
    }));
    process.exitCode = 1;
  } else {
  // Climb via shared R10 executor (real nearestClimb + interactVisible + DESCEND/FAIL)
  // Exactly one executor invocation after APPROACH_CONTACT handoff.
  const base = preClimb;
  let maxY = base.y;
  let climbingSeen = false;
  let activated = false;
  const climb = await runClimbExecutor({
    page,
    readTelemetry,
    activateY: 11.1 + 38 - 2.2,
    targetX: 10,
    targetZ: 68,
    maxIters: 180,
    snap: (tag, sample, extra) => {
      report.ring.push({ tag, y: sample.y, stam: sample.stamina, state: sample.state, support: sample.nearestClimb?.id, ...extra });
      if (report.ring.length > 40) report.ring.shift();
    },
  });
  climbingSeen = climb.climbingSeen;
  activated = climb.activated;
  maxY = climb.maxY;
  if (climb.failure) {
    report.climbFailure = climb.failure;
    writeFileSync(resolve(outDir, 'climb-trace.json'), JSON.stringify(climb.trace, null, 2));
  }

  const final = await readTelemetry(page);
  maxY = Math.max(maxY, final.y);
  await page.screenshot({ path: resolve(outDir, 'dawn-final.png') });
  record('02-climb', climbingSeen, { maxY, final: { y: final.y, state: final.state } });
  record('03-activate-dawn', activated || final.towers.includes('dawn'), { maxY, towers: final.towers });

  // Reload
  const before = await readTelemetry(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  const cont = page.getByRole('button', { name: /继续/ });
  if ((await cont.count()) > 0) await cont.first().click();
  await page.waitForTimeout(400);
  const after = await readTelemetry(page);
  record('04-reload-dawn', after.towers.includes('dawn'), {
    before: { towers: before.towers, shrines: before.shrinesOn },
    after: { towers: after.towers, shrines: after.shrinesOn, orbs: after.orbs },
  });

  report.stopped = stopped;
  report.ok = report.milestones.some((m) => m.name === '04-reload-dawn' && m.pass);
  if (report.ok) {
    const ckpt = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-dawn-from-shrines.storage.json');
    const meta = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-dawn-from-shrines.meta.json');
    try {
      await ctx.storageState({ path: ckpt });
      writeFileSync(meta, JSON.stringify({
        source: 'dawn-from-shrines.mjs',
        sourceCheckpoint: 'post-still-claimed.storage.json',
        progressAtExport: {
          shrines: ['burst', 'rime', 'pull', 'still'],
          towers: ['dawn'],
          note: 'four shrines claimed + dawn lit from natural four-shrine save; no splice',
        },
        pid: process.pid,
        exportedAt: new Date().toISOString(),
      }, null, 2) + '\n');
      record('05-export', true, { path: ckpt, meta });
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
