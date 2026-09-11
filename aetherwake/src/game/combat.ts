import { ATTACK_ACTIVE, ATTACK_ARC, ATTACK_HEIGHT, ATTACK_RANGE, ATTACK_RANGE_HEAVY, ATTACK_RECOVER, ATTACK_WINDUP } from "./params.ts";

export type AttackPhase = "idle" | "windup" | "active" | "recover";

export type AttackState = {
  phase: AttackPhase;
  t: number;
  hit: Set<string>;
  heavy: boolean;
};

export function createAttack(): AttackState {
  return { phase: "idle", t: 0, hit: new Set(), heavy: false };
}

export function startAttack(state: AttackState, heavy: boolean): boolean {
  if (state.phase !== "idle") return false;
  state.phase = "windup";
  state.t = ATTACK_WINDUP;
  state.hit.clear();
  state.heavy = heavy;
  return true;
}

export function tickAttack(state: AttackState, dt: number) {
  if (state.phase === "idle") return;
  state.t -= dt;
  if (state.t > 0) return;
  if (state.phase === "windup") {
    state.phase = "active";
    state.t = ATTACK_ACTIVE;
  } else if (state.phase === "active") {
    state.phase = "recover";
    state.t = ATTACK_RECOVER;
  } else {
    state.phase = "idle";
    state.t = 0;
    state.hit.clear();
  }
}

export function meleeHit(
  px: number,
  py: number,
  pz: number,
  yaw: number,
  ex: number,
  ey: number,
  ez: number,
  rangeBoost = 0,
): boolean {
  const dx = ex - px;
  const dy = ey - py;
  const dz = ez - pz;
  if (Math.abs(dy) > ATTACK_HEIGHT) return false;
  const dist = Math.hypot(dx, dz);
  const range = (rangeBoost > 0 ? ATTACK_RANGE_HEAVY : ATTACK_RANGE) + rangeBoost;
  if (dist > range) return false;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const dir = (dx * fx + dz * fz) / (dist || 1);
  return dir >= ATTACK_ARC;
}

export function losBlocked(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  blocked: (x: number, z: number) => boolean,
) {
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocked(ax + (bx - ax) * t, az + (bz - az) * t)) return true;
  }
  return false;
}

export type EnemyPhase =
  | "patrol"
  | "detect"
  | "approach"
  | "windup"
  | "strike"
  | "recover"
  | "hurt"
  | "lost"
  | "dead";

export type EnemyBrain = {
  phase: EnemyPhase;
  t: number;
  rewarded: boolean;
};

export function createBrain(): EnemyBrain {
  return { phase: "patrol", t: 1.2, rewarded: false };
}
