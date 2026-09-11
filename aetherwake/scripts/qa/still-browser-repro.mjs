/**
 * Short still-shrine browser repro: real keyboard only.
 * Does not write player coords / rewards / completion flags.
 * Observes window.__sim (read-only).
 *
 * Run: node scripts/qa/still-browser-repro.mjs
 * Optional: E2E_URL=http://127.0.0.1:8091/ to reuse a live preview.
 *
 * Evidence goes to repo/docs/rebuild-evidence (not aetherwake/docs).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkedOutputPath } from "../browser-guard.mjs";
import {
  bindCloseTracking,
  browserProcessInfo,
  maybeStartQaServer,
  qaChromiumLaunchOptions,
  stopOwnedServer,
  waitHttpReady,
} from "./lifecycle.mjs";
import { STILL_FROM_SPAWN, shrineAltar, shrineWorldOrigin, stillBlockAligned } from "./shrine-steer.mjs";
import { followRouteWithRespawn, lookToward as sharedLookToward, walkTo } from "./nav-walk.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(appRoot, "..");
const outDir = resolve(repoRoot, "docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });

/**
 * Safe corridor west of bramble packs AND west of citadel walls
 * (citadel AABB roughly x -6..18, z -24..1 blocked (5,-20) leg).
 * still shrine POI (14,-78); approach south door.
 */
const STILL_SAFE_ROUTE = [
  { x: 5, z: 80 },
  { x: 5, z: 40 },
  { x: 5, z: 15 },
  { x: -18, z: 5 },
  { x: -18, z: -30 },
  { x: -18, z: -60 },
  { x: 0, z: -75 },
  { x: 14, z: -81.1 },
];

