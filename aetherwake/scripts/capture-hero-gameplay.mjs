#!/usr/bin/env node
/**
 * Scene.tsx visual-fixture closeups of the wanderer.
 *
 * Loads the real Vite app (createWanderer / animateWanderer via Scene.tsx).
 * This is not normal-input gameplay acceptance. Camera is forced close at screenshot time because
 * sim.updateCamera always lerps dist back to CAM_DIST (6.2 m).
 *
 * Isolated character-module shots remain capture-character.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const repoRoot = resolve(appRoot, "..");
// Keep prior character evidence intact. This capture-only fixture accepts a
// separate evidence folder for review rounds.
const outDir = resolve(process.env.AW_GAMEPLAY_OUT_DIR || resolve(repoRoot, "docs/rebuild-evidence/character"));
const PREVIEW_GLB_URL = "/__terra-preview/wanderer-v4.glb";

const SHOTS = [
  { file: "scene-front.png", label: "SCENE FRONT", yaw: 0, pitch: -0.02, dist: 3.3, lookY: 0.92, motion: "idle" },
  { file: "scene-side.png", label: "SCENE SIDE", yaw: Math.PI / 2, pitch: 0, dist: 3.35, lookY: 0.92, motion: "idle" },
  { file: "scene-back.png", label: "SCENE BACK", yaw: Math.PI, pitch: -0.02, dist: 3.3, lookY: 0.92, motion: "idle" },
  { file: "scene-face.png", label: "SCENE FACE", yaw: 0.08, pitch: -0.04, dist: 0.58, lookY: 1.56, motion: "idle" },
  { file: "scene-hands.png", label: "SCENE HANDS", yaw: 0.72, pitch: -0.16, dist: 0.36, lookY: 0.84, lookX: 0.2, lookZ: 0.05, motion: "idle" },
  { file: "scene-walk.png", label: "SCENE WALK", yaw: 0.55, pitch: -0.02, dist: 3.2, lookY: 0.92, motion: "walk" },
  { file: "scene-run.png", label: "SCENE RUN", yaw: 0.55, pitch: 0, dist: 3.35, lookY: 0.94, motion: "run" },
  { file: "scene-attack.png", label: "SCENE ATTACK", yaw: 0.45, pitch: -0.02, dist: 3.3, lookY: 0.96, motion: "attack" },
  { file: "scene-climb.png", label: "SCENE CLIMB", yaw: 0.4, pitch: 0.04, dist: 3.15, lookY: 1.05, motion: "climb" },
  { file: "scene-glide.png", label: "SCENE GLIDE", yaw: 0.45, pitch: 0.12, dist: 3.6, lookY: 1.05, motion: "glide" },
];

const REQUIRED_V4_CLIPS = ["Idle", "Walk", "Run", "Attack", "Climb", "Glide"];
const FIXTURE_FREEZE_FRAMES = 5;
const FIXTURE_OVERLAYS = [
  {
    selector: ".hint",
    // The fixture suppresses every tutorial hint. Text is intentionally not
    // part of this selector: the live game can advance to a different hint
    // between shots. This has no effect unless the fixture attribute below is
    // installed by this capture script.
    all: true,
  },
  {
    selector: ".hud-tr > .objective",
    text: "登上晨光塔，眺望这片原野",
  },
];

export function buildGameplayCaptureSummary({ port, asset, candidate, written, logs }) {
  // Summary assembly is deliberately independent of the browser closure. The
  // supplied value is the exact ready-state metadata observed from the page,
  // rather than a reconstructed asset description.
  if (!asset || asset.status !== "ready") {
    throw new Error(`cannot assemble visual fixture summary without ready loaded-asset metadata: ${JSON.stringify(asset)}`);
  }
  return {
    ok: true,
    fixture: "visual-fixture-only; not normal-input gameplay acceptance",
    method: "vite-dev+playwright Scene.tsx closeup (camera forced near hero; no canvas click/pointer lock)",
    port,
    asset,
    candidate,
    written,
    logs,
  };
}

/**
 * Confirm that the rendered fixture did not merely stop `sim.step`: Scene's
 * frame loop still calls `animateWanderer`, so this compares the mixer action
 * and real skinned pose over multiple rendered frames.
 */
