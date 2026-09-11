/**
 * Short combat repro: prove real melee hit / dodge on a live bramble.
 * E2E_URL=http://127.0.0.1:8115/ node scripts/qa/combat-diag.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { lookToward, yawError } from "./nav-walk.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[combat] ${m}`);
};

const browser = await chromium.launch(qaChromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

let lockId = null;
async function read() {
  return page.evaluate((lockId) => {
    const sim = window.__sim;
    if (!sim) return null;
    const brambles = sim.enemies?.filter?.((x) => x.alive && x.kind === "bramble") || [];
    let e = null;
    if (lockId) e = sim.enemies?.find?.((x) => x.id === lockId) || null;
    if (!e) {
      let best = Infinity;
      for (const b of brambles) {
        const d = Math.hypot(b.x - sim.player.x, b.z - sim.player.z);
        if (d < best) {
          best = d;
          e = b;
        }
      }
    }
    return {
      mode: sim.mode,
      x: sim.player.x,
      y: sim.player.y,
      z: sim.player.z,
      camYaw: sim.cam.yaw,
      yaw: sim.player.yaw,
      state: sim.player.state,
      hp: sim.player.hp,
      stamina: sim.player.stamina,
      dodgeCd: sim.player.dodgeCd,
      dodgeT: sim.player.dodgeT,
      invuln: sim.player.invuln,
      attackPhase: sim.attack?.phase,
      attackT: sim.attack?.t,
      toast: sim.toast,
      enemy: e
        ? {
            id: e.id,
            x: +e.x.toFixed(2),
            y: +e.y.toFixed(2),
            z: +e.z.toFixed(2),
            hp: e.hp,
            alive: e.alive,
            phase: e.brain?.phase,
          }
        : null,
      enemiesAlive: sim.enemies?.filter?.((x) => x.alive && x.kind === "bramble")?.length ?? 0,
    };
  }, lockId);
}
async function hold(keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}
async function swing() {
  // Dispatch real DOM mouse events on canvas — page.mouse can stall on WebGL.
  await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return false;
    const opts = { button: 0, bubbles: true, cancelable: true, clientX: 640, clientY: 400 };
    c.dispatchEvent(new MouseEvent("mousedown", opts));
    c.dispatchEvent(new MouseEvent("mouseup", opts));
    return true;
  });
}

const result = { phases: [], log };

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(800);
  let s = await read();
  if (s?.mode !== "playing") {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("开始探索"));
      if (b) {
        b.focus();
        b.click();
      }
    });
    await page.keyboard.press("Enter");
    await wait(500);
    s = await read();
  }
  note(`start mode=${s?.mode} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)}`);
  if (s?.mode !== "playing") throw new Error("not playing");

  // Walk toward first bramble (may be near 42.5,62.5 or 40,48). Use live nearest.
  s = await read();
  if (!s?.enemy) {
    // probe walk south a bit
    await hold(["KeyW", "ShiftLeft"], 2000);
    s = await read();
  }
  if (!s?.enemy) throw new Error("no bramble in sim.enemies");
  lockId = s.enemy.id;
  note(`locked id=${lockId} hp=${s.enemy.hp} d=${Math.hypot(s.enemy.x - s.x, s.enemy.z - s.z).toFixed(2)}`);

  // Approach to ~1.55m (ATTACK_RANGE=2.15)
  for (let i = 0; i < 50 && s?.enemy; i++) {
    const d = Math.hypot(s.enemy.x - s.x, s.enemy.z - s.z);
    if (d < 1.55) break;
    if (d > 20) {
      await lookToward({ read, hold }, s.enemy.x, s.enemy.z, { tol: 0.3, maxPulses: 8, minPulseMs: 60, maxPulseMs: 450 });
      await hold(["KeyW", "ShiftLeft"], 700);
    } else {
      await lookToward({ read, hold }, s.enemy.x, s.enemy.z, { tol: 0.25, maxPulses: 10, minPulseMs: 60, maxPulseMs: 450 });
      await hold(["KeyW"], Math.min(320, Math.max(100, (d - 1.4) * 180)));
    }
    s = await read();
  }
  const d0 = s?.enemy ? Math.hypot(s.enemy.x - s.x, s.enemy.z - s.z) : Infinity;
  const err0 = s?.enemy ? yawError(s.camYaw, s.x, s.z, s.enemy.x, s.enemy.z) : Infinity;
  note(`approach d=${d0.toFixed(2)} err=${err0.toFixed(2)} id=${s?.enemy?.id} enemyHp=${s?.enemy?.hp} phase=${s?.enemy?.phase}`);
  result.phases.push({ name: "approach", d: d0, err: err0, hp: s?.enemy?.hp, id: s?.enemy?.id });

  // Face enemy tightly
  await lookToward({ read, hold }, s.enemy.x, s.enemy.z, { tol: 0.18, maxPulses: 12, minPulseMs: 60, maxPulseMs: 450 });
  s = await read();
  const errFace = s?.enemy ? yawError(s.camYaw, s.x, s.z, s.enemy.x, s.enemy.z) : Infinity;
  const hpBefore = s.enemy?.hp;
  const idBefore = s.enemy?.id;
  note(`face err=${errFace.toFixed(2)} camYaw=${s.camYaw.toFixed(2)} id=${idBefore} hpBefore=${hpBefore} d=${d0.toFixed(2)}`);
  const swung = await swing();
  note(`swing dispatched=${swung}`);
  const samples = [];
  let hpAfter = hpBefore;
  for (let i = 0; i < 10; i++) {
    await wait(120);
    const cur = await read();
    samples.push({
      i,
      phase: cur?.attackPhase,
      t: +Number(cur?.attackT ?? 0).toFixed(3),
      enemyId: cur?.enemy?.id,
      hp: cur?.enemy?.hp ?? null,
      alive: cur?.enemy?.alive,
      d: cur?.enemy ? +Math.hypot(cur.enemy.x - cur.x, cur.enemy.z - cur.z).toFixed(2) : null,
      err: cur?.enemy ? +yawError(cur.camYaw, cur.x, cur.z, cur.enemy.x, cur.enemy.z).toFixed(2) : null,
    });
    note(`atk i=${i} id=${cur?.enemy?.id} phase=${cur?.attackPhase} hp=${cur?.enemy?.hp} alive=${cur?.enemy?.alive} d=${samples.at(-1)?.d}`);
    if (cur?.enemy?.hp != null && cur.enemy.hp < hpBefore) {
      hpAfter = cur.enemy.hp;
      note(`HIT id=${cur.enemy.id} hp ${hpBefore}->${hpAfter} phase=${cur.attackPhase} d=${samples.at(-1)?.d}`);
      break;
    }
    if (cur?.attackPhase === "idle" && i >= 2 && i % 2 === 0) await swing();
  }
  s = await read();
  const hit = s?.enemy?.hp != null && s.enemy.hp < hpBefore && s.enemy.id === idBefore;
  note(`attack result sameId=${s?.enemy?.id === idBefore} hit=${hit} hpBefore=${hpBefore} hpAfter=${s?.enemy?.hp} phase=${s?.attackPhase}`);
  result.phases.push({ name: "melee", hit, enemyId: idBefore, idAfter: s?.enemy?.id, hpBefore, hpAfter: s?.enemy?.hp, errFace, samples });

  // Dodge test
  const st0 = s.stamina;
  const dt0 = s.dodgeT;
  const pos0 = { x: s.x, z: s.z };
  await hold(["KeyC"], 50);
  const dodgeSamples = [];
  for (let i = 0; i < 15; i++) {
    await wait(60);
    const cur = await read();
    dodgeSamples.push({ i, dodgeT: cur?.dodgeT, stamina: +Number(cur?.stamina ?? 0).toFixed(1), cd: cur?.dodgeCd });
    if (cur?.dodgeT > 0 && dt0 <= 0) break;
  }
  const afterDodge = await read();
  const moved = Math.hypot(afterDodge.x - pos0.x, afterDodge.z - pos0.z);
  note(
    `dodge stamina ${st0?.toFixed?.(1)}->${afterDodge?.stamina?.toFixed?.(1)} dodgeT ${dt0}->${afterDodge?.dodgeT} moved=${moved.toFixed(2)}`,
  );
  result.phases.push({
    name: "dodge",
    st0,
    st1: afterDodge?.stamina,
    dodgeT0: dt0,
    dodgeT1: afterDodge?.dodgeT,
    moved,
    samples: dodgeSamples,
  });

  result.ok = hit && afterDodge.stamina < st0 - 1;
  result.detail = result.ok ? "melee hit + dodge consumed stamina" : `hit=${hit} st ${st0}->${afterDodge.stamina}`;
} catch (e) {
  result.error = String(e?.message || e);
  note(`error ${result.error}`);
} finally {
  writeFileSync(resolve(outDir, "combat-diag.json"), JSON.stringify({ ...result, log }, null, 2));
  note(`json combat-diag.json ok=${result.ok}`);
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
