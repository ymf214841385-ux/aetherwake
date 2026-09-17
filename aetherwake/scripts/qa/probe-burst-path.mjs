#!/usr/bin/env node
/** Find high-terrain connector path corr-b7 → burst door. */
import { initWorld, SHRINES } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { validateWalkSegment } from "../../src/game/shrine-route.ts";
import { supportY } from "../../src/game/physics.ts";
import { FOOT_SNAP, PLAYER_RADIUS, STEP_UP } from "../../src/game/params.ts";

initWorld();
const sim = new Sim();
const s = SHRINES.find((x) => x.id === "burst");

function sample(x, z, feetHint) {
  const terrain = sim.heightFn(x, z);
  const feet = feetHint ?? terrain;
  const sup = supportY(x, z, feet + FOOT_SNAP, sim.solids, sim.heightFn, sim.extraSupports(), null);
  return { x, z, terrain: +terrain.toFixed(3), sup: +sup.y.toFixed(3), id: sup.id, rise: +(sup.y - feet).toFixed(3) };
}

// Scan a grid near burst for high ground
const grid = [];
for (let z = 20; z <= 40; z += 1) {
  for (let x = 108; x <= 128; x += 1) {
    const t = sim.heightFn(x, z);
    const d = Math.hypot(x - s.x, z - s.z);
    if (t >= 9.95 || d < 6) {
      grid.push({ x, z, t: +t.toFixed(3), d: +d.toFixed(2) });
    }
  }
}
console.log("high terrain grid", grid.filter(g => g.t >= 9.95));

// Candidate path: walk along height contour from south-east toward door
// Observed: z=31 at x=118 has h=10.09; need path from b7(116,35)
const candidates = [
  [116, 35],
  [116, 34],
  [116, 33],
  [116, 32],
  [116, 31],
  [116, 30.8],
  [117, 31],
  [117.5, 30.8],
  [118, 31],
  [118, 30.8],
  [117, 32],
  [117, 33],
  [115, 33],
  [115, 32],
  [115, 31],
  [114, 32],
  [114, 31],
  [113, 31],
  [112, 30],
  [112, 28],
  [113, 28],
  [114, 28],
  [115, 28],
  [116, 28],
  [117, 28],
];
for (const [x, z] of candidates) {
  console.log(sample(x, z));
}

// Validate chain b7 → ... → door
const door = { x: s.x, y: 10.36, z: s.z + 2.8 };
const chains = [
  ["b7-direct-door", [[116, 35], [118, 31], [118, 30.8]]],
  ["via-31", [[116, 35], [116, 32], [116, 31], [118, 31]]],
  ["via-west", [[116, 35], [114, 32], [113, 28], [118, 30.8]]],
  ["via-south-high", [[116, 35], [117, 33], [117, 32], [117.5, 31], [118, 30.8]]],
  ["via-b10-only", [[118, 31], [118, 30.8]]],
  ["b7-to-b10", [[116, 35], [118, 31]]],
  ["b6-to-b10", [[108, 35], [118, 31]]],
  ["b7-step", [[116, 35], [116, 33], [116, 32], [117, 31.5], [118, 31]]],
];
for (const [name, pts] of chains) {
  let ok = true;
  let detail = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = { x: pts[i][0], y: sim.heightFn(pts[i][0], pts[i][1]), z: pts[i][1] };
    const b = { x: pts[i + 1][0], y: sim.heightFn(pts[i + 1][0], pts[i + 1][1]), z: pts[i + 1][1] };
    const seg = validateWalkSegment(a, b, {
      solids: sim.solids,
      heightFn: sim.heightFn,
      extraSupports: sim.extraSupports(),
      worldId: "overworld",
      id: `${name}-${i}`,
    });
    detail.push({ a: [a.x, a.z, +a.y.toFixed(2)], b: [b.x, b.z, +b.y.toFixed(2)], ok: seg.validated, why: seg.blockedReason, endY: +seg.to.y.toFixed(3) });
    if (!seg.validated) ok = false;
  }
  console.log("chain", name, ok, JSON.stringify(detail));
}

// Also validate door y options
const doorYs = {
  hf028: sim.heightFn(118, 30.8) + 0.28,
  terrain: sim.heightFn(118, 30.8),
  support: supportY(118, 30.8, sim.heightFn(118, 30.8) + FOOT_SNAP, sim.solids, sim.heightFn, [], null).y,
};
console.log("doorYs", doorYs);
const fromB10 = { x: 118, y: sim.heightFn(118, 31), z: 31 };
for (const [k, y] of Object.entries(doorYs)) {
  const seg = validateWalkSegment(fromB10, { x: 118, y, z: 30.8 }, {
    solids: sim.solids, heightFn: sim.heightFn, extraSupports: sim.extraSupports(),
    worldId: "overworld", id: `door-${k}`,
  });
  console.log("b10→door y", k, y, seg.validated, seg.blockedReason, "end", seg.to.y);
}
