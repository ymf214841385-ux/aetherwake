#!/usr/bin/env node
/**
 * R24: citadel seal + 空王 from post-crown-from-mere (4 shrines + 3 towers).
 * Ordinary input. Gate path (6, 2) → courtyard; melee/dodge until bossDead.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';
import { decideSteer, createWalkerState, onWaypointSwitch, noteProgress, canFaceEnemyBody, worldToStickOffset } from '../../src/game/walk-steer.ts';
import { decideCombatAction } from '../../src/game/combat-threat.ts';
import { citadelGateApproachWaypoints } from '../../src/game/citadel-approach.ts';
import { decideBossFight, isInCourtyard } from '../../src/game/boss-combat.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-crown-from-mere.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `boss-from-crown-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], failure: null, errors: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };
// Citadel courtyard approach after seal
const GATE = { x: 6, z: 2 };

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    return {
      mode: s.mode,
      world: s.worldKind,
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
      bossDead: s.bossDead,
      sealOpen: typeof s.sealIsOpen === 'function' ? s.sealIsOpen() : null,
      prompt: s.prompt,
      attackPhase: s.attack?.phase ?? null,
      dodgeCd: +p.dodgeCd.toFixed(2),
      invuln: +p.invuln.toFixed(2),
      lastDamageWhy: s.lastDamageWhy || '',
      enemies: (s.enemies || []).filter((e) => e.alive).map((e) => ({
        id: e.id,
        kind: e.kind ?? null,
        d: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2),
        phase: e.brain?.phase ?? null,
        brainT: e.brain?.t ?? null,
        frozen: +(e.frozen ?? 0).toFixed(2),
        hp: e.hp,
        x: +e.x.toFixed(2),
        z: +e.z.toFixed(2),
        y: +e.y.toFixed(2),
        // Production meleeHit replica (boss +0.6 → HEAVY+boost)
        wouldMeleeHit: (() => {
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          const dz = e.z - p.z;
          if (Math.abs(dy) > 1.35) return false;
          const dist = Math.hypot(dx, dz);
          const range = 2.85 + 0.6;
          if (dist > range) return false;
          const fx = -Math.sin(s.cam.yaw);
          const fz = -Math.cos(s.cam.yaw);
          return (dx * fx + dz * fz) / (dist || 1) >= 0.72;
        })(),
      })).sort((a, b) => a.d - b.d).slice(0, 6),
      art: s.art,
    };
  });

async function steerDrive(page, tx, tz, maxTurns = 10) {
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

/** R26: look-only — never advances the body. */
async function lookOnly(page, key, ms = 40) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** R26: short stick move toward a world point (relative vector, not absolute xz). */
async function moveTowardPoint(page, tx, tz, camYaw, px, pz, ms = 140) {
  const dx = tx - px;
  const dz = tz - pz;
  if (Math.hypot(dx, dz) < 0.05) return;
  const off = worldToStickOffset({ x: dx, z: dz }, camYaw, 40);
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  if (!stick) return;
  const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + off.dx, cy + off.dy, { steps: 2 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

let browser;
const server = await maybeStartQaServer({ name: 'boss-from-crown', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need post-crown-from-mere');
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
  record('00-restore', t0.towers.length >= 3 && t0.shrinesOn.length >= 4 && t0.bossDead === false, { t0 });
  record('00b-seal-open', t0.sealOpen === true, { sealOpen: t0.sealOpen });

  // If restored on the crown cap with critical HP, respawn at the snow-line
  // fire first (ordinary death UI) so we do not walk off the mountain.
  if (t0.hp <= 1 && t0.y > 30) {
    // Simulate a careful fall-off is not allowed; use ordinary respawn after
    // intentional death is wrong. Instead walk a short hop down — if we die,
    // use the dead modal respawn.
    for (let i = 0; i < 12 && t0.y > 20; i++) {
      const t = await readTelemetry(page);
      if (t.state === 'dead') break;
      await steerDrive(page, 48, -120, 6);
    }
  }
  {
    let t = await readTelemetry(page);
    if (t.state === 'dead' || t.hp <= 0) {
      const btn = page.getByRole('button', { name: /篝火旁醒来|醒来/ });
      if ((await btn.count()) > 0) await btn.first().click();
      await page.waitForFunction(() => window.__sim?.mode === 'playing', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      t = await readTelemetry(page);
      record('00c-respawn-fire', t.state !== 'dead' && t.hp > 0, { t: { x: t.x, y: t.y, z: t.z, hp: t.hp } });
    }
  }

  // Map citadel (seal open → edge enabled)
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.waitForTimeout(150);
  await page.locator('.map-legend button', { hasText: '残堡' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // R25: outer-wall approach only. Never charge the boss through walls.
  // Arrival radius ~2.5 so we keep corner vertices.
  const ARRIVE = 2.5;
  let approachWps = citadelGateApproachWaypoints({ x: 6, z: -40 });
  let st = createWalkerState();
  let stopped = null;
  let firstDamage = null;
  let reseeded = false;
  for (let i = 0; i < 320; i++) {
    const mid = await readTelemetry(page);
    if (mid.mode !== 'playing' || mid.state === 'dead') {
      stopped = { reason: 'terminal', i, mid };
      break;
    }
    if (mid.hp < 3 && !firstDamage) {
      firstDamage = { i, hp: mid.hp, x: mid.x, z: mid.z, y: mid.y, why: mid.lastDamageWhy, enemies: mid.enemies?.slice(0, 3) };
      record('first-damage', true, firstDamage);
      await page.screenshot({ path: resolve(outDir, 'first-damage.png') }).catch(() => {});
    }
    // Reseed only when in the citadel south band (not on the crown plateau).
    if (!reseeded && mid.z > -40 && mid.z < -18 && Math.abs(mid.x - 6) < 40) {
      approachWps = citadelGateApproachWaypoints({ x: mid.x, z: mid.z });
      st = createWalkerState();
      reseeded = true;
      record('01-reseed-outer', true, { x: mid.x, z: mid.z, wps: approachWps });
    }
    let target = approachWps[st.wpIndex] ?? approachWps[approachWps.length - 1];
    if (Math.hypot(target.x - mid.x, target.z - mid.z) < ARRIVE && st.wpIndex < approachWps.length - 1) {
      st = onWaypointSwitch(st, st.wpIndex + 1);
      target = approachWps[st.wpIndex];
      record(`wp${st.wpIndex}`, true, { target });
    }
    // Courtyard: between front wall (z=-1) and keep south face (z≈-7)
    if (mid.z < -1.2 && mid.z > -7 && Math.abs(mid.x - 6) < 5) {
      record('01-enter-courtyard', true, { post: mid });
      break;
    }
    const combat = decideCombatAction(mid.enemies, {
      hp: mid.hp, stamina: mid.stamina, dodgeCd: mid.dodgeCd, player: { x: mid.x, z: mid.z },
    }, {
      attackAvailable: mid.attackPhase === 'idle' && mid.z < -1 && (mid.enemies?.[0]?.d ?? 99) < 2.8,
      canFaceEnemy: canFaceEnemyBody({ x: mid.x, z: mid.z, bodyYaw: mid.bodyYaw ?? mid.camYaw }, mid.enemies?.[0]),
      dodgeAvailable: mid.stamina > 20 && (mid.dodgeCd ?? 0) <= 0,
    });
    if (combat.kind === 'dodge') {
      const btn = page.locator('[data-touch-action="dodge"]');
      if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 350 }).catch(() => {});
      continue;
    }
    if (combat.kind === 'flee') {
      const off = worldToStickOffset({ x: combat.dx, z: combat.dz }, mid.camYaw, 40);
      const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
      if (stick) {
        const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + off.dx, cy + off.dy, { steps: 2 });
        await page.waitForTimeout(140);
        await page.mouse.up();
      }
      continue;
    }
    await steerDrive(page, target.x, target.z, 10);
    const post = await readTelemetry(page);
    st = noteProgress(st, Math.hypot(target.x - post.x, target.z - post.z));
    if (st.noProgress >= 16) {
      stopped = { reason: 'no-progress', i, post, wp: st.wpIndex, target };
      record('01-enter-courtyard', false, { stopped });
      break;
    }
  }

  // Boss fight only after a real courtyard entry.
  // R26: decideBossFight — look-only vs move split; threats outrank re-entry.
  const atGate = report.milestones.some((m) => m.name === '01-enter-courtyard' && m.pass);
  const fightRing = [];
  if (atGate) {
    let prevHp = null;
    let stillUsed = false;
    for (let i = 0; i < 240; i++) {
      const t = await readTelemetry(page);
      if (t.mode !== 'playing' || t.state === 'dead') {
        // Victory modal is mode=ending (not playing) with bossDead and alive.
        // Do not misclassify that as a combat death.
        const won = t.bossDead === true && t.state !== 'dead' && (t.hp == null || t.hp > 0);
        report.fightTerminal = {
          i,
          via: won ? 'win-terminal' : (t.state === 'dead' ? 'death' : `mode-${t.mode}`),
          mode: t.mode,
          state: t.state,
          hp: t.hp,
          bossDead: t.bossDead,
          ring: fightRing.slice(-12),
        };
        delete report.fightDeath;
        if (t.bossDead) {
          record('02-boss-dead', true, { i, via: won ? 'win-terminal' : 'terminal-after-kill', mode: t.mode, state: t.state, hp: t.hp });
        }
        break;
      }
      if (t.bossDead) {
        record('02-boss-dead', true, { i, hp: t.hp, ringTail: fightRing.slice(-6) });
        break;
      }
      if (prevHp != null && t.hp < prevHp) {
        record('02a-player-hp-drop', true, { i, from: prevHp, to: t.hp, why: t.lastDamageWhy, ring: fightRing.slice(-4) });
      }
      prevHp = t.hp;
      const boss = t.enemies?.find((e) => e.id === 'boss' || e.kind === 'boss') ?? null;
      const stillReady = !stillUsed || (boss && (boss.frozen ?? 0) <= 0.15);
      const action = decideBossFight({
        player: {
          x: t.x,
          z: t.z,
          camYaw: t.camYaw,
          bodyYaw: t.bodyYaw,
          hp: t.hp,
          stamina: t.stamina,
          invuln: t.invuln,
          dodgeCd: t.dodgeCd,
          attackPhase: t.attackPhase,
        },
        boss: boss
          ? { id: boss.id, d: boss.d, phase: boss.phase, x: boss.x, z: boss.z, hp: boss.hp, brainT: boss.brainT, frozen: boss.frozen }
          : null,
        inCourtyard: isInCourtyard(t.x, t.z),
        courtyardAnchor: { x: 6, z: -3 },
        stillReady: Boolean(stillReady && t.orbs >= 4),
        canMeleeHit: boss ? boss.wouldMeleeHit === true : undefined,
      });
      const sample = {
        i,
        act: action.kind,
        why: action.reason,
        hp: t.hp,
        stam: t.stamina,
        yaw: t.camYaw,
        invuln: t.invuln,
        dodgeCd: t.dodgeCd,
        atk: t.attackPhase,
        art: t.art,
        d: boss?.d ?? null,
        phase: boss?.phase ?? null,
        brainT: boss?.brainT ?? null,
        frozen: boss?.frozen ?? null,
        bossHp: boss?.hp ?? null,
        bossY: boss?.y ?? null,
        bossX: boss?.x ?? null,
        bossZ: boss?.z ?? null,
        wouldHit: boss?.wouldMeleeHit ?? null,
        x: t.x,
        y: t.y,
        z: t.z,
      };
      fightRing.push(sample);
      if (fightRing.length > 40) fightRing.shift();

      if (action.kind === 'freeze') {
        // Digit5 → art slot 4, then ordinary art (touch button or KeyF).
        await page.keyboard.press('Digit5');
        await page.waitForTimeout(40);
        const artBtn = page.locator('[data-touch-action="art"]');
        if (await artBtn.isVisible().catch(() => false)) {
          await artBtn.tap({ timeout: 300 }).catch(() => {});
        } else {
          await page.keyboard.press('KeyF');
        }
        stillUsed = true;
        await page.waitForTimeout(120);
        const after = await readTelemetry(page);
        const bAfter = after.enemies?.find((e) => e.id === 'boss' || e.kind === 'boss');
        record('02b-still-freeze', (bAfter?.frozen ?? 0) > 0.5, {
          frozen: bAfter?.frozen ?? 0,
          phase: bAfter?.phase ?? null,
          bossHp: bAfter?.hp ?? null,
          d: bAfter?.d ?? null,
          toast: after.prompt,
        });
        continue;
      }
      if (action.kind === 'dodge') {
        const btn = page.locator('[data-touch-action="dodge"]');
        if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 280 }).catch(() => {});
        continue;
      }
      if (action.kind === 'look') {
        await lookOnly(page, action.key, 70);
        continue;
      }
      if (action.kind === 'move') {
        await moveTowardPoint(page, action.tx, action.tz, t.camYaw, t.x, t.z, 130);
        continue;
      }
      if (action.kind === 'attack') {
        // Single ordinary input — observe windup→active; do not double-tap.
        const btn = page.locator('[data-touch-action="attack"]');
        if (await btn.isVisible().catch(() => false)) await btn.tap({ timeout: 260 }).catch(() => {});
        await page.waitForTimeout(220);
        continue;
      }
      await page.waitForTimeout(80);
    }
  }

  const final = await readTelemetry(page);
  await page.screenshot({ path: resolve(outDir, 'boss-final.png') });
  writeFileSync(resolve(outDir, 'fight-ring.json'), JSON.stringify(fightRing, null, 2) + '\n');
  if (!report.milestones.some((m) => m.name === '02-boss-dead')) {
    record('02-boss-dead', final.bossDead === true, { final: { bossDead: final.bossDead, hp: final.hp, x: final.x, z: final.z }, stopped, fightDeath: report.fightDeath, ringTail: fightRing.slice(-8) });
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  const cont = page.getByRole('button', { name: /继续/ });
  if ((await cont.count()) > 0) await cont.first().click();
  await page.waitForTimeout(400);
  const after = await readTelemetry(page);
  record('03-reload-boss', after.bossDead === true && after.towers.length >= 3 && after.shrinesOn.length >= 4, {
    after: { bossDead: after.bossDead, towers: after.towers, shrines: after.shrinesOn, orbs: after.orbs },
  });

  report.ok = report.milestones.some((m) => m.name === '02-boss-dead' && m.pass)
    && report.milestones.some((m) => m.name === '03-reload-boss' && m.pass);
  if (report.ok) {
    const ckpt = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-boss-from-crown.storage.json');
    const meta = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-boss-from-crown.meta.json');
    try {
      await ctx.storageState({ path: ckpt });
      writeFileSync(meta, JSON.stringify({
        source: 'boss-from-crown.mjs',
        sourceCheckpoint: 'post-crown-from-mere.storage.json',
        progressAtExport: {
          shrines: ['burst', 'rime', 'pull', 'still'],
          towers: ['dawn', 'mere', 'crown'],
          bossDead: true,
          note: 'natural chain four-shrine + three-tower + seal + boss; no splice',
        },
        pid: process.pid,
        exportedAt: new Date().toISOString(),
      }, null, 2) + '\n');
      record('04-export', true, { path: ckpt });
    } catch { record('04-export', false); }
  } else {
    report.failure = { stopped, final, fightDeath: report.fightDeath };
  }
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    milestones: report.milestones.map((m) => ({ n: m.name, p: m.pass })),
    final: { bossDead: final.bossDead, towers: final.towers, shrines: final.shrinesOn, hp: final.hp, x: final.x, z: final.z },
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