const log = [];
function note(m) {
  log.push({ t: Date.now(), m });
  console.log(`[still-br] ${m}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Shared walkTo from nav-walk.mjs (stop rules live there).

const runId = process.env.QA_RUN_ID || `still-${Date.now()}`;
const runDir = resolve(outDir, `runs/${runId}`);
mkdirSync(runDir, { recursive: true });

console.log("[still-br] boot");
const owned = await maybeStartQaServer({ name: "still-browser-repro", kind: "preview", cwd: appRoot });
if (!owned?.ok && !owned?.url) {
  throw new Error(`server start failed: ${owned?.error || "unknown"}`);
}
const url = new URL(owned.url || process.env.E2E_URL || "http://127.0.0.1:8080/").toString();
note(`url=${url} owned=${owned.owned} runId=${runId}`);
const ready = await waitHttpReady(url, owned.child, 20000);
if (!ready?.ok) {
  if (owned.owned) await stopOwnedServer(owned);
  throw new Error(`preview not ready: ${ready?.error}`);
}
note(`http ready status=${ready.status}`);

// Browser stderr for close diagnosis (Review 06)
if (!process.env.DEBUG) process.env.DEBUG = "pw:browser";
const browser = await chromium.launch({
  ...qaChromiumLaunchOptions(),
  env: { ...process.env, DEBUG: process.env.DEBUG || "pw:browser" },
});
const browserInfo = browserProcessInfo(browser, { rootPid: process.pid });
note(`browser pid=${browserInfo.chromiumPid ?? "?"} debug=${process.env.DEBUG}`);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const closeFlags = bindCloseTracking(page, context, browser);
const harness = {
  pid: process.pid,
  ppid: process.ppid,
  startedAt: Date.now(),
  runId,
  url,
  headed: process.env.QA_HEADED === "1",
};

async function shot(name) {
  // Unique per-run path so later runs cannot overwrite success evidence (Review09).
  const p = checkedOutputPath(resolve(runDir, name), [outDir]);
  await page.screenshot({ path: p, type: "png" });
  return p;
}
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
      state: sim.player.state,
      prompt: sim.prompt,
      shrine: sim.shrine,
      shrineHint: sim.shrineHint,
      shrines: [...sim.shrinesOn],
      orbs: sim.orbs,
      art: sim.art,
      toast: sim.toast,
      interactLock: sim.interactLock ?? 0,
      moveBlock: sim.moveBlock
        ? { x: sim.moveBlock.x, z: sim.moveBlock.z, frozen: sim.moveBlock.frozen }
        : null,
      worldKind: sim.worldKind,
      hp: sim.player.hp,
      vy: sim.player.vy,
      vx: sim.player.vx,
      vz: sim.player.vz,
      enemies: Array.isArray(sim.enemies)
        ? sim.enemies
            .filter((e) => e.alive)
            .map((e) => ({
              kind: e.kind,
              x: +e.x.toFixed(1),
              z: +e.z.toFixed(1),
              y: +e.y.toFixed(1),
              hp: e.hp,
              phase: e.brain?.phase,
            }))
            .slice(0, 8)
        : [],
      pointerLock: Boolean(document.pointerLockElement),
      t: sim.t,
    };
  });
}
async function tap(code) {
  await page.keyboard.press(code);
}
async function hold(keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}
/** Browser lookToward: shared closed-loop (aligned-only). */
const lookToward = (tx, tz, opts = {}) =>
  sharedLookToward({ read, hold }, tx, tz, {
    tol: 0.22,
    maxPulses: 16,
    minPulseMs: 60,
    maxPulseMs: 450,
    ...opts,
  });
/** Overworld: sprint-walk. Shrine interior: walk only. */
const walk = (tx, tz, ms, opts = {}) =>
  walkTo(
    {
      read,
      lookToward,
      hold: async (keys, stepMs) => {
        const sprint = opts.sprint !== false && opts.expectShrine === null;
        await hold(sprint ? [...keys, "ShiftLeft"] : keys, stepMs);
      },
    },
    tx,
    tz,
    ms,
    { stepMs: 280, tol: 0.25, lookOpts: { tol: 0.25, maxPulses: 16, minPulseMs: 60, maxPulseMs: 450 }, ...opts },
  );

/** Click 在篝火旁醒来 if dead. */
async function resumeIfDead(tag) {
  let s = await read();
  if (s?.mode !== "dead" && s?.state !== "dead") return s;
  note(`dead at ${tag} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)} y=${s?.y?.toFixed(1)}; respawning`);
  result.shots.push(await shot(`still-br-dead-${tag}.png`));
  try {
    await page.getByRole("button", { name: "在篝火旁醒来" }).click({ timeout: 2500 });
  } catch {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("在篝火旁醒来"));
      if (b) {
        b.focus();
        b.click();
      }
    });
    await page.keyboard.press("Enter");
  }
  await wait(800);
  s = await read();
  note(`respawn mode=${s?.mode} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)}`);
  return s;
}

let result = { ok: false, path: null, shrines: [], orbs: 0, detail: "", shots: [], stages: [] };
function stage(name, detail) {
  result.stages.push({ name, detail, t: Date.now() });
  note(`stage ${name}: ${detail}`);
}

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  stage("goto", "ok");
  await wait(2000);
  let s = await read();
  stage("page", s ? `mode=${s.mode}` : "__sim missing");

  // Start: wait for 开始探索, then focus+Enter (Playwright click is blocked by canvas).
  let started = false;
  for (let i = 0; i < 10 && !started; i++) {
    s = await read();
    if (s?.mode === "playing") {
      started = true;
      stage("start-btn", `already playing t=${i}`);
      break;
    }
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((el) => (el.textContent || "").includes("开始探索"));
      if (b) {
        b.focus();
        b.click();
        return true;
      }
      return false;
    });
    await wait(200);
    if (clicked) await page.keyboard.press("Enter");
    await wait(400);
    s = await read();
    if (s?.mode === "playing") {
      started = true;
      stage("start-btn", `dom-click+enter playing t=${i}`);
    }
  }
  if (!started) stage("start-btn", `failed mode=${s?.mode}`);
  await wait(400);
  s = await read();
  stage("mode", s ? `mode=${s.mode} at ${s.x.toFixed(1)},${s.z.toFixed(1)} lock=${s.pointerLock}` : "null");
  result.shots.push(await shot("still-br-start.png"));
  if (s?.mode !== "playing") {
    result.detail = `not playing mode=${s?.mode}`;
    throw new Error(result.detail);
  }

  // Single-input probe: W should change xz if playing
  if (s?.mode === "playing") {
    const x0 = s.x;
    const z0 = s.z;
    await hold(["KeyW"], 400);
    const s1 = await read();
    const d = Math.hypot(s1.x - x0, s1.z - z0);
    stage("input-W", `moved=${d.toFixed(2)}m at ${s1.x.toFixed(1)},${s1.z.toFixed(1)}`);
  }

  const route = await followRouteWithRespawn(
    {
      read,
      lookToward,
      hold: async (keys, stepMs) => {
        await hold(keys.includes("KeyW") ? [...keys, "ShiftLeft"] : keys, stepMs);
      },
      /** Bramble pack killed us. Proven: attack starts at any range; hit needs d≤2.15. */
      hazard: async (s) => {
        const foes = (s.enemies || []).filter((e) => e.kind !== "boss" && e.hp > 0);
        if (!foes.length) return false;
        const near = foes
          .map((e) => ({ e, d: Math.hypot(e.x - s.x, e.z - s.z) }))
          .filter((x) => x.d < 10)
          .sort((a, b) => a.d - b.d);
        if (!near.length) return false;
        const threat = near[0];
        const phase = threat.e.phase;
        // Incoming attack: dodge (proven stamina/dodgeT)
        if ((phase === "windup" || phase === "strike") && threat.d < 4.5) {
          note(`hazard dodge d=${threat.d.toFixed(1)} phase=${phase}`);
          await tap("KeyC");
          await wait(300);
          return true;
        }
        // Melee only inside real range 2.15 — close if slightly outside
        if (threat.d < 2.0) {
          await lookToward(threat.e.x, threat.e.z, { maxPulses: 5, pulseMs: 180, maxPulseMs: 450, tol: 0.25 });
          const hp0 = threat.e.hp;
          for (let k = 0; k < 4; k++) {
            note(`hazard melee#${k} d=${threat.d.toFixed(1)} phase=${phase} hp=${hp0}`);
            await page.evaluate(() => {
              const c = document.querySelector("canvas");
              if (!c) return;
              const opts = { button: 0, bubbles: true, cancelable: true, clientX: 640, y: 400, clientY: 400 };
              c.dispatchEvent(new MouseEvent("mousedown", opts));
              c.dispatchEvent(new MouseEvent("mouseup", opts));
            });
            await wait(1200);
            const after = await read();
            const foe = (after?.enemies || []).find((e) => e.id === threat.e.id || (e.kind === "bramble" && Math.hypot(e.x - threat.e.x, e.z - threat.e.z) < 0.5));
            if (foe && foe.hp < hp0) {
              note(`hazard melee HIT hp ${hp0}->${foe.hp}`);
              break;
            }
            if (!foe || foe.hp <= 0 || !foe.alive) break;
          }
          return true;
        }
        // 2–4.5m neutral: step in if same direction as travel goal-ish (close the gap)
        if (threat.d < 4.5 && phase !== "lost") {
          await lookToward(threat.e.x, threat.e.z, { maxPulses: 4, pulseMs: 150, maxPulseMs: 400, tol: 0.3 });
          await hold(["KeyW"], 250);
          return true;
        }
        return false;
      },
      respawn: async () => {
        const before = await read();
        note(
          `DEATH snapshot x=${before?.x?.toFixed?.(1)} y=${before?.y?.toFixed?.(2)} z=${before?.z?.toFixed?.(1)} ` +
            `vy=${before?.vy?.toFixed?.(2)} hp=${before?.hp} mode=${before?.mode} state=${before?.state} ` +
            `toast=${JSON.stringify(before?.toast)} enemies=${JSON.stringify(before?.enemies)}`,
        );
        result.shots.push(await shot("still-br-death.png"));
        try {
          await page.getByRole("button", { name: "在篝火旁醒来" }).click({ timeout: 2500 });
        } catch {
          await page.evaluate(() => {
            const b = [...document.querySelectorAll("button")].find((el) =>
              (el.textContent || "").includes("在篝火旁醒来"),
            );
            if (b) {
              b.focus();
              b.click();
            }
          });
          await page.keyboard.press("Enter");
        }
        await wait(900);
        const after = await read();
        note(`respawn mode=${after?.mode} at ${after?.x?.toFixed?.(1)},${after?.z?.toFixed?.(1)} y=${after?.y?.toFixed?.(1)}`);
      },
    },
    STILL_SAFE_ROUTE,
    240000,
    {
      arrive: 3.2,
      expectShrine: null,
      tol: 0.22,
      stepMs: 280,
      maxRouteAttempts: 2,
      spawnX: 16,
      spawnZ: 102,
      spawnRadius: 15,
      resetRadius: 25,
      lookOpts: { tol: 0.25, maxPulses: 16, minPulseMs: 60, maxPulseMs: 450 },
      onStep: (e) => note(`routeStep ${JSON.stringify(e)}`),
    },
  );
  for (const line of route.log) {
    note(`route ${JSON.stringify(line)}`);
  }
  for (const d of route.deaths) {
    note(`deathRec ${JSON.stringify(d)}`);
  }
  s = await read();
  if (!route.ok) {
    result.detail = `route ${route.status} at i=${route.i} dist=${route.dist?.toFixed?.(1)} deaths=${route.deaths.length}`;
    stage("route", result.detail);
    result.shots.push(await shot("still-br-nav-abort.png"));
    throw new Error(result.detail);
  }
  stage("route", `completed after ${route.deaths.length} death(s)`);
  result.route = { status: route.status, deaths: route.deaths, log: route.log };
  result.shots.push(await shot("still-br-route-ok.png"));

  const poi = { x: 14, z: -78 };
  const ap = await walk(poi.x, poi.z - 3.2, 90000, { arrive: 2.4, expectShrine: null });
  s = ap.s;
  note(`approach ${ap.status} dist=${ap.dist?.toFixed?.(1)} ${s ? `${s.x.toFixed(1)},${s.z.toFixed(1)} prompt=${JSON.stringify(s.prompt)}` : "null"}`);
  result.shots.push(await shot("still-br-approach.png"));
  if (ap.status !== "arrived") {
    result.detail = `approach ${ap.status}`;
    throw new Error(result.detail);
  }

  for (let i = 0; i < 12 && s?.shrine == null; i++) {
    s = await read();
    if (!s) break;
    await lookToward(poi.x, poi.z, { maxPulses: 8, pulseMs: 250, maxPulseMs: 700 });
    await tap("KeyE");
    await wait(350);
    s = await read();
    if (i % 3 === 0 || s?.shrine != null) {
      note(`E#${i} shrine=${s?.shrine} prompt=${JSON.stringify(s?.prompt)} lock=${s?.interactLock} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)}`);
    }
  }
  if (s?.shrine == null) {
    for (const face of [
      { x: poi.x, z: poi.z + 3.2 },
      { x: poi.x + 3.2, z: poi.z },
      { x: poi.x - 3.2, z: poi.z },
    ]) {
      const fr = await walk(face.x, face.z, 10000, { arrive: 2.0, expectShrine: null });
      s = fr.s;
      await lookToward(poi.x, poi.z);
      for (let i = 0; i < 6 && s?.shrine == null; i++) {
        await tap("KeyE");
        await wait(400);
        s = await read();
      }
      note(`face ${face.x},${face.z} ${fr.status} shrine=${s?.shrine} prompt=${JSON.stringify(s?.prompt)}`);
      if (s?.shrine != null) break;
    }
  }

  if (s?.shrine == null) {
    result.detail = `failed to enter prompt=${s?.prompt} at ${s?.x?.toFixed(1)},${s?.z?.toFixed(1)} mode=${s?.mode}`;
    stage("enter", result.detail);
    result.shots.push(await shot("still-br-fail-enter.png"));
  } else {
    const shrineIdx = s.shrine;
    stage("enter", `shrine=${shrineIdx} hint=${s.shrineHint} world=${s.worldKind} at ${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}`);
    result.shots.push(await shot("still-br-inside.png"));
    const o = shrineWorldOrigin(shrineIdx);
    const altar = shrineAltar(o);

    const lip = await walk(o.x, o.z + 9.2, 60000, { arrive: 1.4, expectShrine: shrineIdx });
    s = lip.s;
    stage("pit-lip", `${lip.status} y=${s?.y?.toFixed(2)} z=${s?.z?.toFixed(1)} lz=${s ? (s.z - o.z).toFixed(1) : "?"} d=${lip.dist?.toFixed(1)}`);
    result.shots.push(await shot("still-br-pit-lip.png"));
    if (lip.status !== "arrived") {
      result.detail = `pit-lip ${lip.status} d=${lip.dist?.toFixed(1)}`;
    } else if (process.env.QA_STILL_NO_ABILITY === "1") {
      // Review09: no Digit5/F — walk center toward altar; expect fall, no claim.
      result.noAbility = true;
      stage("no-ability", `skip freeze; walk center to altar from lip y=${s?.y?.toFixed(2)}`);
      const br = await walk(altar.x, altar.z, 45000, { arrive: 1.5, expectShrine: shrineIdx });
      s = br.s || (await read());
      const dAltar = s ? Math.hypot(s.x - altar.x, s.z - altar.z) : Infinity;
      const fell = s && s.y < o.y - 2;
      stage(
        "no-ability-bridge",
        `${br.status} y=${s?.y?.toFixed(2)} dAltar=${dAltar?.toFixed(1)} fell=${fell} frozen=${s?.moveBlock?.frozen} prompt=${JSON.stringify(s?.prompt)}`,
      );
      result.shots.push(await shot("still-noability-center.png"));
      for (let i = 0; i < 4; i++) {
        await tap("KeyE");
        await wait(350);
        s = await read();
        if (s?.shrines?.includes("still")) break;
      }
      const claimed = Boolean(s?.shrines?.includes("still"));
      stage("no-ability-claim", `claimed=${claimed} orbs=${s?.orbs} frozen=${s?.moveBlock?.frozen} y=${s?.y?.toFixed(2)}`);
      result.ok = !claimed && (fell || dAltar > 2.2 || (s?.moveBlock?.frozen ?? 0) < 0.5);
      result.detail = result.ok
        ? `no-ability did not claim (expected) y=${s?.y?.toFixed(1)} dAltar=${dAltar.toFixed(1)}`
        : `NO-ABILITY CLAIMED — puzzle bypass claimed=${claimed} dAltar=${dAltar.toFixed(1)} frozen=${s?.moveBlock?.frozen}`;
      result.shrines = s?.shrines || [];
      result.orbs = s?.orbs ?? 0;
      result.path = "no-ability-center";
      if (s?.shrine != null) {
        await tap("KeyE");
        await wait(400);
      }
    } else {
      const alignEnd = Date.now() + 9000;
      while (Date.now() < alignEnd) {
        s = await read();
        if (s?.moveBlock && stillBlockAligned(o.x, s.moveBlock.x)) break;
        await wait(80);
      }
      s = await read();
      const aligned = Boolean(s?.moveBlock && stillBlockAligned(o.x, s.moveBlock.x));
      const f0 = Number(s?.moveBlock?.frozen ?? 0);
      await tap("Digit5");
      await tap("KeyF");
      await wait(300);
      s = await read();
      const f1 = Number(s?.moveBlock?.frozen ?? 0);
      stage("freeze", `aligned=${aligned} ${f0}->${f1} toast=${JSON.stringify(s?.toast)} bx=${s?.moveBlock?.x?.toFixed(2)}`);
      result.shots.push(await shot("still-br-freeze.png"));

      if (f1 <= f0 + 0.5) {
        result.detail = `no freeze ${f0}->${f1}`;
      } else {
        const br = await walk(altar.x, altar.z, 60000, { arrive: 1.5, expectShrine: shrineIdx });
        s = br.s;
        const dAltar = s ? Math.hypot(s.x - altar.x, s.z - altar.z) : Infinity;
        stage("bridge", `${br.status} y=${s?.y?.toFixed(2)} dAltar=${dAltar?.toFixed(1)} prompt=${JSON.stringify(s?.prompt)}`);
        result.shots.push(await shot("still-br-altar.png"));
        if (br.status !== "arrived") {
          result.detail = `bridge ${br.status} dAltar=${dAltar?.toFixed(1)}`;
        } else {
          for (let i = 0; i < 6; i++) {
            await tap("KeyE");
            await wait(400);
            s = await read();
            if (s?.shrines?.includes("still")) break;
          }
          stage("claim", `orbs=${s?.orbs} shrines=${JSON.stringify(s?.shrines)} toast=${JSON.stringify(s?.toast)} world=${s?.worldKind}`);
          result.shots.push(await shot("still-br-claimed.png"));
          if (s?.shrine != null) {
            await tap("KeyE");
            await wait(500);
            s = await read();
          }
          stage("leave", `world=${s?.worldKind} shrine=${s?.shrine} orbs=${s?.orbs}`);
          result.ok = Boolean(s?.shrines?.includes("still") && s?.orbs >= 1 && s?.worldKind === "overworld");
          result.detail = result.ok ? "freeze-bridge claim+leave ok" : result.detail || "post-claim check failed";
          result.shrines = s?.shrines || [];
          result.orbs = s?.orbs ?? 0;
          result.path = "intended-freeze-bridge";
        }
      }
    }
  }
} catch (err) {
  result.detail = `error ${err?.message || err}`;
  stage("error", result.detail);
} finally {
  // Persist lifecycle BEFORE teardown (Review 06) — snapshot then mark intentional.
  const life = typeof closeFlags.snapshot === "function" ? closeFlags.snapshot() : { ...closeFlags, events: [] };
  const payload = {
    ...result,
    url,
    outDir,
    runDir,
    runId,
    harness,
    browserInfo,
    lifecycle: life,
    closeReason: life.crashed ? "crash" : life.browserDisconnected ? "browser-disconnected" : life.pageClosed ? "page-close" : null,
    log,
  };
  const json = checkedOutputPath(resolve(runDir, "still-browser-repro.json"), [outDir]);
  writeFileSync(json, JSON.stringify(payload, null, 2));
  // also latest pointer for convenience
  writeFileSync(checkedOutputPath(resolve(outDir, "still-browser-repro.json"), [outDir]), JSON.stringify(payload, null, 2));
  note(`json ${json} ok=${result.ok} closeOrder=${life.order || "?"} events=${life.events?.length ?? 0}`);
  closeFlags.intentionalTeardown = true;
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  if (owned?.owned) {
    const stopped = await stopOwnedServer(owned);
    note(`stopOwnedServer ${JSON.stringify(stopped)}`);
  }
  process.exit(result.ok ? 0 : 1);
}
