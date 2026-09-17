#!/usr/bin/env node
/**
 * Headed check: overworld HUD shows approximate bearing (not developer jargon),
 * and navigation snapshot is empty on overworld after start.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `m3-hud-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, pid: process.pid, checks: [], errors: [] };
let browser;
const server = await maybeStartQaServer({ name: 'm3-hud', kind: 'preview' });
assert.ok(server.ok, server.error);
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(String(e.message)));
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForTimeout(600);
  const snap = await page.evaluate(() => {
    const s = window.__sim;
    const t = s.trackedObjective();
    const nav = s.navigationSnapshot();
    const hudText = document.querySelector('.objective')?.innerText || '';
    return {
      phase: t.phase,
      routeStatus: t.routeStatus,
      next: t.nextAction,
      navWorld: nav.worldId,
      navSegs: nav.segments.length,
      hudText,
      hasDevJargon: /未验证走廊|approximate/.test(hudText),
      hasPlayerGuidance: /方向估计|前往|尚未找到|爆鸣|霜息|牵引|凝时/.test(hudText) || hudText.length > 0,
    };
  });
  report.snap = snap;
  report.checks.push({
    name: 'overworld nav honest',
    pass: snap.navWorld === 'overworld' && snap.navSegs >= 0 && !snap.hasDevJargon,
  });
  report.checks.push({ name: 'no developer jargon in objective UI', pass: !snap.hasDevJargon });
  report.checks.push({ name: 'objective text present', pass: snap.hasPlayerGuidance });
  await page.screenshot({ path: resolve(outDir, 'overworld-hud.png') });
  report.ok = report.checks.every((c) => c.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, snap, dir: outDir }));
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
