#!/usr/bin/env node
import { initWorld } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { validateCitadelGateApproach, citadelGateApproachWaypoints } from "../../src/game/citadel-approach.ts";
import { validateWalkSegment } from "../../src/game/shrine-route.ts";

initWorld();
const sim = new Sim();
sim.mode = "playing";

const poses = [
  { x: 14, z: -24, y: sim.heightFn(14, -24) },
  { x: 10, z: -28, y: sim.heightFn(10, -28) },
  { x: 0, z: -26, y: sim.heightFn(0, -26) },
  { x: -2, z: -22, y: sim.heightFn(-2, -22) },
];
for (const p of poses) {
  const r = validateCitadelGateApproach({
    player: p,
    solids: sim.solids,
    heightFn: sim.heightFn,
    extraSupports: sim.extraSupports(),
  });
  console.log("pose", p.x, p.z, r.ok ? "PASS" : `FAIL ${r.blockedReason}`, r.waypoints);
}

// Straight reject
const straight = validateWalkSegment(
  { x: 14, y: sim.heightFn(14, -24), z: -24 },
  { x: 6, y: sim.heightFn(6, -4), z: -4 },
  { solids: sim.solids, heightFn: sim.heightFn, worldId: "overworld", id: "straight" },
);
console.log("straight", straight.validated, straight.blockedReason);
