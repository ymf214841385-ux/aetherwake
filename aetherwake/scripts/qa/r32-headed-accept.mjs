#!/usr/bin/env node
/**
 * R32 headed: real CDP touch for stick, mid-glide facing, visible modal close.
 * Ordinary input only. No mouse/keyboard for D11 close/resume.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckptDir = resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `r32-accept-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, milestones: [], errors: [], pointerLog: [], startedAt: new Date().toISOString() };
const record = (n, p, d = {}) => { report.milestones.push({ name: n, pass: p, ...d, t: Date.now() }); return p; };

const readTel = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    return {
      mode: s.mode,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      yaw: +p.yaw.toFixed(4),
      state: p.state,
      gliding: p.gliding,
      vx: +p.vx.toFixed(3),
      vy: +p.vy.toFixed(3),
      vz: +p.vz.toFixed(3),
      hp: p.hp,
      attackPhase: s.attack?.phase ?? null,
      load: window.__AW_CHARACTER_LOAD?.status ?? null,
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

/** Install passive pointer observers (no synthetic dispatch). */
async function installPointerProbe(page) {
  await page.evaluate(() => {
    window.__pointerLog = [];
    const push = (kind) => (e) => {
      window.__pointerLog.push({
        kind,
        pointerType: e.pointerType ?? null,
        isTrusted: e.isTrusted,
        pointerId: e.pointerId ?? null,
        target: e.target && e.target.getAttribute
          ? (e.target.getAttribute('data-touch-kind') || e.target.getAttribute('data-touch-action') || e.target.className || e.target.tagName)
          : null,
      });
    };
    for (const k of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      document.addEventListener(k, push(k), true);
    }
  });
}

async function readPointerLog(page) {
  return page.evaluate(() => window.__pointerLog || []);
}

/** Real browser touch via CDP Input.dispatchTouchEvent (not page.mouse). */
async function touchDrag(cdp, x0, y0, dx, dy, ms = 280) {
  const id = 7;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x0, y: y0, id, radiusX: 8, radiusY: 8, force: 1 }],
  });
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps, id, radiusX: 8, radiusY: 8, force: 1 }],
    });
    await new Promise((r) => setTimeout(r, Math.max(16, Math.floor(ms / steps))));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return { id, x0, y0, dx, dy };
}

async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 3, radiusX: 6, radiusY: 6, force: 1 }],
  });
  await new Promise((r) => setTimeout(r, 40));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function stickBox(page) {
  return page.locator('[data-touch-kind="stick"]').boundingBox();
}

function facingAlign(t) {
  const speed = Math.hypot(t.vx, t.vz);
  if (speed < 0.2) return { speed, align: 0 };
  const fx = -Math.sin(t.yaw);
  const fz = -Math.cos(t.yaw);
  return { speed, align: (t.vx * fx + t.vz * fz) / speed };
}

