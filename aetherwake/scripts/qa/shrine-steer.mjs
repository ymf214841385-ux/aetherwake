/**
 * Shrine floor navigation.
 *
 * Legal explorer path: +X to the sidewalk (origin.x±7.15) FIRST, then +Z
 * past 21.6, THEN into the altar cylinder at origin z+23 (claim r=2.2).
 * A diagonal spawn → (origin.x+7.4, origin.z+22) crosses the rime pit.
 *
 * Rime pit is |lx|<4.8 and lz in (8, 20.4) — not |lx|<6.2.
 *
 * Burst/pull/still still require their puzzle actions (bomb/gust/wait).
 * Standing on the sidewalk is not an auto-claim.
 *
 * Returns walk targets only. The harness still sends WASD/E — never
 * teleports the player or writes window.__sim.
 */

export const ALTAR_ARRIVE = 1.4;
export const ALTAR_CLAIM_R = 2.2;
export const SIDEWALK_OFFSET_X = 7.15;
export const PIT_CLEAR_Z = 20.6;
export const RIME_PIT_HALF_X = 4.8;
export const RIME_PIT_Z0 = 8;
export const RIME_PIT_Z1 = 20.4;
export const PULL_STILL_PIT_HALF_X = 4.6;
export const PULL_STILL_PIT_Z0 = 10;
export const PULL_STILL_PIT_Z1 = 16.5;
/** world.ts shrine body box is 4.4 x 4.4 centered on the POI. */
export const SHRINE_BODY_HALF = 2.2;
/** sim.ts interaction radius for 叩响/进入. */
export const SHRINE_PROMPT_R = 4.2;
/** Stand-off: box face 2.2 + capsule ~0.45 + margin. Prompt still reads (< 4.2). */
export const SHRINE_APPROACH_STANDOFF = 3.1;

/** world.ts SHRINES array order. sim.shrine is this index, not the string id. */
export const SHRINE_INDEX = { rime: 0, burst: 1, pull: 2, still: 3 };
export const SHRINE_NAMES = { rime: "霜息祠", burst: "爆鸣祠", pull: "牵引祠", still: "凝时祠" };

/**
 * Citadel collision AABB copied from world.ts solids (keep 10×10 at 6,-12,
 * walls at x=±11 / z=-11, gate wings at z=+11). Hypothesis only for why
 * 91526 sat at 36.6,10.5: that pose is the pull shrine apron, and a west
 * bee-line from burst toward still also clips the new courtyard walls.
 */
export const CITADEL_BLOCK = { id: "citadel", x0: -5.7, x1: 17.7, z0: -24.2, z1: 0.8 };
/** Pull shrine body 4.4 plus apron cyl r=5.5 at (36, 8). */
export const PULL_APRON_BLOCK = { id: "pull-apron", x0: 30.5, x1: 41.5, z0: 2.5, z1: 13.5 };

/**
 * Burst (118,28) → still (14,-78) without walking west through pull (36,8)
 * or the citadel (x -5..18, z -24..1). First leg is due south, then the
 * crown ridge at z=-90, then the south door of 凝时祠.
 */
export const STILL_SAFE_WAYPOINTS = [
  { x: 118, z: 6 },
  { x: 96, z: -28 },
  { x: 64, z: -70 },
  { x: 40, z: -90 },
  { x: 18, z: -90 },
  { x: 14, z: -81.1 },
];

/** Spawn (16,102) → 凝时祠 without the citadel AABB or pull apron. */
export const STILL_FROM_SPAWN = [
  { x: 40, z: 80 },
  { x: 48, z: 20 },
  { x: 48, z: -40 },
  { x: 40, z: -90 },
  { x: 18, z: -90 },
  { x: 14, z: -81.1 },
];

/** Pit lip on the floor (lz=10 starts the drop). Slab d=7 from z+13 covers 9.5–16.5. */
export const STILL_PIT_LIP_Z = 9.2;
/** |block.x - origin.x| for the 3.2 m wide freeze lane. */
export const STILL_ALIGN_X = 1.4;

export function stillBlockAligned(originX, blockX) {
  return Math.abs(blockX - originX) < STILL_ALIGN_X;
}

/**
 * Walk target beside the shrine body, on the side the explorer comes from.
 * Mirrors climb-policy towerApproachPoint: never walk into the solid, and
 * the prompt (radius 4.2) still appears from the face. WASD only.
 */
