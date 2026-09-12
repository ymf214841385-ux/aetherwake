import { keysToward } from "./digital-direction.mjs";

/** @typedef {{x: number, y: number, z: number, camYaw?: number}} Position3 */
/**
 * Citadel courtyard steer. Copied from world.ts solids — do not import the game graph.
 *
 * Keep 10×10 at (6, -12). West wall x=-5 w=1.4, east x=17, gate at z=-1.
 * Courtyard is +Z of the keep (z ≈ -7 … 0). Dodge that ignores walls (90227)
 * leaves through the west face and lands at x≈-11, y≈7.4, then bee-lining
 * the live boss walks into that wall.
 *
 * Returns walk targets only. Harness still sends WASD/C — never teleports.
 */

export const CITADEL_X = 6;
export const CITADEL_Z = -12;
export const CITADEL_WEST_INNER = -4.2;
export const CITADEL_EAST_INNER = 16.2;
export const CITADEL_KEEP_NORTH = -7;
export const CITADEL_GATE_Z = -1;
export const CITADEL_DODGE_M = 3.1;
/** Courtyard floor in 90227 was y≈10.6; outside west face dropped to 7.3–8.6. */
export const CITADEL_COURTYARD_Y = 10.2;

/**
 * Shared crown-top → courtyard legs used by play-routes fightBoss (95073).
 * boss-from-sealed reuses these; do not invent parallel guessed waypoints.
 */
export const CROWN_TO_CITADEL = [
  { x: 36, z: -90, label: "citadel-off-crown" },
  { x: 24, z: -40, label: "citadel-from-crown" },
  { x: 6, z: 8, label: "citadel-gate-south" },
  { x: 6, z: -1, label: "citadel-gate" },
  { x: 6, z: -5, label: "citadel-standoff" },
];

/** @param {number} x @param {number} z */
export function insideCourtyard(x, z) {
  return x > CITADEL_WEST_INNER && x < CITADEL_EAST_INNER && z > CITADEL_KEEP_NORTH && z < CITADEL_GATE_Z + 1.6;
}

/**
 * Inside the 10×10 keep solid (world.ts citadel-keep at 6,-12).
 * 36458 stuck at 7,-16 with prompt 挑战空王 and off=inside — bee-line W
 * hits the keep north face (unit: minD≈10.6, never melee).
 */
/** @param {number} x @param {number} z */
export function insideKeepVolume(x, z) {
  return Math.abs(x - 6) <= 5.2 && z < CITADEL_KEEP_NORTH - 0.2 && z > -17.6;
}

/**
 * Off the fight floor: below the live boss, west/east of the walls, still on crown, or south of the keep.
 */
/** @param {Position3} s @param {Position3} boss */
export function citadelOffArena(s, boss) {
  const yRef = Number.isFinite(boss?.y) ? boss.y : CITADEL_COURTYARD_Y;
  if (Number.isFinite(s?.y) && s.y > 40) return { off: true, reason: "on-crown" };
  // 054532 death-respawn: classify far-north before height so world spawn
  // (z≈102) is not only "below-courtyard" when y is slightly low.
  if (s.z > CITADEL_GATE_Z + 10) return { off: true, reason: "north-of-gate" };
  if (Number.isFinite(s?.y) && s.y < yRef - 1.6) return { off: true, reason: "below-courtyard" };
  if (insideKeepVolume(s.x, s.z)) return { off: true, reason: "inside-keep" };
  if (s.x < CITADEL_WEST_INNER - 0.35) return { off: true, reason: "west-of-wall" };
  if (s.x > CITADEL_EAST_INNER + 0.35) return { off: true, reason: "east-of-wall" };
  if (s.z < CITADEL_Z - 12) return { off: true, reason: "south-of-keep" };
  return { off: false, reason: "inside" };
}

/**
 * Around the side wall, through the +Z gate, then a stand-off north of the live boss.
 * Direct goTo(boss) from 90227 (-11,-6) is the wall.
 */
/** @param {Position3} s @param {Position3} boss */
export function citadelReturnWaypoints(s, boss) {
  const sideX = s.x < CITADEL_X ? -12 : 18;
  const wps = [];
  // Keep interior (36458 at 7,-16): north face (6,-4) is blocked by keep solid.
  // Probe: south (6,-18.5) walkable, then around to the +Z gate.
  if (insideKeepVolume(s.x, s.z)) {
    // Probes from (7,-16): north (6,-4) blocked; south (6,-22) drops y→6;
    // east (18,-12) lands y≈11 courtyard height. Use east then +Z gate.
    wps.push({ x: 18, z: -12 });
    wps.push({ x: CITADEL_X, z: 8 });
    wps.push({ x: CITADEL_X, z: CITADEL_GATE_Z + 1.8 });
    if (boss && Number.isFinite(boss.x) && Number.isFinite(boss.z)) {
      wps.push({ x: boss.x, z: boss.z + 2.4 });
    }
    return wps;
  }
  if (s.z < 5 && (s.x < CITADEL_WEST_INNER || s.x > CITADEL_EAST_INNER || (s.y ?? 10) < 9.2)) {
    wps.push({ x: sideX, z: 6 });
  }
  wps.push({ x: CITADEL_X, z: 8 });
  wps.push({ x: CITADEL_X, z: CITADEL_GATE_Z + 1.8 });
  if (boss && Number.isFinite(boss.x) && Number.isFinite(boss.z)) {
    wps.push({ x: boss.x, z: boss.z + 2.4 });
  }
  return wps;
}

