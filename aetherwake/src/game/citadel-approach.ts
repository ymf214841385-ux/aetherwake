/**
 * Citadel outer-wall gate approach.
 * Back wall (6,-23) x[-5,17]; east x=17; west x=-5; front gate z=-1 x=6 gap≈4.6.
 * Never route through walls. Corner clearance = PLAYER_RADIUS + margin.
 */
import { PLAYER_RADIUS } from "./params.ts";
import { validateWalkSegment, type RoutePoint, type RouteSegment } from "./shrine-route.ts";
import type { Solid } from "./physics.ts";

export type CitadelApproachOpts = {
  player: { x: number; y: number; z: number };
  solids: Solid[];
  heightFn: (x: number, z: number) => number;
  extraSupports?: { y: number; id: string; x: number; z: number; r: number }[];
};

const CITADEL = { x: 6, z: -12 };
/** East wall outer face ≈ 17.7; west ≈ -5.7. */
const EAST_OUT_X = 17.7 + PLAYER_RADIUS + 0.5;
const WEST_OUT_X = -5.7 - PLAYER_RADIUS - 0.5;
/** Front of gate (z=-1), stay south of nothing — north of front wall exterior. */
const FRONT_Z = 2;
const GATE = { x: 6, z: -1 };
/** Courtyard stop south of keep (keep z[-17,-7]); boss patrols near z=-4.8. */
const COURT = { x: 6, z: -4 };

/**
 * Waypoints from a south/back exterior pose around the outer wall to the
 * gate mouth. Dense corners — never cut across the box.
 * Chooses east vs west by shorter exterior detour from the player.
 */
export function citadelGateApproachWaypoints(player: { x: number; z: number }): { x: number; z: number }[] {
  const east = player.x >= CITADEL.x;
  const outX = east ? EAST_OUT_X : WEST_OUT_X;
  // Back wall outer face z≈-23.7; capsule needs extra clearance south of it.
  const clearZ = -23.7 - PLAYER_RADIUS - 0.4;
  const startZ = Math.min(player.z, clearZ);
  return [
    // First move south of the back-wall band, then out to the side.
    { x: player.x, z: startZ },
    { x: outX, z: startZ },
    { x: outX, z: -18 },
    { x: outX, z: -8 },
    { x: outX, z: FRONT_Z },
    { x: 12, z: FRONT_Z },
    { x: GATE.x, z: FRONT_Z },
    GATE,
    COURT,
  ];
}

/** Validate the outer approach as contiguous production walk segments. */
export function validateCitadelGateApproach(opts: CitadelApproachOpts): {
  ok: boolean;
  segments: RouteSegment[];
  blockedReason?: string;
  waypoints: { x: number; z: number }[];
} {
  const wps = citadelGateApproachWaypoints(opts.player);
  const segments: RouteSegment[] = [];
  let feet = opts.player.y;
  let from: RoutePoint = { x: opts.player.x, y: feet, z: opts.player.z };
  for (let i = 0; i < wps.length; i++) {
    const w = wps[i]!;
    const to: RoutePoint = { x: w.x, y: opts.heightFn(w.x, w.z), z: w.z };
    const seg = validateWalkSegment(from, to, {
      solids: opts.solids,
      heightFn: opts.heightFn,
      extraSupports: opts.extraSupports ?? [],
      worldId: "overworld",
      id: `citadel-gate-${i}`,
    });
    segments.push(seg);
    if (!seg.validated) {
      return { ok: false, segments, blockedReason: seg.blockedReason, waypoints: wps };
    }
    feet = seg.to.y;
    from = { x: w.x, y: feet, z: w.z };
  }
  return { ok: true, segments, waypoints: wps };
}
