#!/usr/bin/env node
/**
 * A02/A03/A07 bounded orientation: eight stick dirs × several cam yaws; turn/idle; bow.
 * Native stick/look/bow only. Readonly align = face·velocity/|v|.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `orient-a02-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, samples: [], errors: [] };

const sample = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const p = s.player;
    const spd = Math.hypot(p.vx, p.vz);
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const align = spd > 0.4 ? (fx * p.vx + fz * p.vz) / spd : 0;
    return { spd, align, yaw: p.yaw, camYaw: s.cam.yaw, vx: p.vx, vz: p.vz, state: p.state, aiming: p.aiming };
  });

async function stickVec(page, dx, dy, ms = 350) {
  const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
  await page.waitForTimeout(ms);
  const t = await sample(page);
  await page.mouse.up();
  await page.waitForTimeout(100);
  return t;
}

let browser;
const server = await maybeStartQaServer({ name: 'orient-a02', kind: 'preview' });
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForFunction(() => window.__AW_CHARACTER_LOAD?.status === 'ready', { timeout: 20000 });
  await page.waitForTimeout(250);

  // A02: 4 camera yaws × 8 stick dirs (N/NE/E/SE/S/SW/W/NW) = 32 samples
  const camYaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const dirs = [
    { name: 'fwd', dx: 0, dy: -40 },
    { name: 'fwd-right', dx: 28, dy: -28 },
    { name: 'right', dx: 40, dy: 0 },
    { name: 'back-right', dx: 28, dy: 28 },
    { name: 'back', dx: 0, dy: 40 },
    { name: 'back-left', dx: -28, dy: 28 },
    { name: 'left', dx: -40, dy: 0 },
    { name: 'fwd-left', dx: -28, dy: -28 },
  ];
  let allAlignOk = true;
  for (let ci = 0; ci < camYaws.length; ci++) {
    await page.evaluate((y) => {
      window.__sim.cam.yaw = y;
    }, camYaws[ci]);
    for (const d of dirs) {
      const t = await stickVec(page, d.dx, d.dy, 380);
      const pass = t.spd > 0.35 && t.align > 0.85;
      if (!pass) allAlignOk = false;
      report.samples.push({ cam: ci, dir: d.name, pass, ...t });
    }
  }
  report.checks = report.checks || [];
  report.checks.push({ name: 'A02 four-cam × eight-dir align', pass: allAlignOk, sampleCount: report.samples.length });

  // A03: idle after release — allow brief settle
  await page.waitForTimeout(200);
  const idle1 = await sample(page);
  await page.waitForTimeout(500);
  const idle2 = await sample(page);
  report.checks.push({
    name: 'A03 idle settles',
    pass: idle2.spd < 0.2 && idle1.spd < 0.5,
    idle1: { spd: idle1.spd },
    idle2: { spd: idle2.spd },
  });

  // A03 turn: stick left then right, check no NaN yaw
  const tL = await stickVec(page, -40, 0, 300);
  const tR = await stickVec(page, 40, 0, 300);
  report.checks.push({
    name: 'A03 turn finite yaw',
    pass: Number.isFinite(tL.yaw) && Number.isFinite(tR.yaw),
  });

  // A07 bow via dedicated touch bow button (not KeyQ alone)
  const bowBtn = page.locator('[data-touch-action="bow"]');
  if ((await bowBtn.count()) > 0 && (await bowBtn.isVisible().catch(() => false))) {
    await bowBtn.tap().catch(() => {});
  } else {
    await page.keyboard.press('KeyQ');
  }
  await page.waitForTimeout(120);
  const aim = await sample(page);
  const strafe = await stickVec(page, 36, 0, 350);
  if ((await bowBtn.count()) > 0 && (await bowBtn.isVisible().catch(() => false))) {
    await bowBtn.tap().catch(() => {});
  } else {
    await page.keyboard.press('KeyQ');
  }
  await page.waitForTimeout(120);
  const after = await sample(page);
  report.checks.push({
    name: 'A07 bow strafe finite + release',
    pass: Number.isFinite(strafe.align) && Number.isFinite(after.yaw) && after.aiming === false,
    aim: { aiming: aim.aiming, spd: aim.spd },
    strafe: { spd: strafe.spd, align: strafe.align },
    after: { aiming: after.aiming, spd: after.spd },
  });

  await page.screenshot({ path: resolve(outDir, 'a02-final.png') });
  report.ok = report.checks.every((c) => c.pass) && report.errors.filter((e) => !/pointer lock/i.test(e)).length === 0;
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failedSamples: report.samples.filter((s) => !s.pass).length, dir: outDir }));
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
