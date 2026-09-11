/**
 * Short movement/turn diagnostic on the live playing session.
 * Records frames/sim.dt, key hold duration, camYaw error, displacement.
 * Does not write player position/rewards.
 *
 * E2E_URL=http://127.0.0.1:8115/ node scripts/qa/short-move-diag.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { qaChromiumLaunchOptions } from "./lifecycle.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
function note(m) {
  log.push({ t: Date.now(), m });
  console.log(`[short-move] ${m}`);
}

const browser = await chromium.launch(qaChromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

async function read() {
  return page.evaluate(() => {
    const sim = window.__sim;
    if (!sim) return null;
    return {
      mode: sim.mode,
      x: sim.player.x,
      y: sim.player.y,
      z: sim.player.z,
      camYaw: sim.cam.yaw,
      yaw: sim.player.yaw,
      state: sim.player.state,
      t: sim.t,
      worldKind: sim.worldKind,
      shrine: sim.shrine,
      pointerLock: Boolean(document.pointerLockElement),
    };
  });
}

const result = { url, phases: [] };

try {
  note(`boot url=${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(1200);
  let s = await read();
  note(`page __sim=${Boolean(s)} mode=${s?.mode}`);

  if (s?.mode !== "playing") {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((el) => (el.textContent || "").includes("开始探索"));
      if (b) {
        b.focus();
        b.click();
      }
    });
    await page.keyboard.press("Enter");
    await wait(600);
    s = await read();
    note(`start mode=${s?.mode}`);
  }
  if (s?.mode !== "playing") {
    result.detail = `not playing ${s?.mode}`;
  } else {
    // Measure sim clock advance over 1000ms wall
    const t0 = s.t;
    const w0 = Date.now();
    await wait(1000);
    const s1 = await read();
    const wall = Date.now() - w0;
    const simDt = (s1.t - t0) * 1000;
    const phaseClock = { wallMs: wall, simMs: +simDt.toFixed(1), ratio: +(simDt / wall).toFixed(3) };
    note(`clock ${JSON.stringify(phaseClock)}`);
    result.phases.push({ name: "clock", ...phaseClock });

    // Hold W 800ms, sample every 100ms
    const before = await read();
    const samples = [];
    await page.keyboard.down("KeyW");
    for (let i = 0; i < 8; i++) {
      await wait(100);
      const cur = await read();
      samples.push({
        i,
        x: +cur.x.toFixed(3),
        z: +cur.z.toFixed(3),
        d: +Math.hypot(cur.x - before.x, cur.z - before.z).toFixed(3),
        camYaw: +cur.camYaw.toFixed(3),
        t: +cur.t.toFixed(3),
      });
    }
    await page.keyboard.up("KeyW");
    const afterW = await read();
    const movedW = Math.hypot(afterW.x - before.x, afterW.z - before.z);
    const phaseW = {
      holdMs: 800,
      moved: +movedW.toFixed(3),
      speed: +((movedW / 0.8)).toFixed(3),
      samples,
    };
    note(`W ${JSON.stringify({ moved: phaseW.moved, speed: phaseW.speed, last: samples.at(-1) })}`);
    result.phases.push({ name: "W", ...phaseW });

    // Turn toward still POI (14,-78) using ArrowLeft/Right, record yaw error
    const target = { x: 14, z: -78 };
    const turnSamples = [];
    for (let i = 0; i < 12; i++) {
      const cur = await read();
      const want = Math.atan2(-(target.x - cur.x), -(target.z - cur.z));
      let err = want - cur.camYaw;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      turnSamples.push({ i, err: +err.toFixed(3), camYaw: +cur.camYaw.toFixed(3), want: +want.toFixed(3) });
      if (Math.abs(err) < 0.12) break;
      const key = err > 0 ? "ArrowLeft" : "ArrowRight";
      await page.keyboard.down(key);
      await wait(120);
      await page.keyboard.up(key);
    }
    const afterTurn = await read();
    const wantF = Math.atan2(-(target.x - afterTurn.x), -(target.z - afterTurn.z));
    let errF = wantF - afterTurn.camYaw;
    while (errF > Math.PI) errF -= Math.PI * 2;
    while (errF < -Math.PI) errF += Math.PI * 2;
    const phaseTurn = { errStart: turnSamples[0]?.err, errEnd: +errF.toFixed(3), samples: turnSamples };
    note(`turn ${JSON.stringify({ errStart: phaseTurn.errStart, errEnd: phaseTurn.errEnd, n: turnSamples.length })}`);
    result.phases.push({ name: "turn", ...phaseTurn });

    // Combined: face target, hold W 1500ms
    const pre = await read();
    await page.keyboard.down("KeyW");
    await wait(1500);
    await page.keyboard.up("KeyW");
    const post = await read();
    const moved = Math.hypot(post.x - pre.x, post.z - pre.z);
    const phaseWalk = {
      holdMs: 1500,
      moved: +moved.toFixed(3),
      from: { x: +pre.x.toFixed(2), z: +pre.z.toFixed(2) },
      to: { x: +post.x.toFixed(2), z: +post.z.toFixed(2) },
      state: post.state,
    };
    note(`walk1500 ${JSON.stringify(phaseWalk)}`);
    result.phases.push({ name: "walk1500", ...phaseWalk });
  }
} catch (e) {
  result.error = String(e?.message || e);
  note(`error ${result.error}`);
} finally {
  const json = resolve(outDir, "short-move-diag.json");
  writeFileSync(json, JSON.stringify({ ...result, log }, null, 2));
  note(`json ${json}`);
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
