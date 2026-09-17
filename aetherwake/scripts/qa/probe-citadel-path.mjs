#!/usr/bin/env node
/** Probe citadel outer-wall approach with production validateWalkSegment. */
import { initWorld, SHRINES, TOWERS, SAGE, CITADEL_POI } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { validateWalkSegment } from "../../src/game/shrine-route.ts";
import { queryWall, supportY } from "../../src/game/physics.ts";
import { FOOT_SNAP, PLAYER_RADIUS } from "../../src/game/params.ts";

initWorld();
const sim = new Sim();
sim.mode = "playing";

const walls = sim.solids.filter((s) => s.id.startsWith("citadel-wall"));
console.log("walls", walls.map((w) => ({ id: w.id, x: w.x, z: w.z, w: w.w, d: w.d, y: w.y, h: w.h })));

const GATE = { x: 6, z: -1 };
const COURT = { x: 6, z: -8 };
const OUT = { x: 14, z: -24 };

function walk(from, to, label) {
  const a = { x: from.x, y: sim.heightFn(from.x, from.z), z: from.z };
  const seg = validateWalkSegment(a, { x: to.x, y: sim.heightFn(to.x, to.z), z: to.z }, {
    solids: sim.solids,
    heightFn: sim.heightFn,
    extraSupports: sim.extraSupports(),
    worldId: "overworld",
    id: label,
  });
  console.log(label, seg.validated ? "OK" : `FAIL ${seg.blockedReason}`, {
    from: [a.x, a.z, +a.y.toFixed(2)],
    to: [to.x, to.z],
    endY: +seg.to.y.toFixed(2),
  });
  return seg.validated;
}

// Straight through back wall — must fail
walk(OUT, COURT, "straight-back-to-court");
walk({ x: 14, z: -20 }, COURT, "fallback-14-20");
walk(OUT, { x: 6, z: -4.8 }, "straight-to-boss");

// East outer detour: x > 17.7 + radius + margin
const margin = PLAYER_RADIUS + 0.5;
const eastX = 17.7 + margin;
console.log("eastX", eastX);
const eastPath = [
  { x: 14, z: -24 },
  { x: eastX, z: -26 },
  { x: eastX, z: -12 },
  { x: eastX, z: 2 },
  { x: 6, z: 2 },
  { x: 6, z: -1 },
  { x: 6, z: -4 },
  COURT,
];
let ok = true;
for (let i = 0; i < eastPath.length - 1; i++) {
  if (!walk(eastPath[i], eastPath[i + 1], `east-${i}`)) ok = false;
}
console.log("east chain", ok ? "PASS" : "FAIL");

// denser east
const eastDense = [
  { x: 14, z: -24 },
  { x: 18, z: -26 },
  { x: 19, z: -24 },
  { x: 19, z: -18 },
  { x: 19, z: -10 },
  { x: 19, z: -2 },
  { x: 19, z: 2 },
  { x: 14, z: 2 },
  { x: 8, z: 2 },
  { x: 6, z: 1.5 },
  { x: 6, z: -0.5 },
  { x: 6, z: -4 },
  { x: 6, z: -8 },
];
ok = true;
for (let i = 0; i < eastDense.length - 1; i++) {
  if (!walk(eastDense[i], eastDense[i + 1], `dense-${i}`)) ok = false;
}
console.log("east dense", ok ? "PASS" : "FAIL");

// West outer
const westX = -5.7 - margin;
const westDense = [
  { x: 14, z: -24 },
  { x: 0, z: -26 },
  { x: westX, z: -24 },
  { x: westX, z: -12 },
  { x: westX, z: 2 },
  { x: 6, z: 2 },
  { x: 6, z: -1 },
  COURT,
];
ok = true;
for (let i = 0; i < westDense.length - 1; i++) {
  if (!walk(westDense[i], westDense[i + 1], `west-${i}`)) ok = false;
}
console.log("west dense", ok ? "PASS" : "FAIL");

// Gate sample: queryWall at gate
const feet = sim.heightFn(6, -1);
const gateWall = queryWall(6, -1, feet + 0.5, sim.solids);
console.log("gate queryWall", gateWall, "feet", feet);
const gateSup = supportY(6, -1, feet + FOOT_SNAP, sim.solids, sim.heightFn, [], null);
console.log("gate support", gateSup);
