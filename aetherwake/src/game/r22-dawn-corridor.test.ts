/**
 * R22 dawn-from-still corridor: waypoints must stay outside s-0 aggro circle
 * and clear of authored camps (enemies also roam — dodge only, keep walking).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAMPS } from "./world.ts";

const S0 = { x: 13, z: -24, aggro: 22 };

/** Production QA waypoints used by dawn-from-shrines.mjs (keep in sync). */
const DAWN_FROM_STILL_WPS = [
  { x: 16, z: -55 },
  { x: 40, z: -35 },
  { x: 35, z: -5 },
  { x: 25, z: 20 },
  { x: 16, z: 50 },
  { x: 10, z: 64 },
];

function minDistToS0(poly: { x: number; z: number }[]) {
  let best = Infinity;
  let bestAt = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[Math.min(i + 1, poly.length - 1)]!;
    const steps = 20;
    for (let t = 0; t <= steps; t++) {
      const x = a.x + (b.x - a.x) * (t / steps);
      const z = a.z + (b.z - a.z) * (t / steps);
      const d = Math.hypot(S0.x - x, S0.z - z);
      if (d < best) {
        best = d;
        bestAt = { x, z };
      }
    }
  }
  return { best, bestAt };
}

function minDistToCamps(poly: { x: number; z: number }[]) {
  let best = Infinity;
  let bestCamp = null;
  for (const c of CAMPS) {
    for (const p of poly) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < best) {
        best = d;
        bestCamp = c.id;
      }
    }
  }
  return { best, bestCamp };
}

describe("R22 dawn corridor avoids s-0 aggro and camps", () => {
  it("every waypoint and polyline sample stays outside 22m of s-0", () => {
    for (const wp of DAWN_FROM_STILL_WPS) {
      const d = Math.hypot(S0.x - wp.x, S0.z - wp.z);
      assert.ok(d > S0.aggro, `wp (${wp.x},${wp.z}) d=${d.toFixed(1)} must be > ${S0.aggro}`);
    }
    const { best, bestAt } = minDistToS0(DAWN_FROM_STILL_WPS);
    assert.ok(best > S0.aggro, `polyline min d=${best.toFixed(1)} at ${JSON.stringify(bestAt)} must be > ${S0.aggro}`);
  });

  it("waypoints stay ≥15m from authored camps", () => {
    const { best, bestCamp } = minDistToCamps(DAWN_FROM_STILL_WPS);
    assert.ok(best >= 15, `min camp d=${best.toFixed(1)} at ${bestCamp} must be ≥ 15`);
  });

  it("old midline waypoint (16,-10) was inside the s-0 circle (documented failure)", () => {
    const d = Math.hypot(S0.x - 16, S0.z - -10);
    assert.ok(d < S0.aggro, `old wp d=${d.toFixed(1)} < ${S0.aggro}`);
  });
});
