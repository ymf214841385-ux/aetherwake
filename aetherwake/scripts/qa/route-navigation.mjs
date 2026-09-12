import { classifyFightSnapshot, COMBAT_MAX_HZ, COMBAT_MAX_DY } from "./combat-progress-monitor.mjs";

// A local control-flow return, deliberately separate from the failure latch.
export class CombatReady extends Error {
  constructor(snapshot) {
    super("Navigation reached live combat");
    this.name = "CombatReady";
    this.snapshot = snapshot;
  }
}

export function checkInitialCombatReady(scope, s) {
  checkFightScope(scope, s);
  if (!(scope?.initialApproach || scope?.combatReposition) || s?.mode !== "playing" ||
      !Number.isFinite(s.hp) || s.hp <= 0 || s.sealOpen !== true ||
      s.bossDead === true || s.boss?.alive !== true || !(s.boss.hp > 0) ||
      s.bossMeleeBlocked !== false) return;
  if (![s.x, s.y, s.z, s.boss.x, s.boss.y, s.boss.z].every(Number.isFinite)) return;
  if (Math.hypot(s.x - s.boss.x, s.z - s.boss.z) <= COMBAT_MAX_HZ &&
      Math.abs(s.y - s.boss.y) <= COMBAT_MAX_DY) throw new CombatReady(s);
}

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

import { keysToward } from "./digital-direction.mjs";
export { keysToward };

