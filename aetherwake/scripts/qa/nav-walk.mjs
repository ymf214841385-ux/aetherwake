/**
 * Shared shrine/world navigation helpers for QA harnesses.
 * Single source of truth so tests exercise the real stop rules.
 *
 * Contract:
 * - lookToward must converge (aligned) before any W.
 * - lookToward returns { status, err, camYaw }.
 * - W step length scales with remaining distance (avoid overshoot).
 */

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function yawError(camYaw, x, z, tx, tz) {
  const want = Math.atan2(-(tx - x), -(tz - z));
  return wrapAngle(want - camYaw);
}

/**
 * @param {object} io
 * @param {object} [opts]
 * @param {number} [opts.tol]
 * @param {number} [opts.maxPulses]
 * @param {number} [opts.minPulseMs] hard floor — can overshoot small errors
 * @param {number} [opts.maxPulseMs]
 * @param {(trace:object)=>void} [opts.onPulse] per-pulse measurement hook
 * @returns {Promise<{status:"aligned"|"timeout"|"no-sim", err:number, camYaw:number|null, pulses:number, trace:object[]}>}
 */
export async function lookToward(io, tx, tz, opts = {}) {
  const tol = opts.tol ?? 0.18;
  const maxPulses = opts.maxPulses ?? 12;
  const minPulseMs = opts.minPulseMs ?? Math.min(80, opts.pulseMs ?? 80);
  const maxPulseMs = opts.maxPulseMs ?? 900;
  const onPulse = opts.onPulse || null;
  let pulses = 0;
  let lastErr = Infinity;
  let camYaw = null;
  /** estimated rad per ms from measured pulses (positive magnitude) */
  let yawRate = opts.yawRate ?? null;
  const trace = [];
  for (let i = 0; i < maxPulses; i++) {
    const s = await io.read();
    if (!s) return { status: "no-sim", err: Infinity, camYaw: null, pulses, trace };
    camYaw = s.camYaw;
    lastErr = yawError(s.camYaw, s.x, s.z, tx, tz);
    if (Math.abs(lastErr) <= tol) {
      trace.push({ i, err: lastErr, camYaw, ms: 0, key: null });
      return { status: "aligned", err: lastErr, camYaw, pulses, trace };
    }
    const key = lastErr > 0 ? "ArrowLeft" : "ArrowRight";
    // Progressive shorter pulses near target. Probe once if rate unknown so
    // the first pulse cannot overshoot a small error (Review08).
    let ms;
    if (yawRate == null) {
      ms = minPulseMs;
    } else if (yawRate > 1e-6) {
      const need = Math.abs(lastErr) / yawRate; // ms to close err at current rate
      ms = Math.min(maxPulseMs, Math.max(minPulseMs, Math.round(need * 0.6)));
    } else {
      ms = Math.min(maxPulseMs, Math.max(minPulseMs, Math.abs(lastErr) * (opts.pulseScale ?? 400)));
    }
    const yaw0 = s.camYaw;
    const t0 = Date.now();
    await io.hold([key], ms);
    pulses += 1;
    const s2 = await io.read();
    const wallMs = Date.now() - t0;
    if (s2) {
      camYaw = s2.camYaw;
      const dYaw = wrapAngle(s2.camYaw - yaw0);
      lastErr = yawError(s2.camYaw, s2.x, s2.z, tx, tz);
      // Prefer measured wall time; fall back to requested pulse (instant IO).
      const denom = Math.max(wallMs, ms, 1);
      if (Math.abs(dYaw) > 1e-6) {
        const rate = Math.abs(dYaw) / denom;
        yawRate = yawRate == null ? rate : yawRate * 0.5 + rate * 0.5;
      }
      const rec = { i, err: lastErr, camYaw, yaw0, dYaw, ms, wallMs, key, yawRate };
      trace.push(rec);
      if (onPulse) onPulse(rec);
      if (Math.abs(lastErr) <= tol) {
        return { status: "aligned", err: lastErr, camYaw, pulses, trace };
      }
    } else {
      trace.push({ i, err: lastErr, camYaw, ms, key, note: "read-null-after-pulse" });
    }
  }
  const s = await io.read();
  if (s) {
    camYaw = s.camYaw;
    lastErr = yawError(s.camYaw, s.x, s.z, tx, tz);
  }
  return {
    status: Math.abs(lastErr) <= tol ? "aligned" : "timeout",
    err: lastErr,
    camYaw,
    pulses,
    trace,
  };
}

/** W duration from remaining distance so we do not overshoot the arrive radius. */
export function walkStepMs(dist, arrive, stepMs = 220) {
  const slack = Math.max(0, dist - arrive);
  // ~2.5 m/s wall under throttle; keep at least one short pulse
  const needMs = (slack / 2.2) * 1000;
  return Math.min(stepMs * 4, Math.max(80, Math.round(needMs)));
}

/**
 * Walk toward (tx,tz) using injected page I/O.
 * Only presses W after lookToward reports aligned.
 */