/** @param {Position3} player @param {number} ux @param {number} uz */
function aimPoint(player, ux, uz) {
  return { x: player.x + ux * CITADEL_DODGE_M, z: player.z + uz * CITADEL_DODGE_M };
}

// Check the direction the keyboard will actually send, not just the ideal
// target: eight-way quantization can push a near-edge player into a gate wing.
/** @param {Position3} player @param {{x: number, z: number}} target */
function digitalGatePathClear(player, target) {
  if (typeof player.camYaw !== "number") return false;
  const keys = keysToward(player, target.x, target.z, false);
  if (!keys.length) return false;
  const right = Number(keys.includes("KeyD")) - Number(keys.includes("KeyA"));
  const forward = Number(keys.includes("KeyW")) - Number(keys.includes("KeyS"));
  const norm = Math.hypot(right, forward);
  const dx = (Math.cos(player.camYaw) * right - Math.sin(player.camYaw) * forward) / norm;
  const dz = (-Math.sin(player.camYaw) * right - Math.cos(player.camYaw) * forward) / norm;
  if (!(dz > 0)) return false;
  // Gate depth z=-1 +/-0.7, expanded by player radius 0.32.
  const enter = Math.max(0, (-2.02 - player.z) / dz);
  const leave = Math.min(CITADEL_DODGE_M, (0.02 - player.z) / dz);
  if (leave < enter) return true;
  return [enter, leave].every(t => {
    const x = player.x + dx * t;
    return x > 4.1 && x < 7.9;
  });
}

/**
 * Dodge destination that stays on the courtyard. Away-from-boss first; if that
 * 3.1 m dash would leave, strafe; if both leave, dash toward the courtyard center.
 */
/** @param {Position3} player @param {Position3} boss */
export function citadelDodgeAim(player, boss) {
  // E27: the open gate approach is a separate defensive region. Do not widen
  // insideCourtyard: other navigation still relies on its existing bounds.
  if (player.z > 0.6 && player.z <= 8 &&
      player.x > CITADEL_WEST_INNER && player.x < CITADEL_EAST_INNER) {
    const dx = player.x - boss?.x, dz = player.z - boss?.z;
    const len = Math.hypot(dx, dz);
    if (Number.isFinite(len) && len > 1e-8) {
      const ux = dx / len, uz = dz / len;
      for (const { vx, vz, reason } of [
        { vx: ux, vz: uz, reason: "gate-apron-away" },
        { vx: -uz, vz: ux, reason: "gate-apron-strafe" },
        { vx: uz, vz: -ux, reason: "gate-apron-strafe" },
      ]) {
        const p = aimPoint(player, vx, vz);
        if (p.z > 0.6 && p.z <= 10 &&
            p.x > CITADEL_WEST_INNER && p.x < CITADEL_EAST_INNER) return { ...p, reason };
      }
    }
    return { safe: false, reason: "no-safe-direction", region: "gate-apron" };
  }
  const dx = player.x - (boss?.x ?? CITADEL_X);
  const dz = player.z - (boss?.z ?? CITADEL_Z + 7.2);
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const away = aimPoint(player, ux, uz);
  // The open gate connects courtyard and apron. Rejecting this crossing
  // selected a sideways dodge into a gate wing in the fourth E31 attack.
  // Opening x=3.7..8.3 minus radius 0.32 and a small collision margin.
  if (insideCourtyard(player.x, player.z) &&
      player.x > 4.1 && player.x < 7.9 && away.x > 4.1 && away.x < 7.9 &&
      away.z > 0.6 && away.z <= 8 && digitalGatePathClear(player, away)) {
    return { x: away.x, z: away.z, reason: "gate-corridor-away" };
  }
  if (insideCourtyard(away.x, away.z)) return { x: away.x, z: away.z, reason: "away" };
  const s1 = aimPoint(player, -uz, ux);
  const s2 = aimPoint(player, uz, -ux);
  const c1 = insideCourtyard(s1.x, s1.z);
  const c2 = insideCourtyard(s2.x, s2.z);
  if (c1 && !c2) return { x: s1.x, z: s1.z, reason: "strafe" };
  if (c2 && !c1) return { x: s2.x, z: s2.z, reason: "strafe" };
  if (c1 && c2) {
    const midX = (CITADEL_WEST_INNER + CITADEL_EAST_INNER) * 0.5;
    const midZ = (CITADEL_KEEP_NORTH + CITADEL_GATE_Z) * 0.5;
    const d1 = Math.hypot(s1.x - midX, s1.z - midZ);
    const d2 = Math.hypot(s2.x - midX, s2.z - midZ);
    return d1 <= d2 ? { x: s1.x, z: s1.z, reason: "strafe" } : { x: s2.x, z: s2.z, reason: "strafe" };
  }
  return { x: CITADEL_X, z: CITADEL_Z + 7.2, reason: "center" };
}