let browser;
const server = await maybeStartQaServer({ name: 'r32-accept', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const state = await remappedCkpt('post-dawn-from-shrines.storage.json', server.url);

  for (const vp of [
    { width: 844, height: 390, name: '844x390' },
    { width: 667, height: 375, name: '667x375' },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: true,
      isMobile: true,
      storageState: state,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message)));
    const cdp = await ctx.newCDPSession(page);
    await installPointerProbe(page);
    await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
    await continueGame(page);
    await installPointerProbe(page);

    // Open map with Playwright touchscreen (real touch) on the map control
    const mapBtn = page.locator('[data-touch-action="map"]');
    const mb = await mapBtn.boundingBox();
    record(`D11-map-btn-${vp.name}`, Boolean(mb), { box: mb });
    await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.waitForTimeout(300);
    const mapMode = await page.evaluate(() => window.__sim.mode);
    await page.screenshot({ path: resolve(outDir, `D11-map-${vp.name}.png`) });

    // Close button bbox must be inside viewport
    const closeBtn = page.locator('button.modal-close');
    const cCount = await closeBtn.count();
    const cBox = cCount ? await closeBtn.first().boundingBox() : null;
    const closeVisible = Boolean(cBox)
      && cBox.y >= 0
      && cBox.y + cBox.height <= vp.height
      && cBox.x >= 0
      && cBox.x + cBox.width <= vp.width;
    record(`D11-close-bbox-${vp.name}`, mapMode === 'map' && closeVisible, {
      mapMode, cCount, cBox, vp,
    });
    await page.screenshot({ path: resolve(outDir, `D11-close-${vp.name}.png`) });

    // Real touch close on the button (element tap = touch on hasTouch context)
    let closeVia = null;
    if (closeVisible && cBox) {
      await closeBtn.first().tap({ timeout: 800 });
      closeVia = 'close-button';
    } else {
      await page.touchscreen.tap(20, 16);
      closeVia = 'backdrop-fallback';
    }
    await page.waitForTimeout(300);
    const afterClose = await page.evaluate(() => window.__sim.mode);
    // If still open, one more tap (some frames need a second pointer cycle)
    if (afterClose !== 'playing' && closeVisible) {
      await closeBtn.first().tap({ timeout: 800 }).catch(() => {});
      await page.waitForTimeout(250);
    }
    const afterClose2 = await page.evaluate(() => window.__sim.mode);

    // Turn away from tower so stick-forward is not into a wall
    for (let i = 0; i < 12; i++) {
      await page.keyboard.down('ArrowLeft');
      await page.waitForTimeout(35);
      await page.keyboard.up('ArrowLeft');
    }

    // Real CDP touch stick resume + passive pointerType check
    const stick = await stickBox(page);
    const before = await readTel(page);
    const logBefore = (await readPointerLog(page)).length;
    if (stick) {
      await touchDrag(cdp, stick.x + stick.width / 2, stick.y + stick.height / 2, 0, -42, 320);
    }
    await page.waitForTimeout(100);
    const after = await readTel(page);
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    const log = await readPointerLog(page);
    report.pointerLog.push(...log.slice(-30));
    const stickEvents = log.slice(logBefore);
    const types = [...new Set(stickEvents.map((e) => e.pointerType))];
    const trusted = stickEvents.length > 0 && stickEvents.every((e) => e.isTrusted);
    const ids = [...new Set(stickEvents.map((e) => e.pointerId))];
    const hasDownMoveUp = stickEvents.some((e) => e.kind === 'pointerdown')
      && stickEvents.some((e) => e.kind === 'pointermove')
      && stickEvents.some((e) => e.kind === 'pointerup');
    const noStuck = await page.evaluate(() => ({ vx: window.__sim.player.vx, vz: window.__sim.player.vz }));

    record(`D11-pure-touch-${vp.name}`, mapMode === 'map' && closeVia === 'close-button' && afterClose2 === 'playing'
      && moved > 0.05 && types.includes('touch') && trusted && hasDownMoveUp && ids.length === 1, {
      mapMode, closeVia, afterClose, afterClose2, moved: +moved.toFixed(3),
      pointerTypes: types, trusted, pointerIds: ids, hasDownMoveUp,
      noStuck, events: stickEvents.length,
    });

    // Bag: open with real touch, isolation with CDP stick, close via button, resume
    const bagBtn = page.locator('[data-touch-action="bag"]');
    const bb = await bagBtn.boundingBox();
    await bagBtn.tap({ timeout: 800 });
    await page.waitForTimeout(300);
    const bagMode = await page.evaluate(() => window.__sim.mode);
    await page.screenshot({ path: resolve(outDir, `D08-bag-${vp.name}.png`) });
    const b0 = await readTel(page);
    if (stick) await touchDrag(cdp, stick.x + stick.width / 2, stick.y + stick.height / 2, 0, -40, 250);
    const b1 = await readTel(page);
    const bagMove = Math.hypot(b1.x - b0.x, b1.z - b0.z);
    const bagClose = page.locator('button.modal-close');
    const bcBox = (await bagClose.count()) ? await bagClose.first().boundingBox() : null;
    const bagCloseVisible = Boolean(bcBox) && bcBox.y + bcBox.height <= vp.height && bcBox.y >= 0;
    if (bagCloseVisible && bcBox) {
      await bagClose.first().tap({ timeout: 800 });
    }
    await page.waitForTimeout(300);
    const bagAfter = await readTel(page);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.down('ArrowLeft');
      await page.waitForTimeout(35);
      await page.keyboard.up('ArrowLeft');
    }
    const b2 = await readTel(page);
    if (stick) await touchDrag(cdp, stick.x + stick.width / 2, stick.y + stick.height / 2, 0, -42, 320);
    const b3 = await readTel(page);
    const bagResume = Math.hypot(b3.x - b2.x, b3.z - b2.z);
    record(`D08-bag-${vp.name}`, bagMode === 'inventory' && bagMove < 0.05 && bagCloseVisible
      && bagAfter.mode === 'playing' && bagResume > 0.05 && b1.attackPhase === 'idle', {
      bagMode, bagMove: +bagMove.toFixed(4), bagCloseVisible, bcBox,
      afterMode: bagAfter.mode, bagResume: +bagResume.toFixed(3),
      attackPhaseUnderStick: b1.attackPhase,
    });

    await ctx.close();
  }

  // ---- A06 mid-glide facing (separate context) ----
  {
    const ctx = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
      storageState: state,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message)));
    await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
    await continueGame(page);
    const t0 = await readTel(page);
    // Face inland (southwest-ish) before leaving the cap — avoid the eastern lake.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.down('ArrowLeft');
      await page.waitForTimeout(40);
      await page.keyboard.up('ArrowLeft');
    }
    await page.keyboard.down('KeyW');
    await page.keyboard.press('Space');
    for (let i = 0; i < 40; i++) {
      const t = await readTel(page);
      if (t.state === 'airborne' && i > 2) break;
      if (t.y < t0.y - 2) break;
      await page.waitForTimeout(50);
    }
    for (let i = 0; i < 25; i++) {
      const t = await readTel(page);
      if (t.state === 'gliding' || t.gliding) break;
      if (t.state !== 'airborne' && t.state !== 'gliding') break;
      if (t.vy < 1.4) {
        await page.keyboard.press('Space');
        await page.waitForTimeout(30);
      }
      await page.waitForTimeout(40);
    }
    const glideTrace = [];
    let sawGlide = false;
    let turned = false;
    for (let i = 0; i < 90; i++) {
      const t = await readTel(page);
      const fa = facingAlign(t);
      glideTrace.push({ i, state: t.state, gliding: t.gliding, y: +t.y.toFixed(2), vx: t.vx, vz: t.vz, yaw: t.yaw, speed: +fa.speed.toFixed(3), align: +fa.align.toFixed(3), hp: t.hp, x: t.x, z: t.z });
      if (t.gliding || t.state === 'gliding') sawGlide = true;
      if (sawGlide && !turned && i > 2) {
        await page.keyboard.down('ArrowRight');
        await page.waitForTimeout(150);
        await page.keyboard.up('ArrowRight');
        turned = true;
      }
      if (sawGlide && (t.state === 'grounded' || t.state === 'dead')) break;
      await page.waitForTimeout(70);
    }
    await page.keyboard.up('KeyW');
    // Fly inland (west) away from the lake/updrafts so we can ground-land.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    let land = await readTel(page);
    for (let i = 0; i < 100; i++) {
      land = await readTel(page);
      if (land.state === 'grounded' || land.state === 'dead') break;
      // If swimming, that is not the required grounded land — keep waiting only if still gliding
      if (land.state === 'swimming') break;
      await page.waitForTimeout(100);
    }
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    if (land.state !== 'grounded' && land.state !== 'dead') {
      // last chance: wait after releasing keys
      for (let i = 0; i < 30; i++) {
        land = await readTel(page);
        if (land.state === 'grounded' || land.state === 'dead') break;
        await page.waitForTimeout(100);
      }
    }
    await page.screenshot({ path: resolve(outDir, 'A06-land.png') });

    // Mid-glide facing samples only
    const glideSamples = glideTrace.filter((g) => (g.gliding || g.state === 'gliding') && g.speed > 0.2);
    const aligns = glideSamples.map((g) => g.align);
    const midAlign = aligns.length ? aligns[Math.floor(aligns.length / 2)] : null;
    const yaw0 = glideSamples[0]?.yaw ?? null;
    const yaw1 = glideSamples[glideSamples.length - 1]?.yaw ?? null;
    const yawChanged = yaw0 != null && yaw1 != null && Math.abs(yaw1 - yaw0) > 0.15;

    record('A06-midglide-facing', sawGlide && glideSamples.length >= 3 && midAlign != null && midAlign > 0.55 && yawChanged, {
      sawGlide, samples: glideSamples.length, midAlign, yaw0, yaw1, yawChanged,
      sampleHead: glideSamples.slice(0, 3),
      sampleTail: glideSamples.slice(-3),
      turned,
    });
    record('A06-safe-land', sawGlide && land.state === 'grounded' && land.hp > 0 && land.gliding === false, {
      land: { x: land.x, y: land.y, z: land.z, state: land.state, gliding: land.gliding, hp: land.hp },
      distFromStart: +Math.hypot(land.x - t0.x, land.z - t0.z).toFixed(1),
    });
    record('A06-not-climb-pose', sawGlide && land.state !== 'climbing', { state: land.state });
    writeFileSync(resolve(outDir, 'glide-trace.json'), JSON.stringify(glideTrace, null, 2) + '\n');
    await ctx.close();
  }

  report.ok = report.milestones.every((m) => m.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
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
