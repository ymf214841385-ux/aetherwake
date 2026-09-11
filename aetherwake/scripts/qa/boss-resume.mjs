/**
 * Review16/19: restore legitimate after-citadel/courtyard save on same-origin 8115,
 * verify progress, then normal-input Boss fight with planFightTick (shared with tests).
 * No HP/damage/progress writes.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { bindCloseTracking, browserProcessInfo, qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { lookToward } from "./nav-walk.mjs";
import { BOSS_MELEE_MAX } from "./boss-fight-policy.mjs";
import { planFightTick } from "./boss-fight-tick.mjs";
import { citadelDodgeAim, citadelOffArena, citadelReturnWaypoints } from "./citadel-steer.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
const runId = process.env.QA_RUN_ID || `boss-resume-${Date.now()}`;
const runDir = resolve(outDir, `runs/${runId}`);
mkdirSync(runDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const courtyardCkpt = resolve(outDir, "storage-ckpt-courtyard.json");
const ckptPath =
  process.env.QA_SAVE_CKPT ||
  (existsSync(courtyardCkpt) ? courtyardCkpt : resolve(outDir, "storage-ckpt-after-citadel.json"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[boss-resume] ${m}`);
};

const ckpt = JSON.parse(readFileSync(ckptPath, "utf8"));
if (!ckpt.v2) throw new Error("checkpoint missing v2 save");
note(`ckpt ${ckptPath} label=${ckpt.label}`);

if (!process.env.DEBUG) process.env.DEBUG = "pw:browser";
const browser = await chromium.launch({ ...qaChromiumLaunchOptions(), env: { ...process.env } });
const browserInfo = browserProcessInfo(browser, { rootPid: process.pid });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const closeFlags = bindCloseTracking(page, context, browser);
// Review17: capture renderer errors and flush partial evidence on unexpected close.
const pageErrors = [];
page.on("pageerror", (err) => {
  pageErrors.push(String(err?.message || err));
  note(`pageerror ${String(err?.message || err).slice(0, 200)}`);
});
page.on("console", (msg) => {
  if (msg.type() === "error") pageErrors.push(`console: ${msg.text().slice(0, 200)}`);
});
let flushed = false;
function flushPartial(tag) {
  if (flushed) return;
  flushed = true;
  const life = typeof closeFlags.snapshot === "function" ? closeFlags.snapshot() : { ...closeFlags, events: [] };
  const payload = {
    ...result,
    runId,
    ckpt: ckptPath,
    browserInfo,
    lifecycle: life,
    pageErrors,
    log,
    partialTag: tag,
  };
  try {
    writeFileSync(resolve(runDir, "boss-resume.json"), JSON.stringify(payload, null, 2));
    writeFileSync(resolve(outDir, "boss-resume.json"), JSON.stringify(payload, null, 2));
    note(`flushPartial ${tag} ok=${result.ok} segments=${result.segments?.length ?? 0}`);
  } catch (e) {
    console.error("flushPartial failed", e);
  }
}
page.on("close", () => {
  if (!closeFlags.intentionalTeardown) flushPartial("page-close");
});

async function shot(name) {
  const p = resolve(runDir, name);
  await page.screenshot({ path: p, type: "png" });
  return p;
}
async function read() {
  return page.evaluate(() => {
    const sim = window.__sim;
    if (!sim) return null;
    const boss = sim.enemies?.find?.((e) => e.kind === "boss");
    return {
      mode: sim.mode,
      x: sim.player.x,
      y: sim.player.y,
      z: sim.player.z,
      camYaw: sim.cam.yaw,
      state: sim.player.state,
      hp: sim.player.hp,
      stamina: sim.player.stamina,
      towers: [...sim.towersOn],
      shrines: [...sim.shrinesOn],
      orbs: sim.orbs,
      bossDead: sim.bossDead,
      sealOpen: typeof sim.sealIsOpen === "function" ? sim.sealIsOpen() : false,
      attackPhase: sim.attack?.phase,
      dodgeCd: sim.player.dodgeCd,
      boss: boss
        ? {
            x: +boss.x.toFixed(2),
            y: +boss.y.toFixed(2),
            z: +boss.z.toFixed(2),
            hp: boss.hp,
            alive: boss.alive,
            phase: boss.brain?.phase,
          }
        : null,
    };
  });
}
async function hold(keys, ms) {
  const downs = [];
  try {
    for (const k of keys) {
      await page.keyboard.down(k);
      downs.push(k);
    }
    await wait(ms);
  } finally {
    for (const k of [...downs].reverse()) await page.keyboard.up(k).catch(() => {});
  }
}
async function swing() {
  await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return false;
    const opts = { button: 0, bubbles: true, cancelable: true, clientX: 640, clientY: 400 };
    c.dispatchEvent(new MouseEvent("mousedown", opts));
    c.dispatchEvent(new MouseEvent("mouseup", opts));
    return true;
  });
}
function facingDot(s, tx, tz) {
  const dx = tx - s.x;
  const dz = tz - s.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = -Math.sin(s.camYaw ?? 0);
  const fz = -Math.cos(s.camYaw ?? 0);
  return (dx * fx + dz * fz) / len;
}
/** Keys toward a world point relative to cam — same contract as play-routes. */
function keysToward(s, tx, tz) {
  const dx = tx - s.x;
  const dz = tz - s.z;
  const fx = -Math.sin(s.camYaw ?? 0);
  const fz = -Math.cos(s.camYaw ?? 0);
  const rx = Math.cos(s.camYaw ?? 0);
  const rz = -Math.sin(s.camYaw ?? 0);
  const f = dx * fx + dz * fz;
  const r = dx * rx + dz * rz;
  const keys = [];
  if (f > 0.35) keys.push("KeyW");
  if (f < -0.35) keys.push("KeyS");
  if (r > 0.35) keys.push("KeyD");
  if (r < -0.35) keys.push("KeyA");
  if (keys.length === 0) keys.push("KeyW");
  return keys;
}