export function requireFightNavigation(scope, snapshot) {
  checkFightScope(scope, snapshot);
  if (scope && !snapshot?.nav?.arrived) {
    scope.lastSnapshot = snapshot;
    scope.navigationFailure = { snap: snapshot, nav: snapshot?.nav ?? null };
    scope.abort.abort("navigation-failed");
    checkFightScope(scope);
  }
  return snapshot;
}

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
  // Survives waypoint calls; only an observed natural landing rearms Space.
  let descentAttempted = false;
  let navigationId = 0;
  const navigationEvidence = { active: null, completed: [] };
  const frames = new WeakMap();
  const evidenceFor = (scope) => scope
    ? scope.navigationEvidence ?? { active: null, completed: [] } : navigationEvidence;
  const evidenceNow = (scope) => (scope?.now ?? now)();
  function observeNavigationRead(scope, s) {
    const active = evidenceFor(scope).active;
    if (!active) return;
    const frame = frames.get(active);
    if (!frame) return;
    active.lastReadAt = evidenceNow(scope);
    active.dist = s ? Math.hypot(active.tx - s.x, active.tz - s.z) : null;
    frame.lastSnapshot = structuredClone(s ?? null);
  }
  function recordNavigationDecision(active, s, outcome, timedOut, settlement) {
    const deferredArrival = outcome.arrived && active.safeDescent &&
      (s?.state === "airborne" || s?.state === "gliding") ? s.state : null;
    const decision = {
      t: active.lastReadAt, stage: active.stage, timedOut,
      navigationOutcome: { ...outcome }, arrived: settlement ? settlement === "landed" : outcome.arrived && !deferredArrival,
      deferredArrival, state: s?.state ?? null, grounded: s?.grounded ?? null,
      x: s?.x ?? null, y: s?.y ?? null, z: s?.z ?? null,
      ...(settlement ? { settlement, vy: s?.vy ?? null } : {}),
    };
    active.lastDecisionAt = decision.t;
    active.lastDecision = decision;
    const frame = frames.get(active);
    frame.decisionCount++;
    frame.decisions.push(structuredClone(decision));
    if (frame.decisions.length > 256) frame.decisions.shift();
  }
  async function pause(ms, scope) {
    checkFightScope(scope);
    let remaining = ms;
    let snapshot;
    while (remaining > 0) {
      const slice = scope ? Math.min(100, remaining) : remaining;
      await wait(slice);
      checkFightScope(scope);
      // During entry or LOS recovery, observe while keys are held too.
      // CombatReady unwinds hold's existing finally, releasing every key.
      if (scope?.initialApproach || scope?.combatReposition) snapshot = await checkedRead(scope);
      remaining -= slice;
    }
    return snapshot;
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
    observeNavigationRead(scope, s);
    if (scope) scope.lastSnapshot = s;
    scope?.observeSnapshot?.(s);
    checkFightScope(scope, s);
    if (s?.state === "grounded" && s.grounded === true) descentAttempted = false;
    checkInitialCombatReady(scope, s);
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
    const candidate = evidenceFor(scope).active;
    const active = frames.has(candidate) ? candidate : null;
    const previousStage = active?.stage;
    if (active) active.stage = "hold";
    let completed = false;
    try {
      checkFightScope(scope);
      for (const k of real) {
        checkFightScope(scope);
        pressed.push(k);
        await input(scope, `key-down:${k}`, () => page.keyboard.down(k));
      }
      await pause(ms, scope);
      completed = true;
    } finally {
      for (const k of pressed.reverse()) {
        try {
          await page.keyboard.up(k);
          scope?.markInput(`key-up:${k}`);
        } catch {
          /* release remaining keys even if one release fails */
        }
      }
      if (active && completed) active.stage = previousStage;
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

  async function goTo(tx, tz, ms, options = {}, scope) {
    const controlDeadline = now() + ms;
    const { arrive = 2.2, label = "", safeDescent = false } = options;
    if (scope) scope.navigationEvidence ??= { active: null, completed: [] };
    const evidence = evidenceFor(scope);
    const parent = evidence.active;
    const startedAt = evidenceNow(scope);
    const active = { id: ++navigationId, parentId: parent?.id ?? null,
      label, tx, tz, arrive, safeDescent, startedAt, deadline: startedAt + ms,
      dist: null, stage: "read", lastReadAt: null, lastDecisionAt: null, lastDecision: null };
    const frame = { lastSnapshot: null, decisions: [], decisionCount: 0 };
    frames.set(active, frame);
    evidence.active = active;
    let outcome = "failure", reason = null;
    try {
      const result = await executeGoTo(tx, tz, ms, options, scope, active, controlDeadline);
      outcome = result?.nav?.arrived ? "arrived" : "failure";
      reason = result?.nav?.status ?? "nonarrival";
      return result;
    } catch (err) {
      outcome = err instanceof CombatReady && !scope?.abort.aborted ? "combat-ready" : "failure";
      reason = scope?.abort.reason ?? (err instanceof CombatReady ? "CombatReady" : err?.reason ?? err?.message ?? String(err));
      throw err; // Diagnostic capture never replaces the original error/control-flow signal.
    } finally {
      evidence.completed.push({ outcome, reason, endedAt: evidenceNow(scope),
        final: structuredClone(active), finalSnapshot: frame.lastSnapshot,
        decisions: frame.decisions, decisionCount: frame.decisionCount });
      if (evidence.completed.length > 16) evidence.completed.shift();
      evidence.active = parent;
      frames.delete(active);
    }
  }

  async function executeGoTo(tx, tz, ms, { arrive = 2.2, sprint = true, label = "", safeDescent = false } = {}, scope, active, controlDeadline) {
    async function stopDescent(reason, s, observations) {
      await releaseAll();
      checkFightScope(scope);
      const nav = { arrived: false, status: reason, label, tx, tz,
        dist: s ? Math.hypot(tx - s.x, tz - s.z) : Infinity,
        safeDescent: { reason, observations } };
      const result = attachNav(s, nav);
      note(`nav ${reason} ${label} ${JSON.stringify(nav.safeDescent)}`);
      if (scope) {
        scope.lastSnapshot = result;
        scope.navigationFailure = { snap: result, nav };
        scope.abort.abort(reason);
        checkFightScope(scope);
      }
      return result;
    }
    const end = safeDescent ? controlDeadline : now() + ms;
    async function settleDescent(s) {
      const settleEnd = Math.min(now() + 300, end);
      const observations = [];
      active.stage = "settling";
      try {
        await releaseAll();
        while (true) {
          checkFightScope(scope, s);
          const dist = s ? Math.hypot(tx - s.x, tz - s.z) : Infinity;
          const here = navigationOutcome({ dist,
            arrive, timedOut: now() >= end, climbing: s?.state === "climbing" });
          const settlement = s?.state === "airborne" && Number.isFinite(s.vy) && s.vy <= -3 ? "fastfall"
            : !(Number.isFinite(dist) && dist < arrive) ? "drifted"
            : s?.state === "grounded" && s.grounded === true && now() <= settleEnd ? "landed"
            : s?.state === "gliding" ? "gliding"
            : now() >= settleEnd ? "descent-landing-not-observed" : "observe";
          observations.push({ t: active.lastReadAt, snapshot: structuredClone(s ?? null) });
          recordNavigationDecision(active, s, here, now() >= end, settlement);
          if (settlement === "landed") {
            return { snapshot: s, here };
          }
          if (settlement === "descent-landing-not-observed") {
            return { result: await stopDescent(settlement, s, observations) };
          }
          if (settlement !== "observe") return { snapshot: s };
          // Entry pause already performs a checked read. Use that exact read:
          // a second one can miss the observed landing or fastfall transition.
          const remaining = settleEnd - now();
          if (remaining <= 0) continue;
          const observed = await pause(Math.min(100, remaining), scope);
          s = scope?.initialApproach || scope?.combatReposition ? observed : await checkedRead(scope);
          state.last = s;
        }
      } finally {
        await releaseAll();
      }
    }
    let lastPos = null;
    let stuckSince = now();
    navigation: while (now() < end) {
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
      let dist;
      // A settlement exit is re-evaluated here using its actual checked read,
      // so fastfall reaches the existing Space/failed-glide guards before movement.
      while (true) {
        if (safeDescent && s.state === "gliding") descentAttempted = true;
        if (safeDescent && s.state === "airborne" && Number.isFinite(s.vy) && s.vy <= -3) {
          const observations = [{ ...s }];
          if (!(s.stamina > 8)) return stopDescent("glide-unavailable", s, observations);
          if (descentAttempted) return stopDescent("glide-not-started", s, observations);
          descentAttempted = true;
          await tap("Space", scope);
          s = await checkedRead(scope);
          observations.push(s ? { ...s } : null);
          for (let i = 0; i < 3 && s?.state !== "gliding"; i++) {
            await pause(100, scope);
            s = await checkedRead(scope);
            observations.push(s ? { ...s } : null);
          }
          if (s?.state !== "gliding") return stopDescent("glide-not-started", s, observations);
          state.last = s;
        }
        dist = Math.hypot(tx - s.x, tz - s.z);
        const here = navigationOutcome({
          dist,
          arrive,
          timedOut: false,
          climbing: s.state === "climbing",
        });
        recordNavigationDecision(active, s, here, false);
        if (safeDescent && here.arrived && s.state === "airborne" &&
            Number.isFinite(s.vy) && s.vy > -3 && s.vy <= 0) {
          const settled = await settleDescent(s);
          if (settled.result) return settled.result;
          s = settled.snapshot;
          if (settled.here) {
            return requireFightNavigation(scope, attachNav(s, { ...settled.here, label, tx, tz }));
          }
          active.stage = "read";
          if (!s || now() >= end) break navigation;
          continue;
        }
        if (here.arrived && !(safeDescent && (s.state === "airborne" || s.state === "gliding"))) {
          await releaseAll();
          return requireFightNavigation(scope, attachNav(s, { ...here, label, tx, tz }));
        }
        break;
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
    recordNavigationDecision(active, endS, outcome, true);
    if (safeDescent && (endS?.state === "airborne" || endS?.state === "gliding")) {
      outcome.arrived = false;
      outcome.status = "timeout";
    }
    if (!outcome.arrived) {
      note(
        `nav ${outcome.status} ${label || `${tx},${tz}`} dist=${Number.isFinite(endDist) ? endDist.toFixed(1) : "?"} at ${endS?.x?.toFixed?.(1)},${endS?.z?.toFixed?.(1)}`,
      );
    }
    return requireFightNavigation(scope, attachNav(endS, { ...outcome, label, tx, tz }));
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
    getNavigationEvidence: (scope) => structuredClone(evidenceFor(scope)),
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
