import { CLIMB_SHIMMY, CLIMB_SPEED, CLIMB_STAMINA, FIXED_DT, MANTLE_REACH_XZ, MANTLE_REACH_Y, MANTLE_STEP_XZ, MANTLE_STEP_Y, PLAYER_RADIUS } from "./params.ts";
import { BODY_SKIN, closestPointOnSolidXZ, fittedTopPoint, outsideTopPoint, playerBodyClear, sweepPlayerBody } from "./physics.ts";
import type { BodyPosition, Solid } from "./physics.ts";

export type Mantle = {
  target: Solid;
  points: BodyPosition[];
  phase: number;
  elapsed: number;
  maxTime: number;
  reachPhase: number;
  // A nonstandable wall may lead to actual terrain beyond its far edge. The
  // wall remains collision geometry; no standable solid is synthesized.
  terrain?: BodyPosition;
};

function makePlan(p: BodyPosition, target: Solid, points: BodyPosition[], reachPhase: number, solids: Solid[], heightFn: (x: number, z: number) => number): Mantle | null {
  let from = p, maxTime = 0;
  if (!points.every((next, phase) => {
    const clear = sweepPlayerBody(from, next, solids, heightFn);
    const ySpeed = phase < reachPhase ? CLIMB_SPEED : MANTLE_STEP_Y / FIXED_DT;
    const xzSpeed = phase < reachPhase ? CLIMB_SHIMMY : MANTLE_STEP_XZ / FIXED_DT;
    maxTime += Math.max(Math.hypot(next.x - from.x, next.z - from.z) / xzSpeed,
      Math.abs(next.y - from.y) / ySpeed) + FIXED_DT;
    from = next;
    return clear;
  })) return null;
  return { target: { ...target }, points, phase: 0, elapsed: 0, maxTime: maxTime + FIXED_DT, reachPhase };
}

export function planMantle(p: BodyPosition, candidates: Solid[], solids: Solid[], heightFn: (x: number, z: number) => number, landingHint = p): Mantle | null {
  if (!playerBodyClear(p, solids, heightFn)) return null;
  const sorted = candidates.map(s => ({ s, edge: closestPointOnSolidXZ(s, p.x, p.z).dist }))
    .sort((a, b) => a.edge - b.edge);
  for (const { s, edge } of sorted) {
    const to = fittedTopPoint(s, landingHint);
    if (!to || edge > MANTLE_REACH_XZ || Math.abs(to.y - p.y) > MANTLE_REACH_Y) continue;
    const liftY = Math.max(p.y, to.y) + BODY_SKIN;
    const points = [{ x: p.x, y: liftY, z: p.z }, { x: to.x, y: liftY, z: to.z }, to];
    const plan = makePlan(p, s, points, 0, solids, heightFn);
    if (plan) return plan;
  }
  return null;
}

/** A blocking overhang is rounded before attempting the unchanged mantle reach. */
export function planAroundOverhang(p: BodyPosition, proposedClimb: BodyPosition, wallNormal: { x: number; z: number }, solids: Solid[], heightFn: (x: number, z: number) => number, landingHint = p): Mantle | null {
  if (!playerBodyClear(p, solids, heightFn)) return null;
  for (const target of solids) {
    if (!target.standable || sweepPlayerBody(p, proposedClimb, [target])) continue;
    if (closestPointOnSolidXZ(target, p.x, p.z).dist > MANTLE_REACH_XZ) continue;
    const to = fittedTopPoint(target, landingHint), outside = outsideTopPoint(target, p, wallNormal);
    if (!to || !outside) continue;
    // The head meets a thick ledge before its top enters foot-relative reach.
    // First round the real edge at current height, then climb vertically at
    // the unchanged ordinary climb speed. Only then enter mantle reach.
    const grip = { ...outside, y: Math.max(p.y, to.y - MANTLE_REACH_Y) };
    if (closestPointOnSolidXZ(target, grip.x, grip.z).dist > MANTLE_REACH_XZ) continue;
    const lift = { ...grip, y: Math.max(grip.y, to.y) + BODY_SKIN };
    const plan = makePlan(p, target, [outside, grip, lift, { x: to.x, y: lift.y, z: to.z }, to], 2, solids, heightFn);
    if (plan) return plan;
  }
  return null;
}

