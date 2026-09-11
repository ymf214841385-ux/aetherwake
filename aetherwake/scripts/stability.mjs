#!/usr/bin/env node
/**
 * Stability / perf sampler. Numbers come from rAF deltas and
 * performance.memory when the engine exposes it. Duration:
 *   STABILITY_SECONDS (wins) or STABILITY_MINUTES (default 10).
 * Short smoke: STABILITY_SECONDS=30 node scripts/stability.mjs
 *
 * Owns its preview server unless E2E_URL is set. Never kills a pid it did not
 * spawn. Unexpected page.close is a failure, not a silent pass.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { canvasHasContent, contextRestoreVerdict, pngPixelStats } from "./qa/context-restore.mjs";
import {
  ClosedPageError,
  bindCloseTracking,
  browserProcessInfo,
  classifyClose,
  maybeStartQaServer,
  partitionPageErrors,
  processIdentity,
  qaChromiumLaunchOptions,
  qaHeaded,
  stopOwnedServer,
} from "./qa/lifecycle.mjs";
import { installHarnessLifetime } from "./qa/durable-session.mjs";
import { evaluateStability } from "./qa/stability-metrics.mjs";

const secondsEnv = process.env.STABILITY_SECONDS;
const minutesEnv = process.env.STABILITY_MINUTES;
const seconds = secondsEnv != null && secondsEnv !== "" ? Number(secondsEnv) : Number(minutesEnv || 10) * 60;
const requestedMs = Math.max(5, seconds) * 1000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(root, "docs/rebuild-evidence");
mkdirSync(outDir, { recursive: true });

const identity = processIdentity();
const lifetime = installHarnessLifetime({ lastNote: "stability-boot" });
console.error(
  `[stability] pid=${identity.pid} ppid=${identity.ppid} pgid=${identity.pgid} sid=${identity.sid} ppidAlive=${identity.ppidAlive} parent=${JSON.stringify(identity.parentCmdline || "")} requestedMs=${requestedMs} heartbeat=${lifetime.heartbeatFile}`,
);

const ownedServer = await maybeStartQaServer({ name: "stability", kind: process.env.QA_SERVER || "preview" });
if (!ownedServer.ok) {
  lifetime.writeExit({ exitCode: 1, error: ownedServer.error || "failed to start owned QA server" });
  console.error(JSON.stringify({ ok: false, error: ownedServer.error || "failed to start owned QA server", server: ownedServer }, null, 2));
  process.exit(1);
}
lifetime.setServerPid(ownedServer.pid ?? null);
lifetime.setLastNote(`server pid=${ownedServer.pid ?? "ext"} port=${ownedServer.port ?? "ext"}`);
const url = checkedUrl(ownedServer.url || process.env.E2E_URL || "http://127.0.0.1:8080/");

let browser;
try {
  browser = await chromium.launch(qaChromiumLaunchOptions());
} catch (err) {
  if (ownedServer?.owned) await stopOwnedServer(ownedServer);
  lifetime.writeExit({ exitCode: 1, error: err?.message || String(err), stack: err?.stack });
  throw err;
}
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(0);
page.setDefaultNavigationTimeout(120000);

const closeFlags = bindCloseTracking(page, page.context(), browser);

const pageErrors = [];
const navigations = [];
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) navigations.push({ t: Date.now(), url: frame.url() });
});

const startedAt = Date.now();
let samples = [];
let frames = [];
let lastSnap = null;
let closeReason = null;
let contextProbe = null;
let respawn = { attempts: 0, ok: 0 };
let sceneChanges = { pause: 0, map: 0, visibility: 0 };

const chromiumInfo = browserProcessInfo(browser);
lifetime.setChromiumPid(chromiumInfo.chromiumPid);
console.error(
  `[stability] pid=${process.pid} ppid=${process.ppid} sid=${identity.sid} chromium=${chromiumInfo.chromiumPid ?? "missing"} via=${chromiumInfo.via} url=${url} requestedMs=${requestedMs} serverPid=${ownedServer.pid ?? "ext"} serverPort=${ownedServer.port ?? "ext"} pidFile=${ownedServer.pidFile ?? ""} log=${ownedServer.logFile ?? ""} heartbeat=${lifetime.heartbeatFile}`,
);

function throwIfClosed(err) {
  const reason = classifyClose({ ...closeFlags, errorMessage: err?.message || String(err) });
  if (reason) {
    closeReason = closeReason || reason;
    throw new ClosedPageError(reason);
  }
}

function ensureOpen() {
  if (page.isClosed() || !browser.isConnected()) {
    const reason =
      classifyClose({ ...closeFlags, errorMessage: "page already closed" }) || {
        kind: "target-destroyed",
        detail: "page.isClosed",
        message: "page already closed",
      };
    closeReason = closeReason || reason;
    throw new ClosedPageError(reason);
  }
}

async function wait(ms) {
  ensureOpen();
  try {
    await page.waitForTimeout(ms);
  } catch (err) {
    throwIfClosed(err);
    throw err;
  }
}

function write(extra = {}) {
  const durationMs = Date.now() - startedAt;
  const { pointerLockNoise, realErrors } = partitionPageErrors(pageErrors);
  const verdict = evaluateStability({
    durationMs,
    requestedMs,
    samples,
    pageErrors: realErrors,
    frames,
    closeReason,
  });
  const fps =
    verdict.frames.p50 && verdict.frames.p50 > 0
      ? { p50: 1000 / verdict.frames.p50, p95: verdict.frames.p95 ? 1000 / verdict.frames.p95 : null }
      : { p50: null, p95: null };
  const json = checkedOutputPath(resolve(outDir, "stability.json"), [outDir]);
  const body = {
    ok: verdict.ok,
    failures: verdict.failures,
    requestedMs,
    durationMs,
    minutesRequested: requestedMs / 60000,
    smoke: requestedMs < 9 * 60 * 1000,
    frames: verdict.frames,
    fps,
    renderer: qaHeaded() ? "headed-chromium" : "headless-chromium-software",
    memory: verdict.memory,
    pageErrors: realErrors,
    pointerLockNoise,
    closeReason,
    harness: {
      pid: process.pid,
      ppid: process.ppid,
      pgid: identity.pgid,
      sid: identity.sid,
      chromiumPid: lifetime.state.chromiumPid,
      heartbeatFile: lifetime.heartbeatFile,
      exitFile: lifetime.exitFile,
    },
    server: {
      owned: Boolean(ownedServer.owned),
      pid: ownedServer.pid ?? null,
      port: ownedServer.port ?? null,
      url: ownedServer.url ?? url,
      pidFile: ownedServer.pidFile ?? null,
      logFile: ownedServer.logFile ?? null,
    },
    contextRestore: contextProbe,
    respawn,
    sceneChanges,
    navigations,
    samples,
    last: lastSnap,
    ...extra,
  };
  writeFileSync(json, JSON.stringify(body, null, 2));
  return { json, verdict, durationMs };
}

async function sampleCanvas() {
  ensureOpen();
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    const gl = c?.getContext("webgl2") || c?.getContext("webgl");
    if (!gl) return { ok: false, reason: "no-gl" };
    const w = Math.min(64, gl.drawingBufferWidth || 0);
    const h = Math.min(64, gl.drawingBufferHeight || 0);
    if (!w || !h) return { ok: false, reason: "empty-buffer", w, h };
    const data = new Uint8Array(w * h * 4);
    try {
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } catch (err) {
      return { ok: false, reason: String(err?.message || err) };
    }
    let nonzero = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
      if (data[i] > 0) nonzero += 1;
    }
    return { ok: true, nonzero, sum, w, h, n: data.length };
  });
}

async function injectContextLoss() {
  ensureOpen();
  const before = await sampleCanvas();
  const lost = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const gl = c?.getContext("webgl2") || c?.getContext("webgl");
    const ext = gl?.getExtension("WEBGL_lose_context");
    if (!ext) return { lost: false, reason: "no-WEBGL_lose_context" };
    window.__awLoseExt = ext;
    window.__awGlLost = false;
    window.__awGlRestored = false;
    c.addEventListener(
      "webglcontextlost",
      (ev) => {
        ev.preventDefault();
        window.__awGlLost = true;
      },
      { once: true },
    );
    c.addEventListener(
      "webglcontextrestored",
      () => {
        window.__awGlRestored = true;
      },
      { once: true },
    );
    ext.loseContext();
    return { lost: true };
  });
  await wait(400);
  await page.evaluate(() => {
    try {
      window.__awLoseExt?.restoreContext();
    } catch {
      /* restore may be async */
    }
  });
  const restoreDeadline = Date.now() + 4000;
  let flags = { lostFired: false, restoredFired: false };
  while (Date.now() < restoreDeadline) {
    flags = await page.evaluate(() => ({
      lostFired: Boolean(window.__awGlLost),
      restoredFired: Boolean(window.__awGlRestored),
      toast: window.__sim?.toast || "",
    }));
    if (flags.restoredFired) break;
    await wait(200);
  }
  await wait(500);
  const afterGl = await sampleCanvas();
  let afterShot = null;
  let restorePng = null;
  try {
    const shot = await page.locator("canvas").first().screenshot({ type: "png" });
    afterShot = pngPixelStats(shot);
    restorePng = checkedOutputPath(resolve(outDir, "stability-restore.png"), [outDir]);
    writeFileSync(restorePng, shot);
  } catch (err) {
    afterShot = { ok: false, reason: err?.message || String(err) };
  }
  const after = canvasHasContent(afterShot) ? afterShot : afterGl;
  const verdict = contextRestoreVerdict({
    lostFired: lost.lost || flags.lostFired,
    restoredFired: flags.restoredFired,
    before,
    after,
  });
  return { ...verdict, before, after, afterGl, afterShot, restorePng, lost, flags };
}

