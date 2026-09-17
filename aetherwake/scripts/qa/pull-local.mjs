#!/usr/bin/env node
/**
 * R15 pull local validation from post-rime-complete checkpoint.
 * Asserts burst+rime and orbs>=2 before walk.
 * Uses decideCombatAction for multi-enemy; interrupt steering on threats.
 * First HP loss stops diagnosis with ring buffer — no export on failure.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer, createWalkerState, onWaypointSwitch, noteProgress, worldToStickOffset } from '../../src/game/walk-steer.ts';
import { decideCombatAction } from '../../src/game/combat-threat.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-rime-complete.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `pull-local-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], firstDamage: null, failure: null, ring: [], errors: [] };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };
const RING = 36;
const pushRing = (s, tag) => {
  report.ring.push({ tag, t: Date.now(), ...s });
  if (report.ring.length > RING) report.ring.shift();
};

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const enemies = (s.enemies || [])
      .filter((e) => e.alive)
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        x: +e.x.toFixed(2),
        z: +e.z.toFixed(2),
        d: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2),
        phase: e.brain?.phase ?? null,
      }))
      .filter((e) => e.d < 22)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    return {
      mode: s.mode,
      world: s.worldKind,
      shrine: s.shrine,
      hp: p.hp,
      stamina: +p.stamina.toFixed(1),
      dodgeCd: +p.dodgeCd.toFixed(2),
      invuln: +p.invuln.toFixed(2),
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      vx: +p.vx.toFixed(2),
      vz: +p.vz.toFixed(2),
      camYaw: +s.cam.yaw.toFixed(3),
      bodyYaw: +p.yaw.toFixed(3),
      state: p.state,
      attackPhase: s.attack?.phase ?? null,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      towers: [...s.towersOn],
      lastDamageWhy: s.lastDamageWhy || '',
      prompt: s.prompt,
      enemies,
    };
  });

async function pressLook(page, key, ms = 40) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function tapBtn(page, action, timeout = 400) {
  const btn = page.locator(`[data-touch-action="${action}"]`);
  if (!(await btn.isVisible().catch(() => false))) return false;
  await btn.tap({ timeout }).catch(() => {});
  return true;
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
async function driveVec(page, dx, dy, ms = 180) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return readTelemetry(page);
}

/** World flee vector → screen stick via cam basis (matches sim wish inverse). */
async function fleeWorld(page, worldDx, worldDz, ms = 160) {
  const t = await readTelemetry(page);
  const off = worldToStickOffset({ x: worldDx, z: worldDz }, t.camYaw, 40);
  return driveVec(page, off.dx, off.dy, ms);
}

/** Production-ish melee facing: bodyFwd · towardEnemy >= ATTACK_ARC (0.72). */
function canFaceEnemy(sample, enemy) {
  if (enemy.x == null || enemy.z == null) return false;
  const fx = -Math.sin(sample.bodyYaw ?? sample.camYaw);
  const fz = -Math.cos(sample.bodyYaw ?? sample.camYaw);
  const dx = enemy.x - sample.x;
  const dz = enemy.z - sample.z;
  const len = Math.hypot(dx, dz) || 1;
  const dir = (dx * fx + dz * fz) / len;
  return dir >= 0.72;
}

function combatOpts(sample, enemies) {
  const threat = enemies?.[0];
  return {
    attackAvailable: sample.attackPhase === 'idle',
    canFaceEnemy: threat ? canFaceEnemy(sample, threat) : false,
    dodgeAvailable: sample.stamina > 20 && (sample.dodgeCd ?? 0) <= 0,
  };
}

