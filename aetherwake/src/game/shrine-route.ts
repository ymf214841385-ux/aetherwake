/**
 * Production shrine route builders with local connector validation.
 * Uses live solids + support heights — no chords through walls/pits.
 */

import { queryWall, solidTop, supportY, type Solid } from "./physics.ts";
import { FOOT_SNAP, PLAYER_RADIUS, STEP_UP } from "./params.ts";
import { BURST_WALL, SHRINE_ROOM, SHRINE_SIDEWALK, shrineWorldOrigin } from "./world.ts";

export type RoutePoint = { x: number; y: number; z: number; label?: string };

export type RouteSegment = {
  id: string;
  worldId: string;
  kind: "walk" | "action";
  from: RoutePoint;
  to: RoutePoint;
  validated: boolean;
  blockedReason?: string;
  /** Support-following samples for ground rendering (not a straight chord). */
  polyline?: RoutePoint[];
};

export type NavigationSnapshot = {
  worldId: string;
  status: "walk" | "action-required" | "unavailable";
  reason: string;
  nextAction: string;
  requiredArt: string | null;
  targetId: string | null;
  segments: RouteSegment[];
  guidance: string;
};

/** Sample spacing tied to production capsule radius, not a magic 0.55. */
const SAMPLE = PLAYER_RADIUS * 1.1;
/** Max walkable drop between samples (beyond this → fall, not walk). */
const MAX_DROP = FOOT_SNAP + STEP_UP;
/**
 * Production snapVertical lifts to supportY(p.y+FOOT_SNAP), whose maxLift is
 * feet+2*FOOT_SNAP. STEP_UP only gates horizontal wall blocking — do not
 * invent a tighter climb cap here (burst apron rim is ~0.7–0.8 and is walkable).
 */
const MAX_RISE = FOOT_SNAP * 2;

function blocked(id: string, worldId: string, from: RoutePoint, to: RoutePoint, reason: string): RouteSegment {
  return { id, worldId, kind: "walk", from, to, validated: false, blockedReason: reason, polyline: [] };
}

/**
 * Validate a ground walk using production capsule clearance + step rules.
 * Standable tops are walkable only when within step-up of current feet;
 * their sides still block like walls.
 */
export function validateWalkSegment(
  from: RoutePoint,
  to: RoutePoint,
  opts: {
    solids: Solid[];
    heightFn: (x: number, z: number) => number;
    extraSupports?: { y: number; id: string; x: number; z: number; r: number }[];
    excludeSolidIds?: string[];
    worldId: string;
    id: string;
  },
): RouteSegment {
  const exclude = new Set(opts.excludeSolidIds ?? []);
  const extra = opts.extraSupports ?? [];
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(2, Math.ceil(dist / SAMPLE));
  let feet = from.y;
  const polyline: RoutePoint[] = [{ x: from.x, y: from.y, z: from.z }];

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;

    // Side clearance: any solid whose body blocks the capsule at current feet.
    for (const s of opts.solids) {
      if (exclude.has(s.id)) continue;
      const top = solidTop(s);
      // Low standable pads we can step onto are not walls.
      if (s.standable && top <= feet + STEP_UP + 0.02 && top >= feet - MAX_DROP) continue;
      // Tall standable boxes still block on the side (not walk-through).
      const hit = queryWall(x, z, feet + 0.55, [s], PLAYER_RADIUS);
      if (hit) {
        return blocked(opts.id, opts.worldId, from, to, `被 ${hit.id} 挡住`);
      }
    }

    const sup = supportY(x, z, feet + FOOT_SNAP, opts.solids, opts.heightFn, extra, null);
    // supportY may snap to high terrain if feetY is too high — reject illegal steps.
    if (sup.y > feet + MAX_RISE) {
      return blocked(opts.id, opts.worldId, from, to, "上坡过陡");
    }
    if (sup.y < feet - MAX_DROP) {
      return blocked(opts.id, opts.worldId, from, to, "落差过大");
    }
    // Head clearance against low ceilings is rare in this world; mid sample uses feet+PLAYER_HEIGHT*0.45 in queryWall above.
    feet = sup.y;
    polyline.push({ x, y: feet, z });
  }

  polyline[polyline.length - 1]!.y = feet;
  return {
    id: opts.id,
    worldId: opts.worldId,
    kind: "walk",
    from,
    to: { ...to, y: feet },
    validated: true,
    polyline,
  };
}

/**
 * Assemble a contiguous validated path from `start` through waypoints.
 * Stops at the first blocked edge. Never concatenates a clear suffix past a gap.
 */