export function assertFrozenFixtureAnimation(samples, expectedClip) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new Error(`fixture freeze produced too few rendered-frame samples: ${JSON.stringify(samples)}`);
  }
  const first = samples[0];
  const fields = ["simTime", "clip", "phase", "actionTime"];
  const poseFields = ["rightHand", "skinVertex"];
  if (first?.clip !== expectedClip || !first?.rightHand || !first?.skinVertex) {
    throw new Error(`fixture freeze began without a tracked ${expectedClip} pose: ${JSON.stringify(first)}`);
  }
  for (const sample of samples.slice(1)) {
    if (!sample?.rightHand || !sample?.skinVertex) {
      throw new Error(`fixture freeze lost tracked hand/skin pose: ${JSON.stringify(sample)}`);
    }
    for (const field of fields) {
      if (sample[field] !== first[field]) {
        throw new Error(`fixture freeze changed ${field} across rendered frames: ${JSON.stringify({ first, sample })}`);
      }
    }
    for (const field of poseFields) {
      if (sample[field].length !== first[field].length || sample[field].some((value, index) => value !== first[field][index])) {
        throw new Error(`fixture freeze changed ${field} across rendered frames: ${JSON.stringify({ first, sample })}`);
      }
    }
  }
  return {
    frames: samples.length,
    simTime: first.simTime,
    clip: first.clip,
    phase: first.phase,
    actionTime: first.actionTime,
    rightHand: first.rightHand,
    skinVertex: first.skinVertex,
  };
}

function writeCaptureJson(payload) {
  const path = checkedOutputPath(resolve(outDir, "gameplay-capture-summary.json"), [outDir], "capture summary");
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function resolveCaptureCandidate() {
  const configured = process.env.AW_GAMEPLAY_CANDIDATE_GLB;
  if (!configured) return null;
  const path = resolve(configured);
  if (!existsSync(path)) throw new Error(`fixture candidate GLB does not exist: ${path}`);
  const bytes = readFileSync(path);
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    delivery: "Playwright route override of the dev-only preview URL; normal runtime assets are unchanged",
  };
}

function spawnX() {
  return 16;
}
function spawnZ() {
  return 100;
}