export async function walkTo(io, tx, tz, ms, opts = {}) {
  const arrive = opts.arrive ?? 2.2;
  const expectShrine = opts.expectShrine ?? null;
  const tol = opts.tol ?? 0.18;
  const end = Date.now() + ms;
  let steps = 0;
  let lastLook = null;
  while (Date.now() < end) {
    const s = await io.read();
    if (!s) return { status: "no-sim", s: null, dist: Infinity, steps, look: lastLook };
    if (s.mode !== "playing") {
      return { status: "not-playing", s, dist: Math.hypot(tx - s.x, tz - s.z), detail: s.mode, steps, look: lastLook };
    }
    if (expectShrine === null && s.shrine != null) {
      return { status: "region-changed", s, dist: Math.hypot(tx - s.x, tz - s.z), detail: "entered-shrine", steps, look: lastLook };
    }
    if (expectShrine !== null && s.shrine !== expectShrine) {
      return { status: "region-changed", s, dist: Math.hypot(tx - s.x, tz - s.z), detail: "left-shrine", steps, look: lastLook };
    }
    const dist = Math.hypot(tx - s.x, tz - s.z);
    if (dist < arrive) return { status: "arrived", s, dist, steps, look: lastLook };

    // Optional hazard hook (enemies, cliffs). Return true to retry loop without W.
    if (typeof io.hazard === "function") {
      const blocked = await io.hazard(s, { tx, tz });
      if (blocked) continue;
    }

    lastLook = await io.lookToward(tx, tz, { tol, ...(opts.lookOpts || {}) });
    if (lastLook?.status === "no-sim") {
      return { status: "no-sim", s: null, dist, steps, look: lastLook };
    }
    if (lastLook?.status !== "aligned") {
      // Closed-loop: do NOT walk; retry turn until budget expires.
      continue;
    }

    const stepMs = walkStepMs(dist, arrive, opts.stepMs ?? 220);
    await io.hold(["KeyW"], stepMs);
    steps += 1;
  }
  const s = await io.read();
  const dist = s ? Math.hypot(tx - s.x, tz - s.z) : Infinity;
  // If last look never aligned and we never walked, report turn-failed.
  const neverWalked = steps === 0;
  const status =
    dist < arrive ? "arrived" : neverWalked && lastLook && lastLook.status !== "aligned" ? "turn-failed" : "timeout";
  return { status, s, dist, steps, look: lastLook };
}

/** Follow waypoints; first non-arrived status aborts the route. */
export async function followWaypoints(io, wps, msEach, opts = {}) {
  const results = [];
  for (const wp of wps) {
    const r = await walkTo(io, wp.x, wp.z, msEach, opts);
    results.push({ wp, ...r });
    if (r.status !== "arrived") break;
  }
  return results;
}

/**
 * Orchestrate waypoints with respawn: if death/respawn moves the player
 * far from the current goal (back to spawn), reset index to 0 and re-walk
 * the verified prefix. Never jump from spawn to a late waypoint.
 *
 * @param {object} io read/lookToward/hold + optional respawn()
 * @param {{x:number,z:number}[]} wps
 * @param {object} opts walkTo opts + { maxRouteAttempts, spawnX, spawnZ, spawnRadius }
 */
export async function followRouteWithRespawn(io, wps, msEach, opts = {}) {
  const maxRouteAttempts = opts.maxRouteAttempts ?? 2;
  const spawnX = opts.spawnX ?? 16;
  const spawnZ = opts.spawnZ ?? 102;
  const spawnRadius = opts.spawnRadius ?? 12;
  const onStep = opts.onStep || (() => {});
  const log = [];
  let attempts = 0;
  let i = 0;
  const deaths = [];

  while (attempts < maxRouteAttempts) {
    const r = await walkTo(io, wps[i].x, wps[i].z, msEach, opts);
    const entry = { attempt: attempts, i, wp: wps[i], status: r.status, dist: r.dist, look: r.look };
    log.push(entry);
    onStep(entry);

    if (r.status === "arrived") {
      i += 1;
      if (i >= wps.length) {
        return { ok: true, i, log, deaths, status: "completed" };
      }
      continue;
    }

    const s = r.s;
    const dead = r.status === "not-playing" || s?.mode === "dead" || s?.state === "dead";
    if (dead) {
      const deathRec = {
        i,
        wp: wps[i],
        x: s?.x,
        y: s?.y,
        z: s?.z,
        hp: s?.hp,
        state: s?.state,
        mode: s?.mode,
        vy: s?.vy,
        enemies: s?.enemies,
        toast: s?.toast,
        prompt: s?.prompt,
      };
      deaths.push(deathRec);
      onStep({ note: "death", ...deathRec });
      if (typeof io.respawn === "function") {
        await io.respawn();
      }
      const after = await io.read();
      const nearSpawn = after && Math.hypot(after.x - spawnX, after.z - spawnZ) < spawnRadius;
      const farFromGoal =
        after && Math.hypot(after.x - wps[i].x, after.z - wps[i].z) > (opts.resetRadius ?? 25);
      if (nearSpawn || farFromGoal) {
        const prevAttempt = attempts;
        attempts += 1;
        i = 0;
        const reset = {
          attempt: prevAttempt,
          i: 0,
          note: "respawn-at-spawn-reset-route",
          at: { x: after?.x, z: after?.z },
          nearSpawn,
          farFromGoal,
        };
        log.push(reset);
        onStep(reset);
        continue;
      }
      attempts += 1;
      continue;
    }

    return { ok: false, i, log, deaths, status: r.status, dist: r.dist, look: r.look, last: r.s };
  }
  return { ok: false, i, log, deaths, status: "max-route-attempts" };
}