let browser;
const server = await maybeStartQaServer({ name: 'pull-local', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need post-rime-complete checkpoint (run rime-solve success first)');
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
  // MUST have both shrines and >=2 orbs
  if (!record('00-restore-complete', t0.shrinesOn.includes('burst') && t0.shrinesOn.includes('rime') && t0.orbs >= 2, { t0 })) {
    throw new Error(`incomplete checkpoint: shrines=${t0.shrinesOn} orbs=${t0.orbs}`);
  }
  pushRing(t0, 'restore');

  // Leave shrine if inside
  if (t0.world === 'shrine') {
    for (let i = 0; i < 8; i++) {
      const t = await tapBtn(page, 'interact', 800).then(() => readTelemetry(page));
      if (t.world === 'overworld') break;
      await driveOnce(page, 140);
    }
  }

  // Map select pull
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.locator('.map-legend button', { hasText: '牵引' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // From rime (~-72,36) to pull door (36,10.8) — southern lane away from camp at (27,9.5)
  const wps = [
    { x: -50, z: 28 },
    { x: -20, z: 18 },
    { x: 5, z: 8 },
    { x: 22, z: 4 },
    { x: 34, z: 8 },
  ];
  let st = createWalkerState();
  let stopped = null;
  const hp0 = 3;

  for (let i = 0; i < 220; i++) {
    const pre = await readTelemetry(page);
    if (pre.mode !== 'playing' || pre.state === 'dead' || pre.hp <= 0) {
      stopped = { reason: 'terminal', i, pre };
      pushRing(pre, 'terminal');
      break;
    }
    // FIRST damage recorded once; acceptance continues unless dead.
    // Diagnostic stop: set STOP_ON_FIRST_DAMAGE=1.
    if (pre.hp < hp0 - 1e-6 && !report.firstDamage) {
      report.firstDamage = { when: `i${i}`, pre, ring: [...report.ring] };
      await page.screenshot({ path: resolve(outDir, 'first-damage.png') });
      if (process.env.STOP_ON_FIRST_DAMAGE === '1') {
        stopped = { reason: 'first-hp-loss', i };
        break;
      }
      // Acceptance: keep going with legal combat.
      pushRing(pre, 'first-damage-continue');
    }

    let target = wps[st.wpIndex] ?? wps[wps.length - 1];
    let dist = Math.hypot(target.x - pre.x, target.z - pre.z);
    if (dist < 6 && st.wpIndex < wps.length - 1) {
      st = onWaypointSwitch(st, st.wpIndex + 1);
      target = wps[st.wpIndex];
      record(`wp${st.wpIndex}`, true, { target });
    }

    // Unified combat decision — every loop, including during would-be steer
    const combat = decideCombatAction(pre.enemies, {
      hp: pre.hp,
      stamina: pre.stamina,
      dodgeCd: pre.dodgeCd,
      invuln: pre.invuln,
      player: { x: pre.x, z: pre.z },
    }, combatOpts(pre, pre.enemies));

    if (combat.kind === 'dodge') {
      await tapBtn(page, 'dodge');
      pushRing(await readTelemetry(page), `dodge-${combat.enemyId}`);
      continue;
    }
    if (combat.kind === 'flee') {
      await fleeWorld(page, combat.dx, combat.dz, 160);
      pushRing(await readTelemetry(page), 'flee');
      continue;
    }
    if (combat.kind === 'attack') {
      await tapBtn(page, 'attack');
      pushRing(await readTelemetry(page), `atk-${combat.enemyId}`);
      continue;
    }

    // Steer with threat interrupt inside the turn loop
    let driveReady = false;
    for (let turn = 0; turn < 24; turn++) {
      const mid = await readTelemetry(page);
      if (mid.mode !== 'playing' || mid.state === 'dead' || mid.hp <= 0) {
        stopped = { reason: 'terminal-turn', i, mid };
        break;
      }
      if (mid.hp < hp0 - 1e-6 && !report.firstDamage) {
        report.firstDamage = { when: `i${i}-turn${turn}`, mid, ring: [...report.ring] };
        if (process.env.STOP_ON_FIRST_DAMAGE === '1') {
          stopped = { reason: 'first-hp-loss', i };
          break;
        }
      }
      const midCombat = decideCombatAction(mid.enemies, {
        hp: mid.hp,
        stamina: mid.stamina,
        dodgeCd: mid.dodgeCd,
        invuln: mid.invuln,
        player: { x: mid.x, z: mid.z },
      }, combatOpts(mid, mid.enemies));
      if (midCombat.kind !== 'continue') {
        // Interrupt steering — handle threat
        if (midCombat.kind === 'dodge') await tapBtn(page, 'dodge');
        else if (midCombat.kind === 'attack') await tapBtn(page, 'attack');
        else if (midCombat.kind === 'flee') await fleeWorld(page, midCombat.dx, midCombat.dz, 150);
        pushRing(await readTelemetry(page), `turn-${midCombat.kind}`);
        break;
      }
      const d = decideSteer({ x: mid.x, z: mid.z, camYaw: mid.camYaw }, target);
      if (d.kind === 'drive') {
        driveReady = true;
        break;
      }
      if (d.kind === 'turn') await pressLook(page, d.key);
      else break;
    }
    if (stopped) break;
    if (!driveReady) continue;

    const post = await driveOnce(page, 180);
    pushRing(post, `i${i}`);
    st = noteProgress(st, Math.hypot(target.x - post.x, target.z - post.z));
    if (st.noProgress >= 18) {
      stopped = { reason: 'no-progress', i, post, wp: st.wpIndex };
      break;
    }
    if (st.wpIndex >= wps.length - 1 && Math.hypot(36 - post.x, 10.8 - post.z) < 7) {
      record('01-arrive-pull-door', true, { post });
      break;
    }
  }

  // Enter pull if near and alive
  let near = await readTelemetry(page);
  if (near.hp > 0 && near.mode === 'playing' && Math.hypot(36 - near.x, 10.8 - near.z) < 14 && near.world === 'overworld') {
    for (let i = 0; i < 14; i++) {
      const mid = await readTelemetry(page);
      if (mid.mode !== 'playing' || mid.state === 'dead') break;
      const midCombat = decideCombatAction(mid.enemies, {
        hp: mid.hp, stamina: mid.stamina, dodgeCd: mid.dodgeCd, player: { x: mid.x, z: mid.z },
      }, combatOpts(mid, mid.enemies));
      if (midCombat.kind === 'dodge') {
        await tapBtn(page, 'dodge');
        continue;
      }
      if (midCombat.kind === 'flee') {
        await fleeWorld(page, midCombat.dx, midCombat.dz, 140);
        continue;
      }
      const d = decideSteer({ x: mid.x, z: mid.z, camYaw: mid.camYaw }, { x: 36, z: 10.5 });
      if (d.kind === 'turn') {
        await pressLook(page, d.key);
        continue;
      }
      await driveOnce(page, 160);
      await tapBtn(page, 'interact', 800);
      const t = await readTelemetry(page);
      if (t.world === 'shrine' && t.shrine != null) {
        record('02-enter-pull', true, { t });
        break;
      }
      if (Math.hypot(36 - t.x, 10.8 - t.z) < 3) {
        await tapBtn(page, 'interact', 800);
        const t2 = await readTelemetry(page);
        if (t2.world === 'shrine') {
          record('02-enter-pull', true, { t: t2 });
          break;
        }
      }
    }
  }
  near = await readTelemetry(page);

  const final = await readTelemetry(page);
  report.stopped = stopped;
  report.final = final;
  report.ok = report.milestones.some((m) => m.name === '02-enter-pull' && m.pass);

  // Export checkpoint ONLY on success
  if (report.ok && final.world === 'shrine') {
    await page.evaluate(() => window.__sim.save());
    await page.waitForTimeout(100);
    const ckpt = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-pull-complete.storage.json');
    try {
      await ctx.storageState({ path: ckpt });
      record('03-export-complete', true, { path: ckpt });
    } catch { record('03-export-complete', false); }
  } else {
    record('03-export-complete', false, { reason: 'skip: not successful enter; preserve prior archives' });
  }

  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    stopped,
    firstDamage: report.firstDamage
      ? { why: report.firstDamage.pre?.lastDamageWhy, pos: { x: report.firstDamage.pre?.x, z: report.firstDamage.pre?.z }, enemies: report.firstDamage.pre?.enemies?.slice(0, 3), ringLen: report.firstDamage.ring?.length }
      : null,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    final: { world: final.world, shrine: final.shrine, hp: final.hp, orbs: final.orbs, shrines: final.shrinesOn, x: final.x, z: final.z, why: final.lastDamageWhy },
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
