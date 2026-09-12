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
  citadelDodgeAim,
} from "../../scripts/qa/citadel-steer.mjs";
import { keysToward } from "./route-navigation.mjs";

it("E31 fourth counterattack retreats through the real gate instead of strafing into its wing", () => {
  // Actual continuous Sim trajectory from the E29 fourth recorded start.
  const p = { x: 7.543178974659702, z: -0.28795523886968216, camYaw: -0.004407346410207 };
  const boss = { x: 7.262951130625215, z: -2.796850591713321 };
  const aim = citadelDodgeAim(p, boss);
  assert.equal(aim.reason, "gate-corridor-away");
  assert.ok(aim.z > 2.7);
  assert.ok(Math.hypot(aim.x - boss.x, aim.z - boss.z) > 5.5);
  assert.deepEqual(keysToward(p, aim.x, aim.z, false), ["KeyS"]);
});

it("gate escape cannot cross either solid wing or widen unrelated navigation", () => {
  // Real gate opening spans x=3.7..8.3; the player's radius is 0.32m.
  for (const x of [3.7, 4, 8, 8.3]) {
    const aim = citadelDodgeAim({ x, z: -1 }, { x, z: -3 });
    assert.notEqual(aim.reason, "gate-corridor-away", `wing edge x=${x}`);
  }
  // Start fits, but the outward endpoint crosses the east wing.
  assert.notEqual(citadelDodgeAim({ x: 7.8, z: -1 }, { x: 6.8, z: -3 }).reason,
    "gate-corridor-away");
});

it("rejects a clear ideal gate target when the actual digital key direction clips a wing", () => {
  // Real Sim one-time boundary fixtures hit each wing on frame three.
  for (const [x, camYaw] of [[7.89, Math.PI / 16], [4.11, 3 * Math.PI / 16]]) {
    const p = { x, z: -1, camYaw }, boss = { x, z: -3.5 };
    assert.notEqual(citadelDodgeAim(p, boss).reason, "gate-corridor-away");
    // A straight digital direction at the same position passes the real gap.
    assert.equal(citadelDodgeAim({ ...p, camYaw: 0 }, boss).reason, "gate-corridor-away");
  }
});

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
