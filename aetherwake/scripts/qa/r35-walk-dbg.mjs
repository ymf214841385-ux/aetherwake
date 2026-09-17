import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkedUrl } from '../browser-guard.mjs';
import { maybeStartQaServer, qaChromiumLaunchOptions, stopOwnedServer } from './lifecycle.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const ckpt = JSON.parse(readFileSync(resolve(repo, 'docs/astra-playability-20260916/evidence/checkpoint/post-pull-claimed.storage.json'), 'utf8'));
const server = await maybeStartQaServer({ name: 'r35dbg', kind: 'preview' });
const browser = await chromium.launch({ ...qaChromiumLaunchOptions(), headless: false });
const state = { ...ckpt, origins: (ckpt.origins||[]).map(o=>({...o, origin: server.url.replace(/\/$/,'')})) };
const ctx = await browser.newContext({ viewport:{width:900,height:500}, hasTouch:true, storageState: state });
const page = await ctx.newPage();
await page.goto(checkedUrl(server.url), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__sim));
await page.getByRole('button', { name: /继续/ }).first().click();
await page.waitForFunction(() => window.__sim?.mode === 'playing');
await page.waitForTimeout(400);
await page.locator('canvas').focus().catch(()=>{});
const tel = () => page.evaluate(() => {
  const s = window.__sim, p = s.player;
  return { mode:s.mode, world:s.worldKind, shrine:s.shrine, x:+p.x.toFixed(2), z:+p.z.toFixed(2), y:p.y, camYaw:+s.cam.yaw.toFixed(2), state:p.state, lock:s.interactLock, vx:+p.vx.toFixed(2), vz:+p.vz.toFixed(2) };
});
console.log('t0', await tel());
for (let i=0;i<10;i++) {
  const t = await tel();
  if (t.world==='shrine') break;
  await page.keyboard.down('KeyW'); await page.waitForTimeout(150); await page.keyboard.up('KeyW');
  const b = page.locator('[data-touch-action="interact"]');
  if (await b.isVisible().catch(()=>false)) await b.tap({timeout:400}).catch(()=>{});
  await page.waitForTimeout(200);
}
console.log('after enter', await tel());
await page.waitForTimeout(500);
await page.locator('canvas').focus().catch(()=>{});
for (let i=0;i<16;i++) { await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(40); await page.keyboard.up('ArrowLeft'); }
console.log('after turn', await tel());
for (let i=0;i<12;i++) {
  await page.keyboard.down('KeyW'); await page.waitForTimeout(160); await page.keyboard.up('KeyW');
  console.log('step', i, await tel());
}
await browser.close();
await stopOwnedServer(server);