export async function runGameplayCapture() {
  mkdirSync(outDir, { recursive: true });
  const candidate = resolveCaptureCandidate();
  const port = Number(process.env.AW_GAMEPLAY_PORT || 8790);
  if (port === 8080 || port === 8091) {
    throw new Error("gameplay capture must not bind 8080/8091");
  }

  const server = await createServer({
    configFile: resolve(appRoot, "vite.config.ts"),
    // The workspace intentionally shares node_modules read-only. Runner mode
    // avoids Vite's default node_modules/.vite-temp config bundle.
    configLoader: "runner",
    root: appRoot,
    // Keep capture optimizer artifacts local to this isolated worktree.
    cacheDir: resolve(repoRoot, ".vite-terra-capture"),
    server: { port, host: "127.0.0.1", strictPort: true, hmr: false },
  });
  await server.listen();

  const url = checkedUrl(`http://127.0.0.1:${port}/`);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (candidate) {
    // The Vite middleware remains deliberately v4-named and opt-in.  This
    // local browser route is the only v6 transport: it never reaches a
    // normal game, dev server, public asset, or release build.
    await page.route(`**${PREVIEW_GLB_URL}`, (route) => route.fulfill({ path: candidate.path, contentType: "model/gltf-binary" }));
  }
  const logs = [];
  page.on("pageerror", (err) => logs.push(`pageerror ${err.message}`));
  const written = [];
  let idlePose = null;
  // This must outlive the try/finally: r4 correctly observed this metadata,
  // then lost it at JSON assembly because its declaration was try-scoped.
  let asset = null;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => Boolean(window.__sim), { timeout: 45000 });
    await page.waitForFunction(
      () => ["ready", "loadererror"].includes(window.__AW_CHARACTER_LOAD?.status),
      { timeout: 45000 },
    );
    asset = await page.evaluate(() => window.__AW_CHARACTER_LOAD ?? null);
    if (!asset || asset.status !== "ready") {
      throw new Error(`character GLB did not become ready: ${JSON.stringify(asset)}`);
    }
    if (candidate && asset.source !== PREVIEW_GLB_URL) {
      throw new Error(`fixture candidate was not requested through the isolated preview route: ${JSON.stringify(asset)}`);
    }
    const clipNames = (asset.clips || []).map((clip) => clip.name);
    const missing = REQUIRED_V4_CLIPS.filter((name) => !clipNames.includes(name));
    if (missing.length) {
      throw new Error(`candidate GLB missing required clips: ${missing.join(", ")}`);
    }
    const start = page.getByRole("button", { name: "开始探索" });
    if (await start.count()) {
      await start.click();
      await page.waitForTimeout(600);
    }
    await page.waitForFunction(() => window.__sim && window.__sim.mode === "playing", { timeout: 20000 });
    await page.waitForTimeout(900);

    await page.evaluate(() => {
      const sim = window.__sim;
      if (!sim) return;
      sim.mode = "playing";
      if (sim.settings) {
        sim.settings.lockDay = true;
        sim.settings.quality = sim.settings.quality || "high";
      }
      sim.timeOfDay = 0.38;
      // Fixture-only presentation: hide tutorial hints without changing the
      // runtime tutorial state or shipped HUD. This prevents any live hint
      // variant from obscuring a closeup while retaining normal game behavior.
      document.documentElement.dataset.awHeroFixture = "true";
      const style = document.createElement("style");
      style.dataset.awHeroFixture = "true";
      style.textContent = [
        "html[data-aw-hero-fixture] [data-aw-hero-fixture-hidden] { display: none !important; }",
        ".aw-hero-fixture-label { position: fixed; right: 12px; bottom: 10px; z-index: 10000; padding: 4px 7px; border: 1px solid #d8c4a0; background: #161b20cc; color: #f4ead3; font: 600 10px/1.2 system-ui; letter-spacing: .06em; pointer-events: none; }",
      ].join("\n");
      document.head.append(style);
      const fixtureLabel = document.createElement("p");
      fixtureLabel.className = "aw-hero-fixture-label";
      fixtureLabel.textContent = "VISUAL FIXTURE · NOT NORMAL-INPUT GAMEPLAY";
      document.body.append(fixtureLabel);
      const fixtureOverlays = [
        {
          selector: ".hint",
          all: true,
        },
        {
          selector: ".hud-tr > .objective",
          text: "登上晨光塔，眺望这片原野",
        },
      ];
      window.__AW_HERO_FIXTURE_HIDE_OVERLAYS = () => {
        const records = fixtureOverlays.map(({ selector, text, all }) => {
          const matches = [...document.querySelectorAll(selector)].filter((el) => all || el.textContent?.trim() === text);
          for (const el of matches) {
            el.setAttribute("data-aw-hero-fixture-hidden", "");
            // React may replace HUD nodes between shots, so use an inline
            // fixture-only property as well as the scoped stylesheet.
            el.style.setProperty("display", "none", "important");
          }
          const visible = matches.filter((el) => {
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
          });
          return { selector, text: all ? "<all>" : text, all: Boolean(all), matched: matches.length, visible: visible.length };
        });
        return records;
      };
      // Scene continues to call animateWanderer every rendered frame even
      // when sim.step does no work.  Keep the freeze limited to this browser
      // fixture, then independently sample that the mixer and actual skinned
      // hand/vertex stay unchanged before a screenshot is permitted.
      window.__AW_HERO_FIXTURE_SET_SIM_FROZEN = (frozen) => {
        const sim = window.__sim;
        if (!sim) return { frozen: false, simTime: null };
        const state = (window.__AW_HERO_FIXTURE_STATE ??= {});
        state.step ??= sim.step;
        sim.step = frozen ? () => {} : state.step;
        state.frozen = Boolean(frozen);
        return { frozen: state.frozen, simTime: sim.t };
      };
      window.__AW_HERO_FIXTURE_SAMPLE_FROZEN = async (frames) => {
        const sample = () => {
          const animation = window.__AW_CHARACTER_ANIMATION;
          const pose = animation?.fixturePose;
          return {
            simTime: window.__sim?.t ?? null,
            clip: animation?.clip ?? null,
            phase: animation?.phase ?? null,
            actionTime: animation?.actionTime ?? null,
            rightHand: pose?.rightHand ? [...pose.rightHand] : null,
            skinVertex: pose?.skinVertex ? [...pose.skinVertex] : null,
          };
        };
        const samples = [sample()];
        for (let frame = 0; frame < frames; frame++) {
          await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
          samples.push(sample());
        }
        return samples;
      };
      const orig = sim.updateCamera.bind(sim);
      sim.updateCamera = function updateCameraPatched(dt) {
        orig(dt);
        const shot = window.__AW_HERO_SHOT;
        if (!shot) return;
        const p = this.player;
        const lookX = p.x + (shot.lookX ?? 0);
        const lookY = p.y + (shot.lookY ?? 0.92);
        const lookZ = p.z + (shot.lookZ ?? 0);
        const pitch = shot.pitch;
        const yaw = shot.yaw;
        const dist = shot.dist;
        this.cam.dist = dist;
        this.cam.yaw = yaw;
        this.cam.pitch = pitch;
        this.cam.x = lookX + Math.sin(yaw) * Math.cos(pitch) * dist;
        this.cam.y = lookY + Math.sin(pitch) * dist;
        this.cam.z = lookZ + Math.cos(yaw) * Math.cos(pitch) * dist;
        this.cam.lx = lookX;
        this.cam.ly = lookY;
        this.cam.lz = lookZ;
      };
    });

    for (const shot of SHOTS) {
      // Each pose must be reached by the real simulation before its bounded
      // freeze; never let one fixture shot leak its frozen step into the next.
      await page.evaluate(() => window.__AW_HERO_FIXTURE_SET_SIM_FROZEN?.(false));
      await page.keyboard.up("KeyW").catch(() => {});
      await page.keyboard.up("ShiftLeft").catch(() => {});
      await page.keyboard.up("KeyE").catch(() => {});

      const mode = await page.evaluate(() => window.__sim?.mode);
      if (mode === "title") {
        const again = page.getByRole("button", { name: "开始探索" });
        if (await again.count()) await again.click();
        await page.waitForFunction(() => window.__sim && window.__sim.mode === "playing", { timeout: 20000 });
        await page.waitForTimeout(400);
      }

      const placed = await page.evaluate(
        ({ x, z, motion }) => {
          const sim = window.__sim;
          if (!sim) return { ok: false };
          sim.mode = "playing";
          sim.player.hp = sim.player.heartsMax;
          sim.player.stamina = sim.player.staminaMax ?? 100;
          sim.player.invuln = 30;
          sim.player.vx = 0;
          sim.player.vz = 0;
          if (motion === "climb") {
            const twX = 10;
            const twZ = 68;
            const wallZ = twZ + 4.7;
            sim.player.x = twX;
            sim.player.z = wallZ;
            sim.player.y = (typeof sim.heightFn === "function" ? sim.heightFn(twX, wallZ) : 0) + 8.4;
            sim.player.yaw = 0;
            sim.player.vy = 0;
            sim.setMove("climbing");
            return { ok: true, y: sim.player.y, state: sim.player.state, placed: "dawn-shaft" };
          }
          sim.player.x = x;
          sim.player.z = z;
          sim.player.y = sim.heightFn(x, z) + (motion === "glide" ? 7 : 0.05);
          sim.player.yaw = 0;
          sim.player.vy = motion === "glide" ? -0.4 : 0;
          if (motion === "glide") sim.setMove("gliding");
          else sim.setMove("grounded");
          return { ok: true, y: sim.player.y, state: sim.player.state };
        },
        { x: spawnX(), z: spawnZ(), motion: shot.motion },
      );
      void placed;

      await page.evaluate((s) => {
        window.__AW_HERO_SHOT = {
          yaw: s.yaw,
          pitch: s.pitch,
          dist: s.dist,
          lookY: s.lookY,
          lookX: s.lookX ?? 0,
          lookZ: s.lookZ ?? 0,
        };
      }, shot);

      if (shot.motion === "walk") {
        await page.keyboard.down("KeyW");
        await page.waitForTimeout(1100);
      } else if (shot.motion === "run") {
        await page.keyboard.down("ShiftLeft");
        await page.keyboard.down("KeyW");
        for (let i = 0; i < 18; i++) {
          await page.waitForTimeout(120);
          const spd = await page.evaluate(() => {
            const p = window.__sim?.player;
            return p ? Math.hypot(p.vx, p.vz) : 0;
          });
          if (spd > 5.6) break;
        }
      } else if (shot.motion === "attack") {
        // At desktop viewport the touch control is intentionally absent. Send
        // a real mousedown through the app's bound .canvas-wrap input listener
        // without a click, so GameClient's Canvas onClick cannot request pointer
        // lock. This exercises input.ts -> Sim.handleCombat, rather than forcing
        // attack state or an animation clip.
        await page.locator(".canvas-wrap").dispatchEvent("mousedown", { button: 0, buttons: 1 });
      } else if (shot.motion === "climb") {
        await page.keyboard.down("KeyW");
        await page.keyboard.down("KeyE");
        await page.waitForTimeout(700);
      } else if (shot.motion === "glide") {
        await page.waitForTimeout(520);
      } else {
        await page.waitForTimeout(480);
      }

      const expectedClip = shot.motion[0].toUpperCase() + shot.motion.slice(1);
      await page.waitForFunction(
        ({ motion, expectedClip }) => {
          const sim = window.__sim;
          const animation = window.__AW_CHARACTER_ANIMATION;
          if (!sim || animation?.clip !== expectedClip) return false;
          // The real Attack clip has a clear right-hand sweep around its
          // midpoint. r4 accepted phase 0.08, which was still near its
          // authored A-pose start and could not prove a readable slash.
          if (motion === "attack") return animation.phase >= 0.46 && animation.phase <= 0.72;
          if (motion === "climb") return sim.player.climbing;
          if (motion === "glide") return sim.player.gliding;
          if (motion === "walk") return Math.hypot(sim.player.vx, sim.player.vz) > 0.4;
          if (motion === "run") return Math.hypot(sim.player.vx, sim.player.vz) > 5.6;
          return sim.player.grounded && Math.hypot(sim.player.vx, sim.player.vz) < 0.2;
        },
        { motion: shot.motion, expectedClip },
        { timeout: 20000 },
      );
      const observed = await page.evaluate(() => {
        const sim = window.__sim;
        const animation = window.__AW_CHARACTER_ANIMATION ?? null;
        return sim
          ? {
              mode: sim.mode,
              state: sim.player.state,
              gliding: sim.player.gliding,
              climbing: sim.player.climbing,
              grounded: sim.player.grounded,
              spd: Math.hypot(sim.player.vx, sim.player.vz),
              animation,
            }
          : null;
      });
      if (observed?.animation?.clip !== expectedClip) {
        throw new Error(`${shot.label} expected active ${expectedClip} clip; observed ${JSON.stringify(observed?.animation)}`);
      }
      const animation = observed?.animation;
      if (!animation?.mixerRootMatches || animation.unresolvedTrackTargets?.length) {
        throw new Error(`${shot.label} animation mixer/track identity mismatch: ${JSON.stringify(animation)}`);
      }
      if (shot.motion === "idle" && !idlePose && animation.fixturePose?.rightHand && animation.fixturePose?.skinVertex) {
        idlePose = animation.fixturePose;
      }
      if (shot.motion === "attack") {
        const pose = animation.fixturePose;
        if (!pose?.rightHand || !pose?.skinVertex || animation.effectiveWeight < 0.99 || animation.effectiveTimeScale < 2.5) {
          throw new Error(`${shot.label} did not have a fully weighted, sampled Attack pose: ${JSON.stringify(animation)}`);
        }
        if (idlePose) {
          const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
          const handTravel = distance(pose.rightHand, idlePose.rightHand);
          const skinTravel = distance(pose.skinVertex, idlePose.skinVertex);
          if (handTravel <= 0.18 || skinTravel <= 0.08) {
            throw new Error(`${shot.label} Attack did not deform the actual hand/skin enough: ${JSON.stringify({ handTravel, skinTravel, idlePose, pose })}`);
          }
        }
      }
      if ((shot.motion === "climb" && !observed.climbing) || (shot.motion === "glide" && !observed.gliding)) {
        throw new Error(`${shot.label} did not reach its active runtime state: ${JSON.stringify(observed)}`);
      }
      const gear = observed?.animation?.fixtureGear;
      if (
        shot.motion === "attack" &&
        // The measured v4 palm socket intentionally places the sword origin
        // 0.145 m along handR's local +Y so the grip, not the blade origin,
        // sits in the palm. The old <= 0.12 check rejected that correct mount.
        (!gear?.sword || gear.sword.visibleMeshCount < 5 || !gear.sword.boundsSize || gear.sword.distanceToAnchor == null || gear.sword.distanceToAnchor < 0.12 || gear.sword.distanceToAnchor > 0.17)
      ) {
        throw new Error(`${shot.label} sword is not rendered at the hand attachment: ${JSON.stringify(gear?.sword)}`);
      }
      if (
        shot.motion === "glide" &&
        (!gear?.glider || gear.glider.visibleMeshCount < 2 || !gear.glider.boundsSize || gear.glider.distanceToAnchor == null || gear.glider.distanceToAnchor > 0.75)
      ) {
        throw new Error(`${shot.label} glider is not rendered at the chest attachment: ${JSON.stringify(gear?.glider)}`);
      }
      const overlayStatus = await page.evaluate(() => window.__AW_HERO_FIXTURE_HIDE_OVERLAYS?.() ?? []);
      const missingFixtureTarget = FIXTURE_OVERLAYS.some(
        (target) =>
          !overlayStatus.some(
            (entry) =>
              entry.selector === target.selector &&
              Boolean(entry.all) === Boolean(target.all) &&
              (target.all || entry.text === target.text) &&
              Number.isFinite(entry.matched),
          ),
      );
      const visibleFixtureOverlay = overlayStatus.filter((entry) => entry.visible > 0);
      if (missingFixtureTarget || visibleFixtureOverlay.length) {
        throw new Error(`${shot.label} fixture overlay was not absent at screenshot: ${JSON.stringify(overlayStatus)}`);
      }

      const frozen = await page.evaluate(
        async (frames) => {
          const result = window.__AW_HERO_FIXTURE_SET_SIM_FROZEN?.(true);
          if (!result?.frozen) return { result, samples: [] };
          return { result, samples: await window.__AW_HERO_FIXTURE_SAMPLE_FROZEN?.(frames) };
        },
        FIXTURE_FREEZE_FRAMES,
      );
      const freeze = assertFrozenFixtureAnimation(frozen.samples, expectedClip);

      const path = checkedOutputPath(resolve(outDir, shot.file), [outDir]);
      try {
        await page.screenshot({ path, type: "png", timeout: 15000 });
      } catch (err) {
        logs.push(`screenshot retry ${shot.file}: ${String(err)}`);
        if (page.isClosed()) {
          throw err;
        }
        await page.waitForTimeout(400);
        await page.screenshot({ path, type: "png", timeout: 15000 });
      }
      written.push({ path, label: shot.label, observed, freeze });

      await page.keyboard.up("KeyW").catch(() => {});
      await page.keyboard.up("ShiftLeft").catch(() => {});
      await page.keyboard.up("KeyE").catch(() => {});
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const pageErrors = logs.filter((line) => line.startsWith("pageerror "));
  if (pageErrors.length) {
    throw new Error(`runtime pageerror during visual fixture: ${pageErrors.join(" | ")}`);
  }

  const summary = buildGameplayCaptureSummary({ port, asset, candidate, written, logs });
  const complete = { ...summary, summaryPath: null };
  complete.summaryPath = writeCaptureJson(complete);
  console.log(JSON.stringify(complete, null, 2));
  return complete;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  runGameplayCapture().catch((err) => {
    const failure = { ok: false, error: String(err?.stack || err) };
    try {
      mkdirSync(outDir, { recursive: true });
      failure.summaryPath = writeCaptureJson({ ...failure, summaryPath: null });
      writeCaptureJson(failure);
    } catch (writeErr) {
      failure.summaryWriteError = String(writeErr?.stack || writeErr);
    }
    console.error(JSON.stringify(failure, null, 2));
    process.exit(1);
  });
}
