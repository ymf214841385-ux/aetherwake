/**
 * R14 steering sequence regressions — shared walker controller.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  camForward,
  decideSteer,
  createWalkerState,
  onWaypointSwitch,
  noteProgress,
  noteSteerStep,
  desiredYawTo,
} from "./walk-steer.ts";

describe("R14 walk-steer convergence", () => {
  it("180° reversal keeps turning until forward·target > 0", () => {
    // Facing +Z (camYaw=π → forward +Z), target is behind at −Z
    let camYaw = Math.PI;
    const pos = { x: 0, z: 0 };
    const target = { x: 0, z: -20 };
    let drives = 0;
    let turns = 0;
    for (let i = 0; i < 80; i++) {
      const d = decideSteer({ ...pos, camYaw }, target);
      if (d.kind === "drive") {
        drives += 1;
        break;
      }
      if (d.kind === "turn") {
        turns += 1;
        // Simulate native look: ArrowLeft increases yaw, ArrowRight decreases
        camYaw += d.key === "ArrowLeft" ? 0.12 : -0.12;
      }
    }
    assert.ok(drives >= 1, "must become drive-ready after turning");
    assert.ok(turns >= 5, "180° needs multiple turn steps");
  });

  it("does not drive while velocity/dot would walk away", () => {
    const d = decideSteer({ x: 0, z: 0, camYaw: 0 }, { x: 0, z: -10 });
    // camYaw=0 forward is −Z, target −Z → should drive
    assert.equal(d.kind, "drive");
    const d2 = decideSteer({ x: 0, z: 0, camYaw: Math.PI }, { x: 0, z: -10 });
    // Facing +Z, target −Z → turn, never drive
    assert.equal(d2.kind, "turn");
  });

  it("waypoint switch resets prevDist and noProgress", () => {
    let s = createWalkerState();
    s = noteProgress(s, 50);
    s = noteProgress(s, 51);
    s = noteProgress(s, 52);
    assert.ok(s.noProgress >= 2);
    s = onWaypointSwitch(s, 1);
    assert.equal(s.noProgress, 0);
    assert.equal(s.prevDist, Infinity);
    assert.equal(s.wpIndex, 1);
  });

  it("steering timeout is explicit after maxTurns", () => {
    let s = createWalkerState();
    let timedOut = false;
    for (let i = 0; i < 50; i++) {
      const r = noteSteerStep(s, false, 40);
      s = r.state;
      timedOut = r.timedOut;
      if (timedOut) break;
    }
    assert.equal(timedOut, true);
    const ok = noteSteerStep(s, true, 40);
    assert.equal(ok.timedOut, false);
    assert.equal(ok.state.steerSteps, 0);
  });

  it("combat return recalculates heading toward target (no stale drive)", () => {
    const pos = { x: 10, z: 10 };
    const target = { x: 0, z: 0 };
    const desired = desiredYawTo(pos, target);
    const fwd = camForward(desired);
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    assert.ok(fwd.x * dx + fwd.z * dz > 0, "desired yaw forward must point at target");
  });

  it("near-180 target never reports drive on first sample", () => {
    const d = decideSteer({ x: 0, z: 0, camYaw: 0 }, { x: 0.01, z: 20 });
    assert.notEqual(d.kind, "drive");
  });
});
