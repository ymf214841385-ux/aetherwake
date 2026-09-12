import { classifyFightSnapshot } from "./combat-progress-monitor.mjs";

export class FightStopError extends Error {
  constructor(reason) {
    super(`Fight stopped: ${reason}`);
    this.name = "FightStopError";
    this.reason = reason;
  }
}
export function checkFightScope(scope, snapshot) {
  if (!scope) return;
  if (classifyFightSnapshot(snapshot) === "dead") scope.abort.abort("death");
  if (scope.abort.aborted) throw new FightStopError(scope.abort.reason);
}

import { navigationOutcome } from "./shrine-steer.mjs";

// Actual route helpers; injected browser/time/state keep the production loops testable.
export function createRouteNavigation({
  page,
  read,
  wait,
  ensureOpen,
  MOVE_CODES,
  releaseAll,
  note,
  clickNamed,
  clickCanvas,
  focusPlaySurface,
  shrineWorldOrigin,
  state,
  now = Date.now,
}) {
  async function pause(ms, scope) {
    checkFightScope(scope);
    let remaining = ms;
    while (remaining > 0) {
      const slice = scope ? Math.min(100, remaining) : remaining;
      await wait(slice);
      checkFightScope(scope);
      remaining -= slice;
    }
  }
  async function checkedRead(scope) {
    checkFightScope(scope);
    let s;
    try {
      s = await read();
    } catch (err) {
      if (!scope) throw err;
      scope.abort.abort(`read-error:${err?.message || err}`);
      checkFightScope(scope);
    }
    if (scope) scope.lastSnapshot = s;
    checkFightScope(scope, s);
    return s;
  }
  async function input(scope, action, run) {
    checkFightScope(scope);
    await run();
    scope?.markInput(action);
    checkFightScope(scope);
  }
  async function hold(keys, ms, scope) {
    ensureOpen();
    const real = keys.filter((k) => MOVE_CODES.includes(k));
    const pressed = [];
    try {
      checkFightScope(scope);
      for (const k of real) {
        checkFightScope(scope);
        pressed.push(k);
        await input(scope, `key-down:${k}`, () => page.keyboard.down(k));
      }
      await pause(ms, scope);
    } finally {
      for (const k of pressed.reverse()) {
        try {
          await page.keyboard.up(k);
          scope?.markInput(`key-up:${k}`);
        } catch {
          /* release remaining keys even if one release fails */
        }
      }
    }
  }

  async function tap(code, scope) {
    ensureOpen();
    if (!MOVE_CODES.includes(code)) {
      note(`refusing non-real key ${code}`);
      return;
    }
    await input(scope, `key-press:${code}`, () => page.keyboard.press(code));
  }

  async function resumePlay(scope) {
    let s = await checkedRead(scope);
    if (!s) return s;
    if (s.mode === "title") {
      if (state.sawPlaying) state.titleMidRun = true;
      const recoveredAt = now();
      if (recoveredAt - state.lastTitleRecoverAt > 2000) {
        state.lastTitleRecoverAt = recoveredAt;
        if (state.sawPlaying) {
          note("title mid-run; continue only (will not start a new file)");
          await input(scope, "continue", () => clickNamed("继续旅途", scope));
        } else {
          await input(scope, "start", () => clickNamed("开始探索", scope));
        }
        await pause(350, scope);
      }
      await input(scope, "canvas-click", clickCanvas);
      s = await checkedRead(scope);
      if (s?.mode === "playing") state.sawPlaying = true;
      return s;
    }
    if (s.mode === "dead") {
      const btn = page.getByRole("button", { name: "在篝火旁醒来" });
      if (await btn.count()) await input(scope, "overlay-click", () => btn.click());
      await pause(400, scope);
      return checkedRead(scope);
    }
    if (s.mode === "dialogue") {
      const btn = page.getByRole("button", { name: "明白了" });
      if (await btn.count()) await input(scope, "overlay-click", () => btn.click());
      else await tap("Escape", scope);
      await pause(200, scope);
      return checkedRead(scope);
    }
    if (s.mode === "cooking" || s.mode === "inventory" || s.mode === "map" || s.mode === "paused") {
      const cont = page.getByRole("button", { name: "继续" });
      if (s.mode === "paused" && (await cont.count()))
        await input(scope, "overlay-click", () => cont.click());
      else {
        await tap("Escape", scope);
        await pause(120, scope);
        const again = await checkedRead(scope);
        if (again?.mode === "paused") {
          const c2 = page.getByRole("button", { name: "继续" });
          if (await c2.count()) await input(scope, "overlay-click", () => c2.click());
        } else if (again && again.mode !== "playing") {
          await tap("Escape", scope);
        }
      }
      await pause(160, scope);
      await input(scope, "canvas-click", clickCanvas);
      return checkedRead(scope);
    }
    return s;
  }

  function keysToward(s, tx, tz, sprint) {
    const dx = tx - s.x;
    const dz = tz - s.z;
    const fx = -Math.sin(s.camYaw);
    const fz = -Math.cos(s.camYaw);
    const rx = Math.cos(s.camYaw);
    const rz = -Math.sin(s.camYaw);
    const f = dx * fx + dz * fz;
    const r = dx * rx + dz * rz;
    const keys = [];
    if (f > 0.35) keys.push("KeyW");
    if (f < -0.35) keys.push("KeyS");
    if (r > 0.35) keys.push("KeyD");
    if (r < -0.35) keys.push("KeyA");
    if (sprint && s.stamina > 8 && s.state !== "climbing") keys.push("ShiftLeft");
    if (keys.length === 0) keys.push("KeyW");
    return keys;
  }

  async function lookToward(tx, tz, scope) {
    // Arrow look only. A canvas left-click here starts a melee with stale facing.
    checkFightScope(scope);
    await focusPlaySurface();
    checkFightScope(scope);
    for (let i = 0; i < 14; i++) {
      const s = await checkedRead(scope);
      if (!s) return s;
      const dx = tx - s.x;
      const dz = tz - s.z;
      const want = Math.atan2(-dx, -dz);
      let err = want - s.camYaw;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      if (Math.abs(err) < 0.14) return s;
      const key = err > 0 ? "ArrowLeft" : "ArrowRight";
      await hold([key], 90, scope);
    }
    return checkedRead(scope);
  }

  function attachNav(s, nav) {
    if (!s) return { nav };
    s.nav = nav;
    return s;
  }

  async function goTo(tx, tz, ms, { arrive = 2.2, sprint = true, label = "" } = {}, scope) {
    const end = now() + ms;
    let lastPos = null;
    let stuckSince = now();
    while (now() < end) {
      checkFightScope(scope);
      let s = await resumePlay(scope);
      state.last = s;
      if (!s) break;
      if (s.mode === "playing") state.sawPlaying = true;
      if (s.shrine != null && Math.hypot(tx - s.x, tz - s.z) > 40) {
        note(`in shrine while going ${label || `${tx},${tz}`}; trying to leave`);
        await leaveShrine(scope);
        s = await checkedRead(scope);
      }
      if (!s) break;
      const dist = Math.hypot(tx - s.x, tz - s.z);
      const here = navigationOutcome({
        dist,
        arrive,
        timedOut: false,
        climbing: s.state === "climbing",
      });
      if (here.arrived) {
        await releaseAll();
        return attachNav(s, { ...here, label, tx, tz });
      }
      if (lastPos && Math.hypot(s.x - lastPos.x, s.z - lastPos.z) > 1.2) {
        stuckSince = now();
        lastPos = { x: s.x, z: s.z };
      } else if (!lastPos) lastPos = { x: s.x, z: s.z };

      if (now() - stuckSince > 2800) {
        note(`stuck dist=${dist.toFixed(1)} at ${s.x.toFixed(1)},${s.z.toFixed(1)} ${s.state}`);
        await releaseAll();
        if (s.state === "airborne" || s.state === "gliding") {
          await pause(400, scope);
        } else if (s.state === "climbing") {
          await hold(["KeyC"], 180, scope);
        } else {
          await hold(["KeyA"], 280, scope);
          await hold(["KeyD", "KeyW"], 400, scope);
        }
        stuckSince = now();
      }

      if (s.state === "airborne" || s.state === "gliding") {
        await hold(keysToward(s, tx, tz, false), 220, scope);
        continue;
      }
      if (s.state === "swimming") {
        await hold(keysToward(s, tx, tz, false), 280, scope);
        continue;
      }
      if (s.state === "climbing") {
        // p04 camp-a: KeyC alone left us clinging at 8.9,73.2. Harder dismount.
        await hold(["KeyC"], 180, scope);
        await pause(120, scope);
        const s2 = await checkedRead(scope);
        if (s2?.state === "climbing") {
          await hold(["KeyC", "KeyW"], 220, scope);
          await hold(["Space"], 140, scope);
        }
        continue;
      }

      const keys = keysToward(s, tx, tz, sprint && dist > 3);
      await hold(keys, 200, scope);
    }
    await releaseAll();
    const endS = await checkedRead(scope);
    const endDist = endS ? Math.hypot(tx - endS.x, tz - endS.z) : Infinity;
    const outcome = navigationOutcome({
      dist: endDist,
      arrive,
      timedOut: true,
      climbing: endS?.state === "climbing",
    });
    if (!outcome.arrived) {
      note(
        `nav ${outcome.status} ${label || `${tx},${tz}`} dist=${Number.isFinite(endDist) ? endDist.toFixed(1) : "?"} at ${endS?.x?.toFixed?.(1)},${endS?.z?.toFixed?.(1)}`,
      );
    }
    return attachNav(endS, { ...outcome, label, tx, tz });
  }

  async function follow(points, msEach = 50000, arrive = 2.4, scope) {
    let s = await checkedRead(scope);
    for (const p of points) {
      checkFightScope(scope);
      s = await goTo(p.x, p.z, msEach, { arrive, sprint: true, label: `${p.x},${p.z}` }, scope);
      if (!s?.nav?.arrived) {
        note(`follow waypoint failed ${p.x},${p.z} status=${s?.nav?.status} dist=${s?.nav?.dist}`);
        return s;
      }
    }
    return s;
  }

  async function leaveShrine(scope) {
    for (let i = 0; i < 12; i++) {
      const s = await resumePlay(scope);
      if (!s || s.shrine == null) return s;
      if (s.prompt?.includes("离开")) {
        await tap("KeyE", scope);
        await pause(500, scope);
        continue;
      }
      if (s.prompt?.includes("领取")) {
        await tap("KeyE", scope);
        await pause(400, scope);
        continue;
      }
      const o = shrineWorldOrigin(s.shrine);
      const nav = await goTo(
        o.x,
        o.z + 2.2,
        8000,
        { arrive: 1.5, sprint: false, label: "leave-door" },
        scope,
      );
      if (scope && !nav?.nav?.arrived) return nav;
      await tap("KeyE", scope);
      await pause(400, scope);
    }
    return checkedRead(scope);
  }

  return {
    hold,
    tap,
    resumePlay,
    keysToward,
    lookToward,
    attachNav,
    goTo,
    follow,
    leaveShrine,
    checkedRead,
  };
}
