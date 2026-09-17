#!/usr/bin/env node
/**
 * R13 damage-probe: restore burst checkpoint, walk toward rime ONLY until first HP loss.
 * Terminal guard before every input. Ring buffer of full telemetry.
 * No HP/invuln/enemy writes.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptPath = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-dawn.storage.json');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `damage-probe-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const RING = 40;
const report = {
  ok: false,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  firstDamage: null,
  terminal: null,
  ring: [],
  milestones: [],
  errors: [],
};
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d }); return p; };

const readTelemetry = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const support = (() => {
      // Readonly: nearest climbable + prompt already; enemies nearby
      const enemies = (s.enemies || [])
        .filter((e) => e.alive)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          x: +e.x.toFixed(2),
          y: +e.y.toFixed(2),
          z: +e.z.toFixed(2),
          d: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2),
          phase: e.brain?.phase ?? null,
        }))
        .filter((e) => e.d < 25)
        .sort((a, b) => a.d - b.d)
        .slice(0, 5);
      return enemies;
    })();
    return {
      t: +s.t.toFixed(3),
      mode: s.mode,
      world: s.worldKind,
      hp: p.hp,
      invuln: p.invuln,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      vx: +p.vx.toFixed(3),
      vy: +p.vy.toFixed(3),
      vz: +p.vz.toFixed(3),
      state: p.state,
      grounded: p.grounded,
      stamina: +p.stamina.toFixed(1),
      camYaw: +s.cam.yaw.toFixed(3),
      lastDamageWhy: s.lastDamageWhy || '',
      lastDamageAt: s.lastDamageAt || 0,
      prompt: s.prompt,
      enemies: support,
      orbs: s.orbs,
      shrinesOn: [...s.shrinesOn],
      towers: [...s.towersOn],
    };
  });

function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const pushRing = (ring, sample, tag) => {
  ring.push({ tag, ...sample });
  if (ring.length > RING) ring.shift();
};

let browser;
const server = await maybeStartQaServer({ name: 'damage-probe', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  assert.ok(existsSync(ckptPath), 'need burst checkpoint');
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

  const hasSave = await page.evaluate(() => Boolean(localStorage.getItem('aetherwake-save-v2')));
  assert.ok(hasSave, 'checkpoint save missing');
  await page.getByRole('button', { name: /继续/ }).first().click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForTimeout(250);

  const t0 = await readTelemetry(page);
  record('00-restore', t0.shrinesOn.includes('burst') && t0.orbs >= 1 && t0.hp > 0, { t0 });
  pushRing(report.ring, t0, 'restore');
  const hp0 = t0.hp;

  // Map select rime
  await page.locator('[data-touch-action="map"]').tap();
  await page.waitForFunction(() => window.__sim?.mode === 'map');
  await page.locator('.map-legend button', { hasText: '霜息' }).click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => window.__sim.mode === 'paused')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sim?.mode === 'playing');

  // Waypoints north of camp-a brambles (damage-probe1: enemy at 55,56).
  const wps = [
    { x: 32, z: 86 },
    { x: 47, z: 75 },
    { x: 58, z: 70 },
    { x: 72, z: 60 },
    { x: 88, z: 48 },
    { x: -40, z: 40 },
    { x: -72, z: 38.8 },
  ];
  let wpI = 0;
  const tx = wps[0].x, tz = wps[0].z;
  let noProgress = 0;
  let prevDist = Infinity;
  let stopped = null;

  for (let i = 0; i < 160; i++) {
    const pre = await readTelemetry(page);
    if (pre.mode !== 'playing' || pre.state === 'dead' || pre.hp <= 0) {
      stopped = { reason: 'terminal-before-input', i, pre };
      report.terminal = stopped;
      pushRing(report.ring, pre, 'terminal');
      break;
    }
    if (pre.hp < hp0 - 1e-6) {
      stopped = { reason: 'hp-loss-detected', i, pre };
      report.firstDamage = { when: 'pre-input', pre, ring: [...report.ring] };
      break;
    }

    // Advance waypoint
    let target = wps[wpI] ?? wps[wps.length - 1];
    let d = Math.hypot(target.x - pre.x, target.z - pre.z);
    while (wpI < wps.length - 1 && d < 8) {
      wpI += 1;
      target = wps[wpI];
      d = Math.hypot(target.x - pre.x, target.z - pre.z);
      record(`wp-${wpI}`, true, { target });
    }

    const desired = Math.atan2(-(target.x - pre.x), -(target.z - pre.z));
    const err = angDiff(desired, pre.camYaw);
    if (Math.abs(err) > 0.3) {
      const key = err > 0 ? 'ArrowLeft' : 'ArrowRight';
      await page.keyboard.down(key);
      await page.waitForTimeout(30);
      await page.keyboard.up(key);
    }

    // Legal combat: dodge when threatened, attack when enemy is in melee range.
    const threat = pre.enemies?.find((e) => e.d < 3.5 && ['windup', 'strike', 'approach', 'recover', 'detect'].includes(e.phase));
    if (threat) {
      if (threat.d < 2.6) {
        const atk = page.locator('[data-touch-action="attack"]');
        if ((await atk.count()) > 0 && (await atk.isVisible().catch(() => false))) {
          await atk.tap({ timeout: 400 }).catch(() => {});
          pushRing(report.ring, await readTelemetry(page), `atk-${threat.id}`);
        }
      } else {
        const dodge = page.locator('[data-touch-action="dodge"]');
        if ((await dodge.count()) > 0 && (await dodge.isVisible().catch(() => false))) {
          await dodge.tap({ timeout: 400 }).catch(() => {});
          pushRing(report.ring, await readTelemetry(page), `dodge-${threat.id}`);
        }
      }
    }

    const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
    const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 44, { steps: 3 });
    await page.waitForTimeout(200);
    await page.mouse.up();

    const post = await readTelemetry(page);
    pushRing(report.ring, post, `i${i}`);

    if (post.hp < hp0 - 1e-6) {
      report.firstDamage = {
        when: `i${i}`,
        hp0,
        hp: post.hp,
        lastDamageWhy: post.lastDamageWhy,
        lastDamageAt: post.lastDamageAt,
        pos: { x: post.x, y: post.y, z: post.z },
        vy: post.vy,
        state: post.state,
        grounded: post.grounded,
        enemies: post.enemies,
        ring: [...report.ring],
        preSample: pre,
        wpI,
      };
      stopped = { reason: 'first-hp-loss', i };
      await page.screenshot({ path: resolve(outDir, 'first-damage.png') });
      break;
    }
    if (post.state === 'dead' || post.mode !== 'playing') {
      stopped = { reason: 'terminal-after-input', i, post };
      report.terminal = stopped;
      break;
    }

    const nd = Math.hypot(target.x - post.x, target.z - post.z);
    if (nd > prevDist - 0.05) noProgress += 1;
    else noProgress = 0;
    prevDist = nd;
    if (noProgress >= 14) {
      stopped = { reason: 'no-progress', i, post, d: +nd.toFixed(1), wpI };
      report.noProgress = stopped;
      break;
    }
    if (wpI >= wps.length - 1 && nd < 6) {
      record('02-arrive-near-rime', true, { post });
      break;
    }
  }

  const final = await readTelemetry(page);
  report.final = final;
  report.ok = Boolean(report.firstDamage) && report.firstDamage.hp < hp0;
  report.stopped = stopped;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: report.ok,
    stopped,
    firstDamage: report.firstDamage
      ? {
          hp0: report.firstDamage.hp0,
          hp: report.firstDamage.hp,
          why: report.firstDamage.lastDamageWhy,
          pos: report.firstDamage.pos,
          state: report.firstDamage.state,
          enemies: report.firstDamage.enemies,
          ringLen: report.firstDamage.ring?.length,
        }
      : null,
    final: { hp: final.hp, state: final.state, x: final.x, z: final.z, why: final.lastDamageWhy },
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
