#!/usr/bin/env node
/** Validate full spawn→burst-door corridor with west door-side connector. */
import { initWorld, SHRINES, TOWERS, SAGE, CITADEL_POI } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { validateWalkSegment } from "../../src/game/shrine-route.ts";
import { buildOverworldGraph } from "../../src/game/navigation.ts";

initWorld();
const sim = new Sim();
const s = SHRINES.find((x) => x.id === "burst");

const pts = [
  { id: "spawn", x: sim.spawn.x, z: sim.spawn.z },
  { id: "corr-b1", x: 32, z: 86 },
  { id: "corr-b2", x: 47, z: 70 },
  { id: "corr-b3", x: 58, z: 68 },
  { id: "corr-b4", x: 72, z: 58 },
  { id: "corr-b5", x: 90, z: 42 },
  { id: "corr-b6", x: 108, z: 35 },
  // west door-side (headed burst-seg4)
  { id: "corr-bw1", x: 110, z: 31 },
  { id: "corr-bw2", x: 112, z: 30 },
  { id: "corr-bw3", x: 114, z: 29.6 },
  { id: "corr-bw4", x: 116, z: 29.8 },
  { id: "door", x: 118, z: 30.8 },
];

function walkChain(points) {
  const results = [];
  let feet = sim.heightFn(points[0].x, points[0].z);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const from = { x: a.x, y: feet, z: a.z };
    const to = { x: b.x, y: sim.heightFn(b.x, b.z), z: b.z };
    const seg = validateWalkSegment(from, to, {
      solids: sim.solids,
      heightFn: sim.heightFn,
      extraSupports: sim.extraSupports(),
      worldId: "overworld",
      id: `${a.id}->${b.id}`,
    });
    results.push({
      edge: `${a.id}->${b.id}`,
      from: [a.x, a.z, +from.y.toFixed(3)],
      to: [b.x, b.z, +to.y.toFixed(3)],
      ok: seg.validated,
      why: seg.blockedReason,
      endY: +seg.to.y.toFixed(3),
    });
    if (!seg.validated) {
      // first fail detail
      feet = from.y;
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      const steps = Math.max(2, Math.ceil(dist / 0.35));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = from.x + (to.x - from.x) * t;
        const z = from.z + (to.z - from.z) * t;
        // reuse validate's logic by single-step? just report
      }
      break;
    }
    feet = seg.to.y;
  }
  console.log(JSON.stringify(results, null, 2));
  return results.every((r) => r.ok);
}

console.log("full chain", walkChain(pts) ? "PASS" : "FAIL");

// Also try: keep b7 then go west-north around
const alt = [
  { id: "spawn", x: sim.spawn.x, z: sim.spawn.z },
  { id: "corr-b1", x: 32, z: 86 },
  { id: "corr-b2", x: 47, z: 70 },
  { id: "corr-b3", x: 58, z: 68 },
  { id: "corr-b4", x: 72, z: 58 },
  { id: "corr-b5", x: 90, z: 42 },
  { id: "corr-b6", x: 105, z: 36 },
  { id: "corr-b7w", x: 108, z: 33 },
  { id: "corr-b8w", x: 110, z: 31 },
  { id: "corr-b9w", x: 112, z: 30 },
  { id: "corr-b10w", x: 114, z: 29.6 },
  { id: "door", x: 118, z: 30.8 },
];
console.log("alt", walkChain(alt) ? "PASS" : "FAIL");

// dense west from b6
const dense = [
  { id: "b6", x: 108, z: 35 },
  { id: "w1", x: 109, z: 33 },
  { id: "w2", x: 110, z: 31.5 },
  { id: "w3", x: 111, z: 30.5 },
  { id: "w4", x: 112, z: 30 },
  { id: "w5", x: 113, z: 29.7 },
  { id: "w6", x: 114, z: 29.6 },
  { id: "w7", x: 115, z: 29.8 },
  { id: "w8", x: 116, z: 30.2 },
  { id: "door", x: 118, z: 30.8 },
];
console.log("dense b6", walkChain(dense) ? "PASS" : "FAIL");

// feet-carrying: use seg endY which already did
// Check east from b5
const east = [
  { id: "b5", x: 90, z: 42 },
  { id: "e1", x: 100, z: 36 },
  { id: "e2", x: 110, z: 32 },
  { id: "e3", x: 118, z: 31 },
  { id: "door", x: 118, z: 30.8 },
];
console.log("east mid", walkChain(east) ? "PASS" : "FAIL");
