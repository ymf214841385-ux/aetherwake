/**
 * Shared native-input steering for headed walkers.
 * Never writes cam.yaw / player.yaw. Uses Arrow look keys only.
 * Release movement until heading error < threshold AND forward·(target−pos) > 0.
 */

import { ATTACK_ARC } from "./params.ts";

export type SteerSample = {
  x: number;
  z: number;
  camYaw: number;
  vx?: number;
  vz?: number;
};

export type SteerDecision =
  | { kind: "turn"; key: "ArrowLeft" | "ArrowRight"; err: number }
  | { kind: "drive"; err: number; dot: number }
  | { kind: "timeout"; err: number; dot: number }
  | { kind: "done"; err: number; dot: number };

/** Logical camera forward at camYaw: (−sin yaw, −cos yaw) — matches sim.ts. */
export function camForward(camYaw: number) {
  return { x: -Math.sin(camYaw), z: -Math.cos(camYaw) };
}

/** Logical camera right at camYaw: (cos yaw, −sin yaw) — matches sim.ts. */
export function camRight(camYaw: number) {
  return { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
}

/**
 * Inverse of sim wish transform:
 *   wishX = fx*moveY + rx*moveX
 *   wishZ = fz*moveY + rz*moveX
 * Given desired world vector v, recover (moveX, moveY) via orthonormal basis.
 * Screen stick: offset x = moveX * scale, offset y = −moveY * scale
 * (stick up = +moveY in sim).
 */
export function worldToStickOffset(
  world: { x: number; z: number },
  camYaw: number,
  scale = 40,
): { dx: number; dy: number; moveX: number; moveY: number } {
  const f = camForward(camYaw);
  const r = camRight(camYaw);
  const moveY = world.x * f.x + world.z * f.z;
  const moveX = world.x * r.x + world.z * r.z;
  const len = Math.hypot(moveX, moveY);
  let nx = moveX;
  let ny = moveY;
  if (len > 1e-6) {
    nx = moveX / Math.max(len, 1e-6);
    ny = moveY / Math.max(len, 1e-6);
    // clamp to unit stick
    const m = Math.hypot(nx, ny);
    if (m > 1) {
      nx /= m;
      ny /= m;
    }
  }
  return { dx: nx * scale, dy: -ny * scale, moveX: nx, moveY: ny };
}

/** Apply sim wish formula to recovered moveX/moveY — used by tests. */
export function wishFromMove(camYaw: number, moveX: number, moveY: number) {
  const f = camForward(camYaw);
  const r = camRight(camYaw);
  return { x: f.x * moveY + r.x * moveX, z: f.z * moveY + r.z * moveX };
}

export function angDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function desiredYawTo(from: { x: number; z: number }, to: { x: number; z: number }) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/**
 * One steering step. Caller applies key for a short real press then re-samples.
 * Drive only when facing is correct AND forward points toward target.
 */
export function decideSteer(
  sample: SteerSample,
  target: { x: number; z: number },
  opts: { errThreshold?: number; requireForwardDot?: boolean } = {},
): SteerDecision {
  const errThreshold = opts.errThreshold ?? 0.28;
  const requireDot = opts.requireForwardDot !== false;
  const desired = desiredYawTo(sample, target);
  const err = angDiff(desired, sample.camYaw);
  const fwd = camForward(sample.camYaw);
  const dx = target.x - sample.x;
  const dz = target.z - sample.z;
  const dot = fwd.x * dx + fwd.z * dz;

  if (Math.abs(err) < errThreshold && (!requireDot || dot > 0)) {
    return { kind: "drive", err, dot };
  }
  if (Math.abs(err) >= errThreshold) {
    // ArrowRight adds +lookX → cam.yaw decreases. Need larger yaw → ArrowLeft.
    return { kind: "turn", key: err > 0 ? "ArrowLeft" : "ArrowRight", err };
  }
  // Facing close but forward still away (target behind): keep turning the short way.
  return { kind: "turn", key: err > 0 ? "ArrowLeft" : "ArrowRight", err };
}

/**
 * Waypoint walker state. Switch resets no-progress; first damage is caller's job.
 */
export type WalkerState = {
  wpIndex: number;
  prevDist: number;
  noProgress: number;
  steerSteps: number;
};

export function createWalkerState(): WalkerState {
  return { wpIndex: 0, prevDist: Infinity, noProgress: 0, steerSteps: 0 };
}

export function onWaypointSwitch(state: WalkerState, nextIndex: number): WalkerState {
  return { wpIndex: nextIndex, prevDist: Infinity, noProgress: 0, steerSteps: 0 };
}

export function noteProgress(state: WalkerState, dist: number, epsilon = 0.05): WalkerState {
  const improved = dist < state.prevDist - epsilon;
  return {
    ...state,
    prevDist: dist,
    noProgress: improved ? 0 : state.noProgress + 1,
  };
}

/** Bounded steering: after N turn steps without drive-ready, fail. */
export function noteSteerStep(state: WalkerState, ready: boolean, maxTurns = 40): { state: WalkerState; timedOut: boolean } {
  if (ready) return { state: { ...state, steerSteps: 0 }, timedOut: false };
  const steerSteps = state.steerSteps + 1;
  return { state: { ...state, steerSteps }, timedOut: steerSteps > maxTurns };
}

/**
 * Shared melee facing — same arc rule as production combat.ts.
 * bodyFwd=(−sin bodyYaw, −cos bodyYaw); dir=dot(bodyFwd, unit(toEnemy)).
 */
export function canFaceEnemyBody(
  sample: { x: number; z: number; bodyYaw: number },
  enemy: { x?: number; z?: number } | null | undefined,
  arc = ATTACK_ARC,
): boolean {
  if (!enemy || enemy.x == null || enemy.z == null) return false;
  const fx = -Math.sin(sample.bodyYaw);
  const fz = -Math.cos(sample.bodyYaw);
  const dx = enemy.x - sample.x;
  const dz = enemy.z - sample.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return false;
  const dir = (dx * fx + dz * fz) / len;
  return dir >= arc;
}

/**
 * Climb handoff gate.
 * Production climb starts only when queryWall in front of the body hits a
 * climbable surface (sim.ts ~1022/1196). Center-to-center distance to a tower
 * shaft is NOT the climb threshold — shafts are meters wide. Callers must pass
 * the live queryWall contact flag and the target climb-surface id.
 */
export function canHandoffToClimb(opts: {
  world?: string;
  mode?: string;
  alive?: boolean;
  /** Kept for diagnostics; not the production threshold. */
  nearestClimbDistance?: number | null;
  /** Live nearest climbable solid id (e.g. "dawn-shaft"). */
  nearestClimbId?: string | null;
  /**
   * Production queryWall contact: a climbable wall is in front of the body.
   * Required — undefined/false refuses handoff.
   */
  touchingClimbable?: boolean;
  /** Required id substring for the intended tower (e.g. "dawn"). */
  requiredClimbPrefix?: string;
}): { ok: true } | { ok: false; reason: string } {
  if (opts.world && opts.world !== "overworld" && opts.world !== "shrine") {
    return { ok: false, reason: `world=${opts.world}` };
  }
  if (opts.mode && opts.mode !== "playing") return { ok: false, reason: `mode=${opts.mode}` };
  if (opts.alive === false) return { ok: false, reason: "not-alive" };
  // Production contact is mandatory — distance alone must never unlock climb.
  if (opts.touchingClimbable !== true) {
    return { ok: false, reason: "not-touching-climbable" };
  }
  if (!opts.nearestClimbId) {
    return { ok: false, reason: "no-climbable-id" };
  }
  if (opts.requiredClimbPrefix && !opts.nearestClimbId.includes(opts.requiredClimbPrefix)) {
    return {
      ok: false,
      reason: `wrong-climb-target id=${opts.nearestClimbId} want~${opts.requiredClimbPrefix}`,
    };
  }
  // Optional sanity: refuse absurd center distances even when contact says true
  // (guards against a probe that hit a far climbable while standing off-tower).
  if (opts.nearestClimbDistance != null && opts.nearestClimbDistance > 12) {
    return {
      ok: false,
      reason: `climbable-too-far d=${opts.nearestClimbDistance.toFixed(2)} (center; contact required)`,
    };
  }
  return { ok: true };
}

/**
 * APPROACH_CONTACT: after coarse near-tower arrival, walk the last meters
 * onto the climb surface. Production handoff needs queryWall contact in front
 * of the body — center distance alone is not enough (shaft r≈4.2).
 * Ordinary look + short drive only. Never write yaw/position.
 */
export type ApproachContactSample = {
  x: number;
  z: number;
  camYaw: number;
  y?: number;
  hp?: number;
  state?: string;
  /** Live probeClimbWall.climbable */
  touchingClimbable?: boolean;
  /** Live probeClimbWall.id */
  nearestClimbId?: string | null;
  /** Live probeClimbWall.centerDistance (diagnostics) */
  nearestClimbDistance?: number | null;
};

export type ApproachContactDecision =
  | { kind: "handoff"; reason: string; id: string | null }
  | { kind: "turn"; key: "ArrowLeft" | "ArrowRight"; reason: string; err: number }
  | { kind: "drive"; reason: string; err: number }
  | { kind: "stop"; reason: string };

/**
 * @param target tower base XZ (bearing only — do not require entering the center)
 * @param surfaceStopXZ refuse driving past the shaft surface (center d below this)
 */
export function decideApproachContact(opts: {
  sample: ApproachContactSample;
  target: { x: number; z: number };
  requiredClimbPrefix: string;
  /** Center-distance below which we must already be in contact; else stop. */
  surfaceStopCenterD?: number;
  noProgress?: number;
  maxNoProgress?: number;
}): ApproachContactDecision {
  const { sample, target } = opts;
  const surfaceStop = opts.surfaceStopCenterD ?? 4.35;
  const maxNoProgress = opts.maxNoProgress ?? 12;

  if (sample.state === "dead" || (sample.hp != null && sample.hp <= 0)) {
    return { kind: "stop", reason: "dead" };
  }
  if (sample.touchingClimbable === true) {
    const id = sample.nearestClimbId ?? null;
    if (id && id.includes(opts.requiredClimbPrefix)) {
      return { kind: "handoff", reason: `contact id=${id}`, id };
    }
    return { kind: "stop", reason: `wrong-wall id=${id ?? "null"}` };
  }

  const centerD = Math.hypot(target.x - sample.x, target.z - sample.z);
  // At the surface without contact: either facing away or probe missed — do not
  // walk through the shaft center chasing a contact.
  if (centerD < surfaceStop) {
    return { kind: "stop", reason: `at-surface-no-contact d=${centerD.toFixed(2)}` };
  }

  if ((opts.noProgress ?? 0) >= maxNoProgress) {
    return { kind: "stop", reason: `no-progress n=${opts.noProgress}` };
  }

  const steer = decideSteer(
    { x: sample.x, z: sample.z, camYaw: sample.camYaw },
    target,
    { errThreshold: 0.32 },
  );
  if (steer.kind === "turn") {
    return { kind: "turn", key: steer.key, reason: "face-tower", err: steer.err };
  }
  if (steer.kind === "drive") {
    return { kind: "drive", reason: "step-to-surface", err: steer.err };
  }
  return { kind: "stop", reason: `steer-${steer.kind}` };
}
