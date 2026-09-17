#!/usr/bin/env node
/**
 * Map a walkable connector into burst door from high north plateau.
 * Goal: dense waypoints so each chord STEP_UP stays legal.
 */
import { initWorld, SHRINES } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { validateWalkSegment } from "../../src/game/shrine-route.ts";
import { supportY } from "../../src/game/physics.ts";
import { FOOT_SNAP, STEP_UP } from "../../src/game/params.ts";

initWorld();
const sim = new Sim();
const s = SHRINES.find((x) => x.id === "burst");
const door = { x: 118, z: 30.8 };

function tryPath(pts, label) {
  const segments = [];
  let ok = true;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const a = { x: ax, y: sim.heightFn(ax, az), z: az };
    const b = { x: bx, y: sim.heightFn(bx, bz), z: bz };
    const seg = validateWalkSegment(a, b, {
      solids: sim.solids,
      heightFn: sim.heightFn,
      extraSupports: sim.extraSupports(),
      worldId: "overworld",
      id: `${label}-${i}`,
    });
    segments.push({
      i,
      a: [ax, az, +a.y.toFixed(2)],
      b: [bx, bz, +b.y.toFixed(2)],
      ok: seg.validated,
      why: seg.blockedReason,
      endY: +seg.to.y.toFixed(3),
    });
    if (!seg.validated) ok = false;
  }
  console.log(label, ok ? "PASS" : "FAIL", JSON.stringify(segments, null, 2));
  return ok;
}

// Approach from NE high ground, arc around body, reach door from east of body
// body is 4.4x4.4 at (118,28), so body occupies x 115.8-120.2, z 25.8-30.2
// door at z=30.8 is south of body. Need to come around east side: x>120.5 or west x<115.5

// High NE: (122,26) h=9.965, (121,27) h=10.02, (120,28) h=10.169, (120,29) h=10.169
// Path: east of body then south to door
tryPath(
  [
    [122, 26],
    [121.5, 27],
    [121, 28],
    [121, 29],
    [121, 30],
    [120.5, 30.8],
    [118, 30.8],
  ],
  "east-arc",
);

// denser east arc
tryPath(
  [
    [122, 26],
    [121.5, 26.5],
    [121.5, 27.5],
    [121.5, 28.5],
    [121.5, 29.5],
    [121, 30.2],
    [120, 30.8],
    [119, 30.8],
    [118, 30.8],
  ],
  "east-dense",
);

// west arc
tryPath(
  [
    [114, 26],
    [114.5, 27],
    [114.5, 28],
    [114.5, 29],
    [114.5, 30],
    [115, 30.8],
    [116, 30.8],
    [117, 30.8],
    [118, 30.8],
  ],
  "west-arc",
);

// From b6/b7 via south contour staying off apron until high ground
// terrain at (112,30)=9.536, (113,30)?, (114,30)=?, need gradual
const probe = [
  [108, 35],
  [110, 34],
  [112, 33],
  [112, 32],
  [113, 31],
  [114, 30],
  [115, 30],
  [116, 30],
  [117, 30],
  [118, 30],
  [118, 30.8],
];
for (const [x, z] of probe) {
  const t = sim.heightFn(x, z);
  const sup = supportY(x, z, t + FOOT_SNAP, sim.solids, sim.heightFn, sim.extraSupports(), null);
  console.log("probe", x, z, "t", t.toFixed(3), "sup", sup.y.toFixed(3), sup.id);
}
tryPath(probe, "south-contour");

// graded climb: stay on terrain outside apron until high enough
// Find path that uses only terrain (no apron snap) until feet ~9.9
// then step onto apron
tryPath(
  [
    [112, 33],
    [112.5, 32],
    [113, 31],
    [113.5, 30],
    [114, 29],
    [115, 28],
    [116, 28],
    [117, 29],
    [117.5, 30],
    [118, 30.8],
  ],
  "west-graded",
);

// From corr-b7 (116,35) find dense climb along west of apron
tryPath(
  [
    [116, 35],
    [114, 34],
    [113, 33],
    [112.5, 32],
    [112.5, 31],
    [113, 30],
    [114, 29],
    [115, 28.5],
    [116, 28.5],
    [117, 29],
    [117.5, 30],
    [118, 30.8],
  ],
  "b7-west-dense",
);