async function maybeRespawn(modeNow) {
  if (modeNow !== "dead") return;
  respawn.attempts += 1;
  const wake = page.getByRole("button", { name: "在篝火旁醒来" });
  try {
    if (await wake.count()) {
      await wake.click({ timeout: 3000 });
      await wait(350);
      const after = await page.evaluate(() => window.__sim?.mode);
      if (after === "playing") respawn.ok += 1;
    }
  } catch (err) {
    throwIfClosed(err);
  }
}

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(2000);
  const start = page.getByRole("button", { name: "开始探索" });
  if (await start.count()) await start.click();
  await wait(500);
  await page.locator("canvas").click({ position: { x: 640, y: 400 } });

  await page.evaluate(() => {
    window.__awPerf = { frames: [], mem: [] };
    let last = performance.now();
    const loop = (now) => {
      window.__awPerf.frames.push(now - last);
      last = now;
      if (window.__awPerf.frames.length > 40000) window.__awPerf.frames.shift();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const end = Date.now() + requestedMs;
  let i = 0;
  while (Date.now() < end) {
    ensureOpen();
    await page.keyboard.down("KeyW");
    await wait(360);
    await page.keyboard.up("KeyW");
    if (i % 5 === 2) await page.keyboard.press("KeyA");
    if (i % 5 === 3) await page.keyboard.press("KeyD");
    if (i % 6 === 0) await page.keyboard.press("KeyE");
    await maybeRespawn(lastSnap?.mode);

    if (i % 8 === 0) {
      await page.keyboard.press("Escape");
      await wait(220);
      const cont = page.getByRole("button", { name: "继续" });
      if (await cont.count()) {
        await cont.click();
        sceneChanges.pause += 1;
      } else await page.keyboard.press("Escape");
      await wait(120);
    }
    if (i % 10 === 0) {
      await page.keyboard.press("KeyM");
      await wait(200);
      await page.keyboard.press("Escape");
      await wait(80);
      const cont = page.getByRole("button", { name: "继续" });
      if (await cont.count()) await cont.click();
      sceneChanges.map += 1;
    }
    if (i % 11 === 0) {
      await page.evaluate(() => {
        const hidden = document.visibilityState !== "hidden";
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => (hidden ? "hidden" : "visible"),
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await wait(80);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      sceneChanges.visibility += 1;
    }
    if (i === 2) {
      contextProbe = await injectContextLoss();
    }
    if (i === 4) {
      await page.mouse.move(200, 500);
      await page.mouse.down();
      await page.mouse.move(260, 480);
      await page.mouse.up();
    }

    const snap = await page.evaluate(() => {
      const s = window.__sim;
      const all = window.__awPerf.frames;
      const recent = all.slice(-180);
      const mem = performance.memory ? performance.memory.usedJSHeapSize : null;
      if (mem != null) window.__awPerf.mem.push(mem);
      return {
        mode: s?.mode,
        x: s?.player.x,
        z: s?.player.z,
        shrine: s?.shrine,
        worldKind: s?.worldKind,
        mem,
        nTotal: all.length,
        recent,
      };
    });
    lastSnap = snap;
    if (Array.isArray(snap.recent)) frames.push(...snap.recent.slice(-30));
    samples.push({
      t: Date.now(),
      mode: snap.mode,
      x: snap.x,
      z: snap.z,
      shrine: snap.shrine,
      worldKind: snap.worldKind,
      mem: snap.mem,
      n: snap.nTotal,
    });
    i += 1;
    if (i % 4 === 0) {
      lifetime.setLastNote(`sample ${i} mode=${lastSnap?.mode ?? "?"}`);
      write({ heartbeat: true, sampleIndex: i });
    }
    await wait(1200);
  }

  const shrine = await page.evaluate(() => window.__sim?.shrine);
  if (shrine != null) {
    await page.keyboard.press("KeyE");
    await wait(400);
  }

  if (!contextProbe) contextProbe = await injectContextLoss();

  const png = checkedOutputPath(resolve(outDir, "stability-end.png"), [outDir]);
  if (!page.isClosed()) await page.screenshot({ path: png, type: "png" });
  const dumped = await page.evaluate(() => window.__awPerf?.frames || []);
  if (Array.isArray(dumped) && dumped.length) frames = dumped;
  const { json, verdict, durationMs } = write({ png });
  closeFlags.intentionalTeardown = true;
  try {
    if (browser.isConnected()) await browser.close();
  } catch {
    /* ignore */
  }
  if (ownedServer?.owned) await stopOwnedServer(ownedServer);
  lifetime.writeExit({ exitCode: verdict.ok ? 0 : 1, closeReason });
  lifetime.dispose();
  console.log(
    JSON.stringify(
      {
        ok: verdict.ok,
        json,
        png,
        durationMs,
        requestedMs,
        smoke: requestedMs < 9 * 60 * 1000,
        frames: verdict.frames,
        memory: verdict.memory,
        failures: verdict.failures,
        closeReason,
        contextRestore: contextProbe && { recovered: contextProbe.recovered, afterHas: contextProbe.afterHas },
        respawn,
        last: lastSnap && { mode: lastSnap.mode, n: lastSnap.nTotal, mem: lastSnap.mem },
        count: samples.length,
        serverPid: ownedServer.pid ?? null,
        chromiumPid: chromiumInfo.chromiumPid ?? null,
        harnessPid: process.pid,
        ppid: process.ppid,
      },
      null,
      2,
    ),
  );
  process.exit(verdict.ok ? 0 : 1);
} catch (err) {
  if (err instanceof ClosedPageError) closeReason = closeReason || err.closeReason;
  else {
    const reason = classifyClose({ ...closeFlags, errorMessage: err?.message || String(err) });
    if (reason) closeReason = closeReason || reason;
  }
  let png = null;
  try {
    if (!page.isClosed()) {
      png = checkedOutputPath(resolve(outDir, "stability-end.png"), [outDir]);
      await page.screenshot({ path: png, type: "png" });
    }
  } catch {
    /* ignore */
  }
  const { json, verdict } = write({ error: err?.message || String(err), png });
  console.error(
    JSON.stringify(
      { ok: false, error: err?.message || String(err), closeReason, json, failures: verdict.failures, durationMs: Date.now() - startedAt },
      null,
      2,
    ),
  );
  closeFlags.intentionalTeardown = true;
  try {
    if (browser.isConnected()) await browser.close();
  } catch {
    /* ignore */
  }
  if (ownedServer?.owned) await stopOwnedServer(ownedServer);
  lifetime.setCloseReason(closeReason);
  lifetime.writeExit({
    exitCode: 1,
    closeReason,
    error: err?.message || String(err),
    stack: err?.stack,
  });
  lifetime.dispose();
  process.exit(1);
}