export function assembleContiguousPath(
  start: RoutePoint,
  waypoints: RoutePoint[],
  validate: (from: RoutePoint, to: RoutePoint, id: string) => RouteSegment,
  idPrefix: string,
): { segments: RouteSegment[]; end: RoutePoint; complete: boolean } {
  const segments: RouteSegment[] = [];
  let cur = start;
  for (let i = 0; i < waypoints.length; i++) {
    const seg = validate(cur, waypoints[i]!, `${idPrefix}-${i}`);
    segments.push(seg);
    if (!seg.validated) {
      return { segments, end: cur, complete: false };
    }
    cur = seg.to;
  }
  return { segments, end: cur, complete: true };
}

export function nearPoint(a: RoutePoint, b: RoutePoint, r = 2.5) {
  return Math.hypot(a.x - b.x, a.z - b.z) < r;
}

/**
 * Burst shrine interior route from live crackedBroken + solids.
 * Path is contiguous from the player; stops at the wall or the first blocked connector.
 */
export function buildBurstShrineRoute(opts: {
  shrineIndex: number;
  player: { x: number; y: number; z: number };
  crackedBroken: boolean;
  solids: Solid[];
  heightFn: (x: number, z: number) => number;
  extraSupports?: { y: number; id: string; x: number; z: number; r: number }[];
}): NavigationSnapshot {
  const o = shrineWorldOrigin(opts.shrineIndex);
  const worldId = `shrine:burst`;
  const entry: RoutePoint = { x: o.x, y: o.y, z: o.z + 4.4, label: "祠内入口" };
  const action: RoutePoint = {
    x: o.x,
    y: o.y,
    z: o.z + BURST_WALL.z - 1.4,
    label: "裂纹岩壁前",
  };
  const passage: RoutePoint = { x: o.x, y: o.y, z: o.z + BURST_WALL.z + 1.6, label: "破壁通道" };
  const sidewalk: RoutePoint = {
    x: o.x + SHRINE_SIDEWALK.x,
    y: o.y + SHRINE_SIDEWALK.y,
    z: o.z + SHRINE_SIDEWALK.z + 4,
    label: "侧廊",
  };
  const altarApproach: RoutePoint = {
    x: o.x,
    y: o.y,
    z: o.z + SHRINE_ROOM.altarZ - 2.5,
    label: "祭坛前",
  };
  const here: RoutePoint = { x: opts.player.x, y: opts.player.y, z: opts.player.z };

  const validate = (a: RoutePoint, b: RoutePoint, id: string) =>
    validateWalkSegment(a, b, {
      solids: opts.solids,
      heightFn: opts.heightFn,
      extraSupports: opts.extraSupports ?? [],
      worldId,
      id,
    });

  if (!opts.crackedBroken) {
    // Root at player: if already near the action point, skip walking back to entry.
    const wps = nearPoint(here, action, 3) ? [] : nearPoint(here, entry, 3) ? [action] : [entry, action];
    const { segments, end, complete } = assembleContiguousPath(here, wps, validate, "burst");
    const atAction = nearPoint(end, action, 2.2) || (complete && wps.length === 0);
    return {
      worldId,
      status: "action-required",
      reason: "裂纹岩壁阻挡通路",
      nextAction: "选择爆鸣，击碎裂纹岩壁",
      requiredArt: "burst",
      targetId: "burst-wall",
      segments,
      guidance: atAction ? "在裂纹岩壁前施放爆鸣" : "前往机关附近：裂纹岩壁前施放爆鸣",
    };
  }

  // Wall broken — contiguous walk player → … → altar approach (not into the altar solid).
  const chains: RoutePoint[][] = [
    nearPoint(here, passage, 2.5) ? [sidewalk, altarApproach] : [entry, passage, sidewalk, altarApproach],
    nearPoint(here, passage, 2.5) ? [altarApproach] : [entry, passage, altarApproach],
  ];
  let best: { segments: RouteSegment[]; end: RoutePoint; complete: boolean } | null = null;
  for (const wps of chains) {
    const assembled = assembleContiguousPath(here, wps, validate, "burst");
    if (assembled.complete && nearPoint(assembled.end, altarApproach, 2.5)) {
      best = assembled;
      break;
    }
    if (!best || assembled.segments.filter((s) => s.validated).length > best.segments.filter((s) => s.validated).length) {
      best = assembled;
    }
  }
  const assembled = best!;
  const reached = assembled.complete && nearPoint(assembled.end, altarApproach, 2.5);
  if (reached) {
    return {
      worldId,
      status: "walk",
      reason: "",
      nextAction: "靠近祭坛并互动领取灵核",
      requiredArt: null,
      targetId: "altar:burst",
      segments: assembled.segments.filter((s) => s.validated),
      guidance: "沿已验证通路前往祭坛，互动领取灵核",
    };
  }
  return {
    worldId,
    status: "unavailable",
    reason: "尚未找到可通行路线",
    nextAction: "检查通路或从入口重新接近",
    requiredArt: null,
    targetId: "altar:burst",
    segments: assembled.segments.filter((s) => s.validated),
    guidance: "尚未找到可通行路线",
  };
}