const result = {
  ok: false,
  swings: 0,
  hits: 0,
  decisions: [],
  restore: null,
  segments: [],
  courtyardSave: null,
  failures: [],
  approachDodges: 0,
  pageErrors: [],
  /** Review22: every telegraph dodge — before/after dist, face, hp, cd, KeyC. */
  dodgeTrail: [],
};

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1000);
  // Inject legitimate save from same-origin checkpoint (not fabricated progress)
  await page.evaluate((v2) => {
    localStorage.setItem("aetherwake-save-v2", v2);
  }, ckpt.v2);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1200);
  // Continue via UI
  const cont = page.locator("button", { hasText: "继续旅途" });
  if ((await cont.count()) > 0) {
    await cont.first().focus();
    await page.keyboard.press("Enter");
    await wait(800);
  }
  let s = await read();
  result.restore = {
    mode: s?.mode,
    towers: s?.towers,
    shrines: s?.shrines,
    orbs: s?.orbs,
    bossDead: s?.bossDead,
    pos: s ? { x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1) } : null,
    sealOpen: s?.sealOpen,
  };
  note(`restore ${JSON.stringify(result.restore)}`);
  result.shots = [await shot("boss-resume-boot.png")];
  if (s?.mode !== "playing") throw new Error(`continue failed mode=${s?.mode}`);
  if (!s.sealOpen) throw new Error(`seal not open after restore towers=${s.towers} shrines=${s.shrines}`);

  // Walk to courtyard if far
  const boss = s.boss;
  if (!boss?.alive) {
    result.detail = "no live boss after restore";
    throw new Error(result.detail);
  }
  // Recovery if off arena — crown descent needs long legs (y=53.5→ground).
  let off = citadelOffArena({ x: s.x, z: s.z, y: s.y }, boss);
  note(`off=${off.reason} d=${Math.hypot(s.x - boss.x, s.z - boss.z).toFixed(1)} y=${s.y?.toFixed?.(1)}`);
  const wps = [];
  if (s.y > 40) {
    // Crown tower at (48,-128). Player starts NE of it. Go around the tower
    // south/east then down the ridge — direct line gets stuck on the shaft.
    wps.push({ x: 55, z: -115, label: "crown-east" });
    wps.push({ x: 50, z: -100, label: "crown-south" });
    wps.push({ x: 40, z: -95, label: "crown-ridge" });
    wps.push({ x: 36, z: -90, label: "crown-ledge" });
    wps.push({ x: 24, z: -40, label: "crown-base" });
    wps.push({ x: 6, z: 8, label: "gate-south" });
    wps.push({ x: 6, z: 0.8, label: "gate" });
    wps.push({ x: boss.x, z: boss.z + 2.4, label: "boss-standoff" });
  } else if (off.off) {
    for (const p of citadelReturnWaypoints({ x: s.x, z: s.z, y: s.y }, boss)) {
      wps.push({ ...p, label: "return" });
    }
  }
  if (wps.length) {
    note(`recover ${wps.map((p) => `${p.label}:${p.x},${p.z}`).join(" → ")}`);
    for (let wi = 0; wi < wps.length; wi++) {
      const wp = wps[wi];
      // Crown ridge is ~35m with collision; give each leg a real budget.
      const legMs = wp.label?.startsWith("crown") ? 50000 : 28000;
      const end = Date.now() + legMs;
      let lastD = Infinity;
      let stagnant = 0;
      let segStart = null;
      let stuckAt = null;
      while (Date.now() < end) {
        const cur = await read();
        if (!cur) break;
        if (cur.mode === "dead") {
          note(`dead en route ${wp.label}; respawn`);
          result.failures.push({
            label: wp.label,
            kind: "dead",
            x: cur.x,
            y: cur.y,
            z: cur.z,
            hp: cur.hp,
          });
          try {
            await page.getByRole("button", { name: "在篝火旁醒来" }).click({ timeout: 1500 });
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
          await wait(800);
          const r = await read();
          note(`respawned at ${r?.x?.toFixed?.(1)},${r?.y?.toFixed?.(1)},${r?.z?.toFixed?.(1)}`);
          // After-citadel save sits on the crown; world-spawn legs are 200m away.
          // If respawn is still on the crown massif, re-enter the descent path.
          let spawnWps;
          if (r && r.z < -80 && r.y > 12) {
            spawnWps = [
              { x: 55, z: -115, label: "crown-east" },
              { x: 50, z: -100, label: "crown-south" },
              { x: 40, z: -95, label: "crown-ridge" },
              { x: 36, z: -90, label: "crown-ledge" },
              { x: 24, z: -40, label: "crown-base" },
              { x: 6, z: 8, label: "gate-south" },
              { x: 6, z: 0.8, label: "gate" },
              { x: boss.x, z: boss.z + 2.4, label: "boss-standoff" },
            ];
          } else {
            spawnWps = [
              { x: 5, z: 80, label: "spawn-south" },
              { x: 5, z: 15, label: "spawn-mid" },
              { x: 6, z: 8, label: "gate-south" },
              { x: 6, z: 0.8, label: "gate" },
              { x: boss.x, z: boss.z + 2.4, label: "boss-standoff" },
            ];
          }
          wps.length = 0;
          wps.push(...spawnWps);
          wi = -1;
          break;
        }
        if (cur.mode !== "playing" || !cur.boss?.alive) break;
        if (cur.state === "climbing") {
          await hold(["KeyC"], 180);
          continue;
        }
        const d = Math.hypot(wp.x - cur.x, wp.z - cur.z);
        if (!segStart) segStart = { x: cur.x, y: cur.y, z: cur.z, hp: cur.hp };
        if (d < 3.2) break;
        // Stagnation: if not getting closer, try a lateral sidestep then re-aim.
        if (d > lastD - 0.05) {
          stagnant += 1;
          if (stagnant % 8 === 0) {
            stuckAt = { x: cur.x, y: cur.y, z: cur.z, hp: cur.hp, d, stagnant };
            await hold(["KeyA"], 200);
            await hold(["KeyW", "ShiftLeft"], 300);
          }
        } else {
          stagnant = 0;
        }
        lastD = d;
        await lookToward({ read, hold }, wp.x, wp.z, { tol: 0.25, maxPulses: 10, minPulseMs: 60, maxPulseMs: 400 });
        await hold(["KeyW", "ShiftLeft"], 300);
      }
      s = await read();
      note(
        `wp ${wp.label ?? `${wp.x},${wp.z}`} at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} d=${Math.hypot(wp.x - s.x, wp.z - s.z).toFixed(1)} hp=${s?.hp} mode=${s?.mode}`,
      );
      if (s) {
        result.segments.push({
          label: wp.label ?? `${wp.x},${wp.z}`,
          target: { x: wp.x, z: wp.z },
          arrived: Math.hypot(wp.x - s.x, wp.z - s.z) < 3.2,
          end: { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2) },
          dist: +Math.hypot(wp.x - s.x, wp.z - s.z).toFixed(2),
          hp: s.hp,
          mode: s.mode,
          start: segStart,
          stuckAt,
        });
      }
      // Review17: persist real storageState once we reach the citadel area
      // (y<14 is courtyard floor; dist<80 covers gate approach).
      if (
        s &&
        s.mode === "playing" &&
        s.y > 9.5 &&
        s.y < 14 &&
        Math.hypot(s.x - boss.x, s.z - boss.z) < 35 &&
        !result.courtyardSave
      ) {
        try {
          // Persist live courtyard pose into the game save so the ckpt v2
          // matches the snapshot pos (otherwise v2 is still the crown save).
          await page.evaluate(() => {
            const sim = window.__sim;
            if (sim && typeof sim.save === "function") sim.save();
          });
          await wait(200);
          const ls = await page.evaluate(() => ({
            v2: localStorage.getItem("aetherwake-save-v2"),
            v1: localStorage.getItem("aetherwake-save-v1"),
          }));
          const ckptOut = resolve(outDir, "storage-ckpt-courtyard.json");
          writeFileSync(
            ckptOut,
            JSON.stringify(
              {
                ...ls,
                origin: url,
                label: "courtyard",
                t: Date.now(),
                hasV2: Boolean(ls.v2),
                hasV1: Boolean(ls.v1),
                pos: { x: s.x, y: s.y, z: s.z, hp: s.hp },
              },
              null,
              2,
            ),
          );
          result.courtyardSave = ckptOut;
          note(`courtyard storageState saved ${ckptOut} pos=${s.x?.toFixed?.(1)},${s.y?.toFixed?.(1)},${s.z?.toFixed?.(1)} hp=${s.hp}`);
        } catch (e) {
          note(`courtyard save failed ${e?.message || e}`);
        }
      }
      if (!s || s.mode !== "playing") {
        if (s?.mode === "dead") continue;
        break;
      }
    }
  }

  // Boss loop with shared policy — time budget, not a tiny step cap
  // (a death + re-approach from spawn must still finish the fight).
  const trail = [];
  // Review20: death+far-recover costs ~80s/life; 1.8 dmg × ~11 hits needs room.
  const fightEnd = Date.now() + 900000;
  let i = 0;
  let approachDodges = 0;
  let lastDist = Infinity;
  let stall = 0;
  let sidestepUntil = 0;
  while (Date.now() < fightEnd) {
    i += 1;
    try {
      s = await read();
    } catch (e) {
      note(`read failed during fight: ${e?.message || e}`);
      result.failures.push({ kind: "page-close", i, detail: String(e?.message || e) });
      break;
    }
    if (!s || s.mode !== "playing") {
      if (s?.mode === "ending" || s?.mode === "dead") {
        note(`mode=${s.mode}`);
        if (s.mode === "dead") {
          result.failures.push({
            label: "fight-dead",
            kind: "dead",
            i,
            dist: s.boss ? +Math.hypot(s.x - s.boss.x, s.z - s.boss.z).toFixed(2) : null,
            hp: s.hp,
            bossHp: s.boss?.hp,
            x: s.x,
            y: s.y,
            z: s.z,
            // Review22: short input timeline for this death — not a 900s dump.
            lastDecisions: result.decisions.slice(-12),
            lastDodges: result.dodgeTrail.slice(-4),
          });
          note(
            `dead# timeline lastDec=${JSON.stringify(result.decisions.slice(-6).map((d) => `${d.i}:${d.action}/d=${d.dist}/hp=${d.hp}/${d.phase}`))}`,
          );
          try {
            await page.getByRole("button", { name: "在篝火旁醒来" }).click({ timeout: 1500 });
          } catch {
            await page.keyboard.press("Enter");
          }
          await wait(700);
          continue;
        }
        break;
      }
      break;
    }
    if (s.bossDead || s.mode === "ending") break;
    if (!s.boss?.alive) break;
    // Review19: same planFightTick as unit tests — off-arena/far/stall before policy.
    const tick = planFightTick(s, { stall, lastDist, now: Date.now(), sidestepUntil });
    if (tick.kind === "recover") {
      const dist = tick.dist;
      note(
        `fight off-arena ${tick.reason} d=${dist.toFixed(1)} far=${tick.far} at ${s.x?.toFixed?.(1)},${s.y?.toFixed?.(1)},${s.z?.toFixed?.(1)}; recover`,
      );
      result.failures.push({
        label: "fight-off-arena",
        kind: "off-arena",
        i,
        reason: tick.reason,
        dist,
        far: tick.far,
        x: s.x,
        y: s.y,
        z: s.z,
      });
      // Far respawn (world spawn / crown): long-leg route, not courtyard legs.
      let wps = tick.wps;
      if (tick.far && (s.y > 40 || dist > 40)) {
        wps = [
          { x: 55, z: -115, label: "far-east" },
          { x: 40, z: -95, label: "far-ridge" },
          { x: 24, z: -40, label: "far-base" },
          { x: 6, z: 8, label: "far-gate-south" },
          { x: 6, z: 0.8, label: "far-gate" },
          { x: s.boss.x, z: s.boss.z + 2.4, label: "far-boss" },
        ];
        // Death respawn near crown (y≈19, z≈-123): skip extra ridge hops.
        if (s.y < 40 && s.y > 12 && s.z < -80) {
          wps = [
            { x: 36, z: -90, label: "far-ledge" },
            { x: 24, z: -40, label: "far-base" },
            { x: 6, z: 8, label: "far-gate-south" },
            { x: 6, z: 0.8, label: "far-gate" },
            { x: s.boss.x, z: s.boss.z + 2.4, label: "far-boss" },
          ];
        }
        // World spawn north of gate: walk south first, skip crown ridge.
        if (s.z > 40 && s.y < 40) {
          wps = [
            { x: 5, z: 40, label: "spawn-south" },
            { x: 5, z: 15, label: "spawn-mid" },
            { x: 6, z: 8, label: "far-gate-south" },
            { x: 6, z: 0.8, label: "far-gate" },
            { x: s.boss.x, z: s.boss.z + 2.4, label: "far-boss" },
          ];
        }
      }
      for (const wp of wps) {
        const legMs = String(wp.label || "").startsWith("far") || String(wp.label || "").startsWith("spawn") ? 40000 : 22000;
        const legEnd = Date.now() + legMs;
        while (Date.now() < legEnd) {
          const cur = await read();
          if (!cur || cur.mode !== "playing" || !cur.boss?.alive) break;
          const d = Math.hypot(wp.x - cur.x, wp.z - cur.z);
          if (d < 3.2) break;
          if (cur.state === "climbing") {
            await hold(["KeyC"], 160);
            continue;
          }
          // Review20: do not suicide-walk the last recover leg into a telegraph.
          const dBoss = Math.hypot(cur.x - cur.boss.x, cur.z - cur.boss.z);
          if (
            dBoss < 6 &&
            (cur.boss?.phase === "windup" || cur.boss?.phase === "strike") &&
            (cur.dodgeCd ?? 1) <= 0.05
          ) {
            await hold(["KeyC"], 280);
            continue;
          }
          // Far legs: longer W, fewer look pulses — recover was ~80s and ate the fight window.
          const farLeg = String(wp.label || "").startsWith("far") || String(wp.label || "").startsWith("crown");
          const lastLeg = /boss/i.test(String(wp.label || ""));
          await lookToward({ read, hold }, wp.x, wp.z, {
            tol: farLeg ? 0.35 : 0.25,
            maxPulses: farLeg ? 4 : 8,
            minPulseMs: 60,
            maxPulseMs: farLeg ? 280 : 350,
          });
          // Short steps on the final boss leg so telegraph checks run more often.
          await hold(["KeyW", "ShiftLeft"], lastLeg ? 160 : farLeg ? 420 : 280);
        }
        const after = await read();
        note(
          `fight-recover ${wp.label ?? `${wp.x},${wp.z}`} at ${after?.x?.toFixed?.(1)},${after?.y?.toFixed?.(1)},${after?.z?.toFixed?.(1)} d=${Math.hypot(wp.x - (after?.x ?? 0), wp.z - (after?.z ?? 0)).toFixed(1)}`,
        );
        if (!after || after.mode !== "playing") break;
      }
      stall = 0;
      lastDist = Infinity;
      continue;
    }
    if (tick.kind === "gate-clear" || tick.kind === "sidestep") {
      note(`fight ${tick.kind} ${tick.reason} d=${tick.dist?.toFixed?.(2)}`);
      result.failures.push({
        label: tick.kind,
        kind: tick.kind,
        i,
        dist: tick.dist,
        stall: tick.stall,
      });
      if (tick.kind === "gate-clear") {
        for (const wp of [
          { x: 6, z: 0.8 },
          { x: s.boss.x, z: s.boss.z + 2.0 },
        ]) {
          const legEnd = Date.now() + 12000;
          while (Date.now() < legEnd) {
            const cur = await read();
            if (!cur || cur.mode !== "playing" || !cur.boss?.alive) break;
            const d = Math.hypot(wp.x - cur.x, wp.z - cur.z);
            if (d < 2.5) break;
            if (cur.state === "climbing") {
              await hold(["KeyC"], 160);
              continue;
            }
            await lookToward({ read, hold }, wp.x, wp.z, { tol: 0.25, maxPulses: 6, minPulseMs: 60, maxPulseMs: 300 });
            await hold(["KeyW", "ShiftLeft"], 260);
          }
        }
      } else {
        const side = stall % 50 < 25 ? "KeyA" : "KeyD";
        await hold([side], 320);
        await hold(["KeyW", "ShiftLeft"], 400);
      }
      sidestepUntil = Date.now() + 1200;
      stall = 0;
      continue;
    }
    if (tick.kind !== "fight") {
      note(`fight tick ${tick.kind} ${tick.reason || ""}`);
      break;
    }
    const dist = tick.dist;
    stall = tick.stall ?? stall;
    lastDist = dist;
    const decision = { action: tick.action, reason: tick.reason };
    result.decisions.push({
      i,
      action: decision.action,
      dist: +dist.toFixed(2),
      hp: s.hp,
      bossHp: s.boss.hp,
      phase: s.boss.phase,
      atk: s.attackPhase,
      dodgeCd: +Number(s.dodgeCd ?? 0).toFixed(2),
    });
    if (i < 8 || decision.action === "swing" || i % 10 === 0) {
      note(
        `dec#${i} ${decision.action} ${decision.reason} d=${dist.toFixed(2)} hp=${s.hp?.toFixed?.(2)} bossHp=${s.boss.hp} phase=${s.boss.phase} pos=${s.x?.toFixed?.(1)},${s.y?.toFixed?.(1)},${s.z?.toFixed?.(1)} bossPos=${s.boss.x?.toFixed?.(1)},${s.boss.y?.toFixed?.(1)},${s.boss.z?.toFixed?.(1)}`,
      );
    }
    if (decision.action === "dodge") {
      if (dist > BOSS_MELEE_MAX) approachDodges += 1;
      // Review22 r22: lookToward before KeyC delayed the dash into the strike
      // (dodge#4/#6 still closed or died). play-routes pattern: C + aim keys
      // in ONE hold — i-frames cover the dash; wish dir steers off the boss.
      // Review22 r22b: courtyard-biased strafe (aim=strafe) kept dDist≈0 and
      // died in the strike box. Telegraph dash = away from boss body (same
      // vector as back-off), not citadelDodgeAim's stay-in-yard preference.
      const ax = s.x + (s.x - s.boss.x);
      const az = s.z + (s.z - s.boss.z);
      const dKeys = keysToward(s, ax, az);
      const aim = { x: ax, z: az, reason: "away-body" };
      const before = {
        i,
        reason: decision.reason,
        dist: +dist.toFixed(3),
        hp: s.hp,
        dodgeCd: +Number(s.dodgeCd ?? 0).toFixed(3),
        bossPhase: s.boss.phase,
        state: s.state,
        pos: { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2) },
        boss: { x: +s.boss.x.toFixed(2), z: +s.boss.z.toFixed(2) },
        faceBoss: +facingDot(s, s.boss.x, s.boss.z).toFixed(3),
        faceAim: +facingDot(s, aim.x, aim.z).toFixed(3),
        aim: { x: +aim.x.toFixed(2), z: +aim.z.toFixed(2), reason: aim.reason },
        keys: ["KeyC", ...dKeys],
      };
      await hold(["KeyC", ...dKeys], 280);
      const after = await read();
      const rec = {
        ...before,
        keyC: true,
        after: after
          ? {
              dist: +Math.hypot(after.x - after.boss.x, after.z - after.boss.z).toFixed(3),
              hp: after.hp,
              dodgeCd: +Number(after.dodgeCd ?? 0).toFixed(3),
              bossPhase: after.boss?.phase,
              pos: { x: +after.x.toFixed(2), y: +after.y.toFixed(2), z: +after.z.toFixed(2) },
              faceBoss: +facingDot(after, after.boss.x, after.boss.z).toFixed(3),
            }
          : null,
      };
      if (rec.after) {
        rec.dDist = +(rec.after.dist - rec.dist).toFixed(3);
        rec.hpDelta = +(rec.after.hp - rec.hp).toFixed(3);
      }
      result.dodgeTrail.push(rec);
      note(
        `dodge# ${result.dodgeTrail.length} d=${rec.dist}→${rec.after?.dist} hp=${rec.hp}→${rec.after?.hp} cd=${rec.dodgeCd}→${rec.after?.dodgeCd} faceBoss=${rec.faceBoss} aim=${rec.aim.reason} keys=${rec.keys.join("+")} dDist=${rec.dDist ?? "?"} phase=${rec.bossPhase}→${rec.after?.bossPhase}`,
      );
      s = after ?? s;
    } else if (decision.action === "back-off") {
      // Steer away from the boss, not a fixed S+A that can close distance.
      const bx = s.x + (s.x - s.boss.x);
      const bz = s.z + (s.z - s.boss.z);
      await lookToward({ read, hold }, bx, bz, { tol: 0.4, maxPulses: 3, minPulseMs: 40, maxPulseMs: 160 });
      await hold(["KeyW"], 200);
    } else if (decision.action === "back-off-too-close") {
      const bx = s.x + (s.x - s.boss.x);
      const bz = s.z + (s.z - s.boss.z);
      await lookToward({ read, hold }, bx, bz, { tol: 0.4, maxPulses: 3, minPulseMs: 40, maxPulseMs: 160 });
      await hold(["KeyW"], 180);
    } else if (decision.action === "approach") {
      const sprint = dist > 5;
      // Skip lookToward when already well-aligned — WebGL look was eating the
      // recover window after a successful away-dodge (r22c bossHp stuck 18.2).
      const aligned = (s.faceDot ?? facingDot(s, s.boss.x, s.boss.z)) > 0.85;
      if (!aligned) {
        await lookToward({ read, hold }, s.boss.x, s.boss.z, { tol: 0.22, maxPulses: 8, minPulseMs: 60, maxPulseMs: 400 });
      }
      await hold(sprint ? ["KeyW", "ShiftLeft"] : ["KeyW"], sprint ? 280 : 200);
    } else if (decision.action === "hold-attack") {
      await wait(100);
    } else if (decision.action === "wait-facing") {
      await lookToward({ read, hold }, s.boss.x, s.boss.z, { tol: 0.2, maxPulses: 6, minPulseMs: 60, maxPulseMs: 350 });
    } else if (decision.action === "swing") {
      const hpBefore = s.boss.hp;
      const phaseBefore = s.attackPhase;
      await swing();
      result.swings += 1;
      await wait(200);
      const s2 = await read();
      const hpAfter = s2?.boss?.hp;
      const landed = Number.isFinite(hpAfter) && hpAfter < hpBefore - 0.01;
      if (landed) result.hits += 1;
      trail.push({
        i,
        hpBefore,
        hpAfter,
        landed,
        phaseBefore,
        phaseAfter: s2?.attackPhase,
        playerHp: s2?.hp,
        dist: +dist.toFixed(2),
        bossPhase: s2?.boss?.phase,
      });
      note(
        `swing#${result.swings} hit=${landed} boss ${hpBefore}->${hpAfter} player=${s2?.hp?.toFixed?.(2)} phase=${s2?.boss?.phase}`,
      );
      s = s2;
    }
  }
  s = await read();
  result.hpTrail = trail;
  result.approachDodges = approachDodges;
  result.shots.push(await shot("boss-resume-after.png"));
  result.ok = Boolean(s?.bossDead || s?.mode === "ending");
  result.detail = `bossDead=${s?.bossDead} mode=${s?.mode} bossHp=${s?.boss?.hp} swings=${result.swings} hits=${result.hits} approachDodges=${approachDodges}`;
  note(`done ${result.detail}`);

  if (result.ok) {
    await wait(1200);
    result.shots.push(await shot("boss-resume-ending.png"));
    // reload persistence
    await page.evaluate(() => {
      const sim = window.__sim;
      if (sim && typeof sim.save === "function") sim.save();
    });
    await wait(300);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(1200);
    try {
      const c2 = page.locator("button", { hasText: "继续旅途" });
      if ((await c2.count()) > 0) {
        await c2.first().focus();
        await page.keyboard.press("Enter");
        await wait(700);
      }
    } catch {
      /* ignore */
    }
    const after = await read();
    result.reload = after
      ? { mode: after.mode, bossDead: after.bossDead, towers: after.towers, shrines: after.shrines, orbs: after.orbs }
      : null;
    note(`reload ${JSON.stringify(result.reload)}`);
    result.ok = Boolean(after?.bossDead);
    result.detail += ` reloadBossDead=${after?.bossDead}`;
    result.shots.push(await shot("boss-resume-reload.png"));
  }
} catch (e) {
  result.detail = `error ${e?.message || e}`;
  note(result.detail);
} finally {
  const life = typeof closeFlags.snapshot === "function" ? closeFlags.snapshot() : { ...closeFlags, events: [] };
  const payload = { ...result, runId, ckpt: ckptPath, browserInfo, lifecycle: life, pageErrors, log };
  writeFileSync(resolve(runDir, "boss-resume.json"), JSON.stringify(payload, null, 2));
  writeFileSync(resolve(outDir, "boss-resume.json"), JSON.stringify(payload, null, 2));
  flushed = true;
  note(`json ok=${result.ok} ${result.detail || ""} closeOrder=${life.order || ""}`);
  closeFlags.intentionalTeardown = true;
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(result.ok ? 0 : 1);
}
