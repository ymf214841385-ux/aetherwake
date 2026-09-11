/**
 * Sealed-save Boss continuation (not a full mainline re-run).
 *
 * after-citadel v2 is sealed (3 towers / 4 orbs) but sits on the crown with
 * spicy=0, meals=[], hp=1.5 — frost kills the descent (96566/96987).
 * Default ckpt is tower-mere (orbs=4, 4 shrines, meal 辣炒椒 in bag): eat,
 * climb crown if needed, then the SAME CROWN_TO_CITADEL legs as play-routes
 * 95073. Persist via sim.save() at courtyard and verify v2.player (programmatic
 * save — not UI acceptance). No HP/coord/progress writes.
 *
 *   QA_SAVE_CKPT=.../storage-ckpt-tower-mere.json \
 *   E2E_URL=http://127.0.0.1:8115/ node scripts/qa/run-durable.mjs --name boss-sealed -- scripts/qa/boss-from-sealed.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { bindCloseTracking, browserProcessInfo, qaChromiumLaunchOptions } from "./lifecycle.mjs";
import { installHarnessLifetime } from "./durable-session.mjs";
import {
  appendDiag,
  classifyUnexpectedClose,
  diagnosticCleanup,
  instrumentClosers,
  sampleAfterUnexpectedClose,
} from "./close-diag.mjs";
import { lookToward } from "./nav-walk.mjs";
import { citadelFightStep } from "./boss-fight-policy.mjs";
import { citadelDodgeAim, citadelOffArena, CROWN_TO_CITADEL } from "./citadel-steer.mjs";
import {
  authoredBaseY,
  climbTickPolicy,
  keysForAction,
  reapproachWaypoints,
  towerApproachPoint,
} from "./climb-policy.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(appRoot, "../docs/rebuild-evidence");
const runId = process.env.QA_RUN_ID || `boss-sealed-${Date.now()}`;
const runDir = resolve(outDir, `runs/${runId}`);
mkdirSync(runDir, { recursive: true });
const url = process.env.E2E_URL || "http://127.0.0.1:8115/";
const ckptPath =
  process.env.QA_SAVE_CKPT || resolve(outDir, "storage-ckpt-tower-mere.json");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const harnessLife = installHarnessLifetime({
  name: "boss-sealed",
  lastNote: "boot",
  evidenceLog: resolve(outDir, "boss-sealed-run.log"),
});
const note = (m) => {
  log.push({ t: Date.now(), m });
  console.log(`[boss-sealed] ${m}`);
  try {
    harnessLife?.setLastNote?.(m.slice(0, 120));
  } catch {
    /* ignore */
  }
};

const ckpt = JSON.parse(readFileSync(ckptPath, "utf8"));
if (!ckpt.v2) throw new Error("checkpoint missing v2");
const env0 = typeof ckpt.v2 === "string" ? JSON.parse(ckpt.v2) : ckpt.v2;
note(
  `ckpt ${ckptPath} label=${ckpt.label} player=${JSON.stringify(env0.player)} checkpoint=${JSON.stringify(env0.checkpoint)} orbs=${env0.progress?.orbs}`,
);

// D1: DEBUG=pw:browser must be set by the command environment BEFORE node starts.
// Do not assign it here after playwright is already imported.
if (!process.env.DEBUG) {
  note("WARN DEBUG unset — expected DEBUG=pw:browser in launch env");
}
const headed = process.env.QA_HEADED === "1";
note(`launchMode headed=${headed} QA_HEADED=${process.env.QA_HEADED ?? "unset"} DEBUG=${process.env.DEBUG ?? "unset"}`);

const browser = await chromium.launch({ ...qaChromiumLaunchOptions(), env: { ...process.env } });
const browserInfo = browserProcessInfo(browser, { rootPid: process.pid });
if (browserInfo?.chromiumPid) harnessLife.setChromiumPid(browserInfo.chromiumPid);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const closeFlags = bindCloseTracking(page, context, browser);
instrumentClosers(page, context, browser, runDir, () => closeFlags);
appendDiag(runDir, {
  type: "launch",
  headed,
  chromiumPid: browserInfo?.chromiumPid ?? null,
  runId,
  ckptPath,
  url,
});
note(`chromiumPid=${browserInfo?.chromiumPid ?? "?"} headed=${headed}`);

