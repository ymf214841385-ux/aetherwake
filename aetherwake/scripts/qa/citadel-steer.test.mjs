/**
 * Review13: keep-volume escape waypoints (36458 stuck at 7,-16).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  citadelOffArena,
  citadelReturnWaypoints,
  insideKeepVolume,
  CROWN_TO_CITADEL,
} from "../../scripts/qa/citadel-steer.mjs";

describe("citadel keep-volume classification", () => {
  it("CROWN_TO_CITADEL matches 95073 play-routes fightBoss legs", () => {
    // Must stay aligned with play-routes fightBoss: 36,-90 → 24,-40 → gate.
    assert.deepEqual(
      CROWN_TO_CITADEL.map((w) => [w.x, w.z]),
      [
        [36, -90],
        [24, -40],
        [6, 8],
        [6, -1],
        [6, -5],
      ],
    );
  });

  it("36458 pose is inside-keep, not generic inside", () => {
    const s = { x: 7.0, z: -16.5, y: 10.8 };
    assert.equal(insideKeepVolume(s.x, s.z), true);
    const off = citadelOffArena(s, { y: 11.1 });
    assert.equal(off.off, true);
    assert.equal(off.reason, "inside-keep");
  });

  it("courtyard south of keep north is not keep volume", () => {
    assert.equal(insideKeepVolume(7, -5), false);
    assert.equal(citadelOffArena({ x: 7, z: -5, y: 10.8 }, { y: 11.1 }).reason, "inside");
  });

  it("return waypoints from keep interior use east exit (probe-proven)", () => {
    const s = { x: 7.0, z: -16.5, y: 10.8 };
    const boss = { x: 6, z: -4.8 };
    const wps = citadelReturnWaypoints(s, boss);
    assert.ok(wps.length >= 3);
    assert.equal(wps[0].x, 18);
    assert.equal(wps[0].z, -12);
    assert.ok(wps.some((w) => w.z > 0.5), "must include gate leg");
  });

  it("054532 world-spawn z≈102 is north-of-gate off-arena (was reported inside)", () => {
    const off = citadelOffArena({ x: 16, z: 102, y: 8.5 }, { y: 10.6 });
    assert.equal(off.off, true);
    assert.equal(off.reason, "north-of-gate");
    // courtyard near gate stays inside
    assert.equal(citadelOffArena({ x: 6, z: 2, y: 10.8 }, { y: 10.6 }).off, false);
    assert.equal(citadelOffArena({ x: 6, z: -2, y: 10.8 }, { y: 10.6 }).reason, "inside");
  });
});