export function shrineApproachPoint(poi, from) {
  let dx = poi.x - (from?.x ?? poi.x);
  let dz = poi.z - (from?.z ?? poi.z + 6);
  const len = Math.hypot(dx, dz);
  if (len < 0.001) {
    dx = 0;
    dz = -1;
  } else {
    dx /= len;
    dz /= len;
  }
  return {
    x: poi.x - dx * SHRINE_APPROACH_STANDOFF,
    z: poi.z - dz * SHRINE_APPROACH_STANDOFF,
    distToPoi: SHRINE_APPROACH_STANDOFF,
  };
}

/**
 * Cardinal door faces plus the inbound standoff. Never includes the body center.
 * Harness tries these in order when the first face is blocked or wet.
 */
export function shrineApproachCandidates(poi, from) {
  const inbound = shrineApproachPoint(poi, from);
  const faces = [
    inbound,
    { x: poi.x, z: poi.z + SHRINE_APPROACH_STANDOFF, distToPoi: SHRINE_APPROACH_STANDOFF },
    { x: poi.x + SHRINE_APPROACH_STANDOFF, z: poi.z, distToPoi: SHRINE_APPROACH_STANDOFF },
    { x: poi.x, z: poi.z - SHRINE_APPROACH_STANDOFF, distToPoi: SHRINE_APPROACH_STANDOFF },
    { x: poi.x - SHRINE_APPROACH_STANDOFF, z: poi.z, distToPoi: SHRINE_APPROACH_STANDOFF },
  ];
  const seen = new Set();
  const out = [];
  for (const p of faces) {
    const k = `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export function shrineWorldOrigin(index) {
  return { x: 220 + index * 48, y: 520, z: 0 };
}

export function shrineAltar(origin) {
  return { x: origin.x, z: origin.z + 23 };
}

export function dAltar(pos, origin) {
  const a = shrineAltar(origin);
  return Math.hypot(pos.x - a.x, pos.z - a.z);
}

export function inRimePit(pos, origin) {
  const lx = pos.x - origin.x;
  const lz = pos.z - origin.z;
  return Math.abs(lx) < RIME_PIT_HALF_X && lz > RIME_PIT_Z0 && lz < RIME_PIT_Z1;
}

/** Prefer +X sidewalk; stay on −X only if already on that rim. */
export function sidewalkX(origin, pos) {
  const lx = (pos?.x ?? origin.x) - origin.x;
  if (lx < -5.4) return origin.x - SIDEWALK_OFFSET_X;
  return origin.x + SIDEWALK_OFFSET_X;
}

/** Sample a segment; true if it enters the rime pit volume. */
export function segmentCrossesRimePit(from, to, origin) {
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = {
      x: from.x + (to.x - from.x) * t,
      z: from.z + (to.z - from.z) * t,
    };
    if (inRimePit(p, origin)) return true;
  }
  return false;
}

/**
 * @param {string} id
 * @param {{ x: number, z: number }} origin
 * @param {{ x: number, z: number }} pos
 * @param {{ sideUntil?: number, now?: number, burstOpen?: boolean }} [opts]
 */
export function shrineNavTarget(id, origin, pos, opts = {}) {
  const altar = shrineAltar(origin);
  const dist = dAltar(pos, origin);
  const lx = pos.x - origin.x;
  const lz = pos.z - origin.z;
  const sideX = sidewalkX(origin, pos);
  const onSidewalk = Math.abs(pos.x - sideX) <= 1.35;
  const pastPit = lz > Math.max(RIME_PIT_Z1, PIT_CLEAR_Z) - 0.05;
  const burstOpen = Boolean(opts.burstOpen);

  // Burst wall spans the interior. Until it is down, always bomb — never altar.
  // After burstOpen, do NOT keep targeting z+11.5 (that looped forever).
  if (id === "burst" && !burstOpen) {
    return {
      x: origin.x,
      z: origin.z + 11.5,
      arrive: 1.6,
      reason: "burst-wall",
      tapE: false,
      puzzle: "bomb",
    };
  }

  // Pull metal is before the pit (z+8). Gust first, then sidewalk.
  if (id === "pull" && lz < 9.5 && Math.abs(lx - 6.2) > 2.2) {
    return {
      x: origin.x + 6.2,
      z: origin.z + 8,
      arrive: 2.0,
      reason: "pull-metal",
      tapE: false,
      puzzle: "gust",
    };
  }

  // Still: freeze the moving block from the sidewalk — never the pit center.
  if (id === "still" && lz < 11 && !onSidewalk) {
    return {
      x: sideX,
      z: origin.z + Math.min(Math.max(lz, 4.4), RIME_PIT_Z0 - 0.5),
      arrive: 1.4,
      reason: "still-wait",
      tapE: false,
      puzzle: "wait",
    };
  }

  if (dist < ALTAR_ARRIVE && pastPit) {
    return { x: altar.x, z: altar.z, arrive: ALTAR_ARRIVE, reason: "at-altar", tapE: true };
  }

  const { sideUntil, now } = opts;
  const forceSide = now != null && sideUntil != null && now < sideUntil && lz < 18;

  // +X to sidewalk FIRST. Hold z in front of the pit so the walk is not a diagonal cut.
  if ((!pastPit || forceSide) && Math.abs(pos.x - sideX) > 1.2) {
    const holdZ = lz > RIME_PIT_Z0 ? pos.z : origin.z + Math.min(Math.max(lz, 4.0), RIME_PIT_Z0 - 0.4);
    return {
      x: sideX,
      z: holdZ,
      arrive: 1.4,
      reason: "sidewalk-x",
      tapE: false,
    };
  }

  // +Z past 21.6 along the sidewalk. Never tapE here (dAltar ≈ 7).
  if (!pastPit) {
    return {
      x: sideX,
      z: origin.z + PIT_CLEAR_Z + 0.8,
      arrive: 0.55,
      reason: "clear-pit",
      tapE: false,
      puzzle: id === "still" ? "wait" : id === "rime" ? "frost" : id === "pull" ? "gust" : undefined,
    };
  }

  return {
    x: altar.x,
    z: altar.z,
    arrive: ALTAR_ARRIVE,
    reason: "past-z20-altar",
    tapE: dist < ALTAR_CLAIM_R,
  };
}

function sampleHitsAabb(from, to, box) {
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if (x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1) return true;
  }
  return false;
}

export function segmentHitsOverworldBlock(from, to, box) {
  return sampleHitsAabb(from, to, box);
}

export function stillWaypointsClearObstacles(points = STILL_SAFE_WAYPOINTS) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (segmentHitsOverworldBlock(a, b, CITADEL_BLOCK)) return { ok: false, at: i, block: "citadel" };
    if (segmentHitsOverworldBlock(a, b, PULL_APRON_BLOCK)) return { ok: false, at: i, block: "pull-apron" };
  }
  return { ok: true };
}

/**
 * goTo contract: timeout / non-arrival is a failed status, never a silent
 * "here is the current pose, treat it as the destination".
 */
export function navigationOutcome({ dist, arrive = 2.2, timedOut = false, climbing = false } = {}) {
  const d = Number(dist);
  if (Number.isFinite(d) && d < arrive) {
    return { arrived: true, status: "arrived", dist: d };
  }
  if (climbing && Number.isFinite(d) && d < 8) {
    return { arrived: true, status: "arrived-climbing", dist: d };
  }
  if (timedOut) return { arrived: false, status: "timeout", dist: Number.isFinite(d) ? d : Infinity };
  return { arrived: false, status: "nonarrival", dist: Number.isFinite(d) ? d : Infinity };
}

export function shrinePromptMatches(prompt, id) {
  const name = SHRINE_NAMES[id];
  if (!prompt || !name) return false;
  return prompt.includes(`叩响 ${name}`) || prompt.includes(`进入 ${name}`);
}

/**
 * Enter only when close to the intended shrine AND the prompt names that
 * shrine. Generic 进入 / 叩响 is not enough (91526 pressed E on 进入 牵引祠
 * while requesting still, 91 m away).
 */
export function canEnterIntendedShrine({ id, poi, x, z, prompt }) {
  const dist = Math.hypot((x ?? 0) - poi.x, (z ?? 0) - poi.z);
  if (dist > SHRINE_PROMPT_R) {
    return {
      ok: false,
      refuseE: true,
      reason: "too-far",
      dist,
      prompt: prompt || "",
    };
  }
  if (!shrinePromptMatches(prompt, id)) {
    return {
      ok: false,
      refuseE: true,
      reason: shrinePromptMatches(prompt, "pull") || shrinePromptMatches(prompt, "rime") || shrinePromptMatches(prompt, "burst") || shrinePromptMatches(prompt, "still")
        ? "wrong-shrine"
        : "no-intended-prompt",
      dist,
      prompt: prompt || "",
    };
  }
  return { ok: true, refuseE: false, reason: "intended", dist, prompt };
}

export function enteredShrineMatches(simShrineIndex, id) {
  return simShrineIndex === SHRINE_INDEX[id];
}