const result = {
  ok: false,
  runId,
  ckpt: ckptPath,
  restore: null,
  courtyardSave: null,
  swings: 0,
  hits: 0,
  deaths: 0,
  failures: [],
  dodgeTrail: [],
  log,
  closeDiagnosis: null,
  closeSamples: null,
  headed,
  launchMode: headed ? "headed" : "headless",
};

let unexpectedCloseHandled = false;
let inputStopped = false;
/** D1.1: finally awaits this (bounded) so cleanup cannot race the 10s samples. */
let postCloseDiag = null;

function flushPartial(tag) {
  // Append-only: never discard later events after first flush.
  const life = typeof closeFlags.snapshot === "function" ? closeFlags.snapshot() : { ...closeFlags };
  try {
    const payload = { ...result, browserInfo, lifecycle: life, partialTag: tag, log };
    writeFileSync(resolve(runDir, "boss-sealed.json"), JSON.stringify(payload, null, 2));
    writeFileSync(resolve(outDir, "boss-sealed.json"), JSON.stringify(payload, null, 2));
  } catch {
    /* ignore */
  }
  appendDiag(runDir, { type: "flush-partial", tag, order: life.order || "", intentional: life.intentionalTeardown });
}

page.on("close", () => {
  appendDiag(runDir, {
    type: "page-close-event",
    intentional: Boolean(closeFlags.intentionalTeardown),
  });
  if (closeFlags.intentionalTeardown) return;
  if (unexpectedCloseHandled) return;
  unexpectedCloseHandled = true;
  inputStopped = true;
  flushPartial("page-close");
  // D1: sample 0/1/5/10s then diagnostic-cleanup. Outer finally awaits this.
  postCloseDiag = (async () => {
    try {
      const samples = await sampleAfterUnexpectedClose({
        browser,
        context,
        page,
        chromiumPid: browserInfo?.chromiumPid,
        runDir,
      });
      const reason = classifyUnexpectedClose(closeFlags, samples);
      appendDiag(runDir, { type: "unexpected-close-classified", reason, samples });
      result.closeDiagnosis = reason;
      result.closeSamples = samples;
      flushPartial("post-close-samples");
      return { reason, samples };
    } catch (err) {
      appendDiag(runDir, { type: "post-close-diag-error", error: String(err?.message || err) });
      return { reason: { kind: "unknown", observed: true }, samples: [] };
    }
  })();
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
      towers: [...sim.towersOn],
      shrines: [...sim.shrinesOn],
      orbs: sim.orbs,
      bossDead: sim.bossDead,
      sealOpen: typeof sim.sealIsOpen === "function" ? sim.sealIsOpen() : false,
      attackPhase: sim.attack?.phase,
      dodgeCd: sim.player.dodgeCd,
      spicy: sim.player.spicy,
      meals: Array.isArray(sim.meals) ? sim.meals.map((m) => ({ id: m.id, name: m.name })) : [],
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
  if (inputStopped) return;
  const downs = [];
  try {
    for (const k of keys) {
      if (inputStopped) break;
      await page.keyboard.down(k);
      downs.push(k);
    }
    await wait(ms);
  } finally {
    for (const k of [...downs].reverse()) await page.keyboard.up(k).catch(() => {});
  }
}
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
function facingDot(s, tx, tz) {
  const dx = tx - s.x;
  const dz = tz - s.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = -Math.sin(s.camYaw ?? 0);
  const fz = -Math.cos(s.camYaw ?? 0);
  return (dx * fx + dz * fz) / len;
}
async function goTo(tx, tz, ms, arrive = 3.2) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (inputStopped) return read().catch(() => null);
    const s = await read();
    if (!s || s.mode !== "playing") return s;
    const dist = Math.hypot(tx - s.x, tz - s.z);
    if (dist < arrive) return s;
    if (s.state === "climbing") {
      await hold(["KeyC"], 180);
      continue;
    }
    await lookToward({ read, hold }, tx, tz, { tol: 0.28, maxPulses: 6, minPulseMs: 50, maxPulseMs: 280 });
    await hold(["KeyW", "ShiftLeft"], 300);
  }
  return read();
}
async function tryMeleeClick() {
  await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return;
    const opts = { button: 0, bubbles: true, cancelable: true, clientX: 640, clientY: 400 };
    c.dispatchEvent(new MouseEvent("mousedown", opts));
    c.dispatchEvent(new MouseEvent("mouseup", opts));
  });
}

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1000);
  await page.evaluate((v2) => {
    localStorage.setItem("aetherwake-save-v2", v2);
  }, typeof ckpt.v2 === "string" ? ckpt.v2 : JSON.stringify(ckpt.v2));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1200);
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
    sealOpen: s?.sealOpen,
    pos: s ? { x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1) } : null,
  };
  note(`restore ${JSON.stringify(result.restore)}`);
  result.shots = [await shot("boss-sealed-boot.png")];

  // Normal-input eat: Tab opens bag (a.bag). Meal onClick is sim.eat only —
  // bag stays inventory until Tab again (sim.ts: a.bag && inventory → playing).
  // No sim.closeOverlay / no DOM .click() fallback (those are not pointer input).
  const mealsBefore = s?.meals?.length ?? 0;
  const spicyBefore = s?.spicy ?? 0;
  note(`pre-eat meals=${mealsBefore} spicy=${spicyBefore} mode=${s?.mode}`);
  try {
    await page.locator("canvas").focus({ timeout: 2000 });
  } catch {
    /* ignore */
  }
  await page.keyboard.press("Tab");
  await wait(500);
  s = await read();
  note(`bag mode=${s?.mode} meals=${s?.meals?.length}`);
  if (s?.mode === "inventory") {
    // Accessible name is "辣炒椒+2 心"; regex substring works with Playwright.
    const meal = page.getByRole("button", { name: /辣炒椒/ });
    if ((await meal.count()) > 0) {
      await meal.first().click({ timeout: 5000 });
      note("Playwright click 辣炒椒");
    } else {
      note("NO 辣炒椒 button in inventory DOM");
    }
    await wait(300);
    // Close bag with real Tab (a.bag), not Escape (Escape → paused) or sim API.
    await page.keyboard.press("Tab");
    await wait(300);
  }
  s = await read();
  const mealsAfter = s?.meals?.length ?? 0;
  const spicyAfter = s?.spicy ?? 0;
  const ate = mealsAfter < mealsBefore || spicyAfter > spicyBefore;
  note(
    `after eat meals=${mealsAfter}/${mealsBefore} spicy=${spicyAfter}/${spicyBefore} mode=${s?.mode} hp=${s?.hp} ate=${ate}`,
  );
  if (!ate) note("eat NOT verified — meals/spicy unchanged");
  if (s?.mode !== "playing") {
    note(`mode=${s?.mode} after Tab — bag did not return to playing`);
  }

  // tower-mere save: walk 95073 crown legs, then climb.
  if (s && !s.towers?.includes("crown")) {
    const crown = { x: 48, z: -128, y: 16.8 };
    note("walk crown legs then climb (mere save has 4 orbs + meal)");
    for (const wp of [
      { x: -80, z: 0 },
      { x: -40, z: -20 },
      { x: 24, z: -40 },
      { x: 36, z: -90 },
      { x: 48, z: -122 },
    ]) {
      s = await goTo(wp.x, wp.z, 50000, 4);
      note(`crown-leg ${wp.x},${wp.z} at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} hp=${s?.hp}`);
      if (!s || s.mode !== "playing" || s.mode === "dead" || s.state === "dead") break;
    }
    if (s && s.mode === "playing" && s.state !== "dead") {
      const approach = towerApproachPoint(crown, "crown");
      s = await goTo(approach.x, approach.z, 30000, 2.2);
      note(`crown approach at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} state=${s?.state}`);
      const baseY = authoredBaseY("crown", crown.y);
      let burstUntil = Date.now() + 1200;
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline) {
        s = await read();
        if (!s || s.mode !== "playing") break;
        if (s.towers?.includes("crown")) {
          note(`crown lit towers=${s.towers}`);
          break;
        }
        if (s.mode === "dead" || s.state === "dead") {
          result.deaths += 1;
          note("dead climbing crown");
          break;
        }
        const action = climbTickPolicy(s, {
          id: "crown",
          tw: crown,
          baseY,
          burstUntil,
          now: Date.now(),
        });
        if (action.type === "activate") {
          await page.keyboard.press("KeyE");
          await wait(300);
          continue;
        }
        if (action.type === "rest") {
          await wait(380);
          continue;
        }
        if (action.type === "regrab") {
          const grabKeys = keysForAction(action);
          for (const k of grabKeys) await page.keyboard.down(k);
          await wait(900);
          for (const k of [...grabKeys].reverse()) await page.keyboard.up(k).catch(() => {});
          burstUntil = Date.now() + 1200;
          continue;
        }
        if (action.type === "reapproach") {
          for (const wp of reapproachWaypoints(s, crown, "crown")) {
            await goTo(wp.x, wp.z, 12000, 2.4);
          }
          burstUntil = Date.now() + 1200;
          continue;
        }
        await hold(["KeyW"], 200);
      }
      s = await read();
      note(`after crown climb towers=${s?.towers} y=${s?.y} seal=${s?.sealOpen}`);
      // Game already auto-saved on tower activate (sim.ts this.save()).
      // Archive raw v2 + real pose — do not relabel a tower-top file as courtyard.
      try {
        const rawV2 = await page.evaluate(() => localStorage.getItem("aetherwake-save-v2"));
        if (rawV2) {
          writeFileSync(resolve(runDir, "storage-v2-after-crown.json"), rawV2);
          const env = JSON.parse(rawV2);
          note(
            `auto-save v2.player=${JSON.stringify(env.player)} checkpoint=${JSON.stringify(env.checkpoint)}`,
          );
          result.afterCrownSave = {
            programmaticGameAutoSave: true,
            player: env.player,
            checkpoint: env.checkpoint,
            towers: env.progress?.towers,
          };
        }
      } catch (e) {
        note(`archive v2 after crown failed ${e?.message || e}`);
      }
      // 95073 leaveTower: radial off the shaft before descent (anti fall-damage).
      if (s && s.towers?.includes("crown") && s.y > 40) {
        const tw = { x: 48, z: -128 };
        const dx = s.x - tw.x;
        const dz = s.z - tw.z;
        const len = Math.hypot(dx, dz) || 1;
        const out = { x: tw.x + (dx / len) * 18, z: tw.z + (dz / len) * 18 };
        note(`crown leave radially to ${out.x.toFixed(1)},${out.z.toFixed(1)} from y=${s.y.toFixed(1)} ${s.state}`);
        if (s.state === "climbing") {
          await hold(["KeyC"], 200);
          await wait(250);
        }
        await lookToward({ read, hold }, out.x, out.z, { tol: 0.3, maxPulses: 6, minPulseMs: 40, maxPulseMs: 200 });
        s = await goTo(out.x, out.z, 20000, 2.6);
        note(`crown left at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} hp=${s?.hp}`);
      }
    }
  }

  if (!s?.sealOpen) {
    note(`seal still closed towers=${s?.towers} orbs=${s?.orbs} — cannot fight boss`);
    result.failures.push({ label: "seal", kind: "closed", towers: s?.towers, orbs: s?.orbs });
  } else {
  // Same legs as play-routes fightBoss from a crown-top pose.
  note(`descent ${CROWN_TO_CITADEL.map((w) => w.label).join(" → ")}`);
  for (const wp of CROWN_TO_CITADEL) {
    const legMs = wp.label.includes("crown") || wp.x === 36 || wp.x === 24 ? 45000 : 30000;
    s = await goTo(wp.x, wp.z, legMs, 3.5);
    note(
      `wp ${wp.label} at ${s?.x?.toFixed?.(1)},${s?.y?.toFixed?.(1)},${s?.z?.toFixed?.(1)} d=${s ? Math.hypot(wp.x - s.x, wp.z - s.z).toFixed(1) : "?"} hp=${s?.hp}`,
    );
    if (!s || s.mode !== "playing") break;
    if (s.mode === "dead" || s.state === "dead") {
      result.deaths += 1;
      note(`dead on ${wp.label} — stop (no fake pose)`);
      result.failures.push({ label: wp.label, kind: "dead", x: s.x, y: s.y, z: s.z });
      break;
    }
  }
  s = await read();
  result.shots.push(await shot("boss-sealed-courtyard.png"));

  // Programmatic save at courtyard — not a UI click acceptance.
  const onCourtyard = Boolean(s && s.mode === "playing" && s.y < 14 && s.y > 8 && Math.abs(s.x - 6) < 16);
  if (onCourtyard) {
    await page.evaluate(() => {
      const sim = window.__sim;
      if (sim && typeof sim.save === "function") sim.save();
    });
    await wait(250);
    const raw = await page.evaluate(() => localStorage.getItem("aetherwake-save-v2"));
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      /* ignore */
    }
    result.courtyardSave = {
      programmatic: true,
      player: parsed?.player || null,
      checkpoint: parsed?.checkpoint || null,
      orbs: parsed?.progress?.orbs,
    };
    note(
      `courtyard sim.save() v2.player=${JSON.stringify(result.courtyardSave.player)} (programmatic, not UI)`,
    );
    const py = result.courtyardSave.player;
    if (!py || py.y > 16 || py.z < -30) {
      note("courtyard save player pose NOT on courtyard — fail");
      result.failures.push({ label: "courtyard-save", kind: "bad-pose", player: py });
    }
  } else {
    note(`not on courtyard y=${s?.y} x=${s?.x} — skip save`);
    result.failures.push({ label: "courtyard-arrive", kind: "not-on-courtyard", s });
  }

  if (onCourtyard && s?.boss?.alive) {
    const end = Date.now() + 300000;
    while (Date.now() < end) {
      s = await read();
      if (!s || s.mode !== "playing") break;
      if (s.bossDead || s.mode === "ending") break;
      if (s.mode === "dead" || s.state === "dead" || s.hp <= 0) {
        result.deaths += 1;
        note(`fight dead n=${result.deaths}`);
        break;
      }
      const boss = s.boss;
      if (!boss?.alive) break;
      let dist = Math.hypot(s.x - boss.x, s.z - boss.z);
      if (dist > 8) {
        const off = citadelOffArena(s, boss);
        note(`reapproach d=${dist.toFixed(1)} off=${off.reason}`);
        if (s.y > 40) {
          await goTo(36, -90, 25000, 4);
          await goTo(24, -40, 25000, 5);
        }
        await goTo(6, 8, 18000, 3.5);
        s = await goTo(boss.x, boss.z, 16000, 4.2);
        continue;
      }
      await lookToward({ read, hold }, boss.x, boss.z, { tol: 0.25, maxPulses: 6, minPulseMs: 40, maxPulseMs: 250 });
      s = await read();
      if (!s?.boss) break;
      dist = Math.hypot(s.x - s.boss.x, s.z - s.boss.z);
      const faceDot = facingDot(s, s.boss.x, s.boss.z);
      const step = citadelFightStep({
        hp: s.hp,
        dist,
        bossPhase: s.boss.phase,
        bossHp: s.boss.hp,
        state: s.state,
        dodgeCd: s.dodgeCd,
        attackPhase: s.attackPhase,
        faceDot,
      });
      if (step.act === "dodge") {
        const aim = citadelDodgeAim({ x: s.x, z: s.z, y: s.y }, s.boss);
        const dKeys = keysToward(s, aim.x, aim.z);
        result.dodgeTrail.push({ dist, phase: s.boss.phase, keys: dKeys, aim: aim.reason });
        await hold(["KeyC", ...dKeys], 280);
        continue;
      }
      if (step.act === "back-off" || step.act === "back-off-too-close") {
        await hold(["KeyS", "KeyA"], 200);
        continue;
      }
      if (step.act === "approach") {
        await hold(keysToward(s, s.boss.x, s.boss.z), 160);
        continue;
      }
      if (step.act === "hold-attack") {
        await wait(90);
        continue;
      }
      if (step.act === "wait-facing") {
        await lookToward({ read, hold }, s.boss.x, s.boss.z, { tol: 0.22, maxPulses: 5, minPulseMs: 40, maxPulseMs: 200 });
        continue;
      }
      const hpBefore = s.boss.hp;
      await tryMeleeClick();
      await wait(180);
      s = await read();
      result.swings += 1;
      const landed = s?.boss?.hp < hpBefore - 0.01;
      if (landed) result.hits += 1;
      if (result.swings <= 6 || landed || result.swings % 5 === 0) {
        note(
          `swing#${result.swings} hit=${landed} boss ${hpBefore}->${s?.boss?.hp} d=${s && s.boss ? Math.hypot(s.x - s.boss.x, s.z - s.boss.z).toFixed(2) : "?"} playerHp=${s?.hp} phase=${s?.boss?.phase}`,
        );
      }
    }
    s = await read();
    result.ok = Boolean(s?.bossDead || s?.mode === "ending");
    result.detail = `bossDead=${s?.bossDead} mode=${s?.mode} bossHp=${s?.boss?.hp} swings=${result.swings} hits=${result.hits} deaths=${result.deaths}`;
    note(`done ${result.detail}`);
    result.shots.push(await shot("boss-sealed-after.png"));
    if (result.ok) {
      // Ending reload: programmatic save then refresh continue.
      await page.evaluate(() => window.__sim?.save?.());
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
      result.reload = {
        mode: after?.mode,
        bossDead: after?.bossDead,
        towers: after?.towers,
        orbs: after?.orbs,
      };
      note(`reload ${JSON.stringify(result.reload)}`);
      result.ok = Boolean(after?.bossDead);
      result.shots.push(await shot("boss-sealed-reload.png"));
    }
  }
  } // end sealOpen else
} catch (e) {
  result.detail = `error ${e?.message || e}`;
  note(result.detail);
} finally {
  // D1.1: report+cleanup always run; report write failure must not skip cleanup.
  let reportErr = null;
  try {
    if (postCloseDiag) {
      await Promise.race([
        postCloseDiag,
        wait(12000).then(() => ({ reason: { kind: "unknown", observed: true }, samples: [] })),
      ]);
    }
    const life = typeof closeFlags.snapshot === "function" ? closeFlags.snapshot() : { ...closeFlags };
    const payload = { ...result, browserInfo, lifecycle: life, log };
    try {
      writeFileSync(resolve(runDir, "boss-sealed.json"), JSON.stringify(payload, null, 2));
      writeFileSync(resolve(outDir, "boss-sealed.json"), JSON.stringify(payload, null, 2));
    } catch (we) {
      reportErr = String(we?.message || we);
      appendDiag(runDir, { type: "report-write-error", error: reportErr });
    }
    note(`json ok=${result.ok} ${result.detail || ""} closeOrder=${life.order || ""}`);
    harnessLife?.setCloseReason?.({
      kind: life.pageClosed ? "page.close" : life.crashed ? "crash" : life.browserDisconnected ? "browser-disconnected" : "exit",
      detail: life.order || "",
      intentional: Boolean(life.intentionalTeardown),
    });
    harnessLife?.writeExit?.({
      exitCode: result.ok ? 0 : reportErr ? 2 : 1,
      error: result.detail || reportErr || null,
      closeReason: harnessLife?.state?.closeReason,
      stack: reportErr ? new Error(reportErr).stack : undefined,
    });
  } catch (fe) {
    try {
      harnessLife?.writeExit?.({
        exitCode: 1,
        error: String(fe?.message || fe),
        stack: fe?.stack,
      });
    } catch {
      /* ignore */
    }
  } finally {
    // Bounded cleanup — never skip even if report/writeExit failed.
    try {
      closeFlags.intentionalTeardown = true;
    } catch {
      /* ignore */
    }
    await Promise.race([
      (async () => {
        try {
          if (!unexpectedCloseHandled) {
            await diagnosticCleanup({
              context,
              browser,
              runDir,
              flags: closeFlags,
              closeReason: "finally-cleanup",
            });
          } else {
            // unexpected path already sampled; still ensure closers
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
          }
        } catch {
          /* ignore */
        }
      })(),
      wait(5000),
    ]);
    try {
      harnessLife?.dispose?.();
    } catch {
      /* ignore */
    }
    process.exit(result.ok ? 0 : reportErr ? 2 : 1);
  }
}