export function emptyOverworldSnapshot(worldId = "overworld"): NavigationSnapshot {
  return {
    worldId,
    status: "unavailable",
    reason: "",
    nextAction: "",
    requiredArt: null,
    targetId: null,
    segments: [],
    guidance: "",
  };
}

/**
 * Overworld multi-waypoint detour: validate graph edges with real physics,
 * search for a contiguous path from the player, never draw disconnected suffixes.
 */
export function buildOverworldDetourRoute(opts: {
  player: { x: number; y: number; z: number };
  dest: { x: number; y: number; z: number; label?: string; targetId: string };
  /** Authored waypoints (hub/spawn/sage/tower-base/shrine-door). */
  waypoints: { id: string; x: number; y: number; z: number }[];
  solids: Solid[];
  heightFn: (x: number, z: number) => number;
  extraSupports?: { y: number; id: string; x: number; z: number; r: number }[];
  nextAction: string;
  guidanceOk: string;
  guidanceBlocked: string;
}): NavigationSnapshot {
  const worldId = "overworld";
  const here: RoutePoint = { x: opts.player.x, y: opts.player.y, z: opts.player.z };
  const dest: RoutePoint = { x: opts.dest.x, y: opts.dest.y, z: opts.dest.z, label: opts.dest.label };
  const validate = (a: RoutePoint, b: RoutePoint, id: string) =>
    validateWalkSegment(a, b, {
      solids: opts.solids,
      heightFn: opts.heightFn,
      extraSupports: opts.extraSupports ?? [],
      worldId,
      id,
    });

  // Try direct first.
  const direct = validate(here, dest, "ow-direct");
  if (direct.validated) {
    return {
      worldId,
      status: "walk",
      reason: "",
      nextAction: opts.nextAction,
      requiredArt: null,
      targetId: opts.dest.targetId,
      segments: [direct],
      guidance: opts.guidanceOk,
    };
  }

  // Build adjacency among waypoints within 80m, validate each edge once.
  type Node = { id: string; p: RoutePoint };
  const nodes: Node[] = [
    { id: "here", p: here },
    ...opts.waypoints.map((w) => ({ id: w.id, p: { x: w.x, y: w.y, z: w.z } })),
    { id: "dest", p: dest },
  ];
  const edgeCache = new Map<string, RouteSegment | null>();
  const edgeKey = (a: string, b: string, feet: number) => `${a}=>${b}@${feet.toFixed(2)}`;
  /** Validate a→b starting from actual approached feet height (not raw node.y). */
  const getEdge = (a: Node, b: Node, fromFeetY: number) => {
    const k = edgeKey(a.id, b.id, fromFeetY);
    if (edgeCache.has(k)) return edgeCache.get(k)!;
    if (Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) > 80) {
      edgeCache.set(k, null);
      return null;
    }
    const start: RoutePoint = { x: a.p.x, y: fromFeetY, z: a.p.z };
    const seg = validate(start, b.p, `ow-${a.id}-${b.id}`);
    edgeCache.set(k, seg.validated ? seg : null);
    return seg.validated ? seg : null;
  };

  // Dijkstra from here to dest over validated edges; carry reached feet height.
  const dist = new Map<string, number>();
  const feetAt = new Map<string, number>();
  const prev = new Map<string, { id: string; seg: RouteSegment }>();
  const done = new Set<string>();
  dist.set("here", 0);
  feetAt.set("here", here.y);
  while (true) {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (!best) break;
    if (best === "dest") break;
    done.add(best);
    const from = nodes.find((n) => n.id === best)!;
    const fromFeet = feetAt.get(best) ?? from.p.y;
    for (const to of nodes) {
      if (done.has(to.id)) continue;
      const seg = getEdge(from, to, fromFeet);
      if (!seg) continue;
      const nd = bestD + Math.hypot(seg.to.x - seg.from.x, seg.to.z - seg.from.z);
      if (nd < (dist.get(to.id) ?? Infinity)) {
        dist.set(to.id, nd);
        feetAt.set(to.id, seg.to.y);
        prev.set(to.id, { id: from.id, seg });
      }
    }
  }

  if (!dist.has("dest")) {
    return {
      worldId,
      status: "unavailable",
      reason: "尚未找到可通行路线",
      nextAction: opts.nextAction,
      requiredArt: null,
      targetId: opts.dest.targetId,
      segments: [],
      guidance: opts.guidanceBlocked,
    };
  }

  const chain: RouteSegment[] = [];
  let cur = "dest";
  while (cur !== "here") {
    const step = prev.get(cur);
    if (!step) break;
    chain.unshift(step.seg);
    cur = step.id;
  }
  return {
    worldId,
    status: "walk",
    reason: "",
    nextAction: opts.nextAction,
    requiredArt: null,
    targetId: opts.dest.targetId,
    segments: chain,
    guidance: opts.guidanceOk,
  };
}
