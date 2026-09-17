#!/usr/bin/env node
/** D12 tutorial skip + replay via real UI. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const outDir = resolve(repo, 'docs/astra-playability-20260916/evidence/headed', process.env.QA_RUN_ID || `d12-tut-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
const report = { ok: false, checks: [] };
let browser;
const server = await maybeStartQaServer({ name: 'd12-tut', kind: 'preview' });
try {
  browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false, timeout: 30000 });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sim));
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.mode === 'playing');
  await page.waitForTimeout(300);

  const tutBefore = await page.evaluate(() => window.__sim.tutorial);
  const skip = page.locator('.hint-skip');
  report.checks.push({ name: 'tutorial visible on start', pass: Boolean(tutBefore) || (await skip.count()) > 0, tutBefore });
  if ((await skip.count()) > 0) {
    await skip.click();
    await page.waitForTimeout(150);
    const tutAfter = await page.evaluate(() => window.__sim.tutorial);
    report.checks.push({ name: 'skip clears tutorial', pass: !tutAfter, tutAfter });
  }
  const replay = page.locator('.hud-tools button[aria-label="重播提示"]');
  if ((await replay.count()) > 0) {
    await replay.click({ force: true });
    await page.waitForTimeout(150);
    const tutReplay = await page.evaluate(() => window.__sim.tutorial);
    report.checks.push({ name: 'replay restores tutorial', pass: Boolean(tutReplay), tutReplay });
  } else {
    report.checks.push({ name: 'replay restores tutorial', pass: false, reason: 'no replay button' });
  }
  await page.screenshot({ path: resolve(outDir, 'tutorial.png') });
  report.ok = report.checks.every((c) => c.pass);
  writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, dir: outDir }));
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