/** Conservatively accept a nearly level, fully supported foot disk only. */
function terrainFootY(p: BodyPosition, heightFn: (x: number, z: number) => number) {
  const center = heightFn(p.x, p.z), heights = [center];
  for (const radius of [PLAYER_RADIUS / 2, PLAYER_RADIUS]) {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      heights.push(heightFn(p.x + Math.cos(a) * radius, p.z + Math.sin(a) * radius));
    }
  }
  if (!heights.every(Number.isFinite) || Math.max(...heights) - Math.min(...heights) > BODY_SKIN) return null;
  return center;
}

function terrainEdgeDistance(p: BodyPosition, to: BodyPosition) {
  return Math.max(0, Math.hypot(to.x - p.x, to.z - p.z) - PLAYER_RADIUS);
}

export function planTerrainMantle(p: BodyPosition, wall: Solid, outward: { x: number; z: number }, solids: Solid[], heightFn: (x: number, z: number) => number): Mantle | null {
  if (wall.standable || !wall.climbable || !playerBodyClear(p, solids, heightFn)) return null;
  const to = outsideTopPoint(wall, p, { x: -outward.x, z: -outward.z });
  if (!to || terrainEdgeDistance(p, to) > MANTLE_REACH_XZ) return null;
  const y = terrainFootY(to, heightFn);
  if (y === null || Math.abs(y - p.y) > MANTLE_REACH_Y) return null;
  to.y = y;
  const liftY = Math.max(p.y, y) + BODY_SKIN;
  const plan = makePlan(p, wall, [{ x: p.x, y: liftY, z: p.z }, { x: to.x, y: liftY, z: to.z }, to], 0, solids, heightFn);
  if (plan) plan.terrain = to;
  return plan;
}

export function advanceMantle(m: Mantle, p: BodyPosition, dt: number, solids: Solid[], heightFn: (x: number, z: number) => number) {
  const target = solids.find(s => s.id === m.target.id);
  const unchanged = target && (["kind", "x", "y", "z", "r", "h", "w", "d", "yaw", "standable"] as const)
    .every(k => target[k] === m.target[k]);
  if (!unchanged || m.elapsed + dt > m.maxTime || !playerBodyClear(p, solids, heightFn)) return { status: "blocked" as const, position: p };
  if (m.terrain) {
    const y = terrainFootY(m.terrain, heightFn);
    if (y === null || Math.abs(y - m.terrain.y) > BODY_SKIN) return { status: "blocked" as const, position: p };
  }
  const goal = m.points[m.phase];
  if (!goal) return { status: "done" as const, position: p };
  const dx = goal.x - p.x, dy = goal.y - p.y, dz = goal.z - p.z;
  const horizontal = Math.hypot(dx, dz);
  const targetY = m.terrain?.y ?? m.target.y + m.target.h;
  const targetDistance = m.terrain ? terrainEdgeDistance(p, m.terrain) : closestPointOnSolidXZ(m.target, p.x, p.z).dist;
  if (m.phase === m.reachPhase && (Math.abs(targetY - p.y) > MANTLE_REACH_Y + 1e-8 ||
      targetDistance > MANTLE_REACH_XZ + 1e-8)) return { status: "blocked" as const, position: p };
  const preparing = m.phase < m.reachPhase;
  const yStep = preparing ? CLIMB_SPEED * dt : MANTLE_STEP_Y * dt / FIXED_DT;
  const xzStep = preparing ? CLIMB_SHIMMY * dt : MANTLE_STEP_XZ * dt / FIXED_DT;
  const ratio = Math.min(1, horizontal > 0 ? xzStep / horizontal : 1,
    Math.abs(dy) > 0 ? yStep / Math.abs(dy) : 1);
  const next = { x: p.x + dx * ratio, y: p.y + dy * ratio, z: p.z + dz * ratio };
  if (!sweepPlayerBody(p, next, solids, heightFn)) return { status: "blocked" as const, position: p };
  m.elapsed += dt;
  if (ratio === 1) m.phase++;
  return { status: m.phase === m.points.length ? "done" as const : "moving" as const, position: next,
    staminaCost: preparing ? CLIMB_STAMINA * (Math.abs(dy) > 0 ? 1 : 0.22) * dt : 0 };
}
