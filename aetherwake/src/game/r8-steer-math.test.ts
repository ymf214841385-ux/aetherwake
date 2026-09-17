/**
 * R8: wish direction math used by short-loop steering.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function desiredYaw(px: number, pz: number, tx: number, tz: number) {
  return Math.atan2(-(tx - px), -(tz - pz));
}
function wish(camYaw: number) {
  return { x: -Math.sin(camYaw), z: -Math.cos(camYaw) };
}
function angDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

describe("R8 steering direction math", () => {
  it("approach dawn from +Z (z=73→68) yields yaw near 0, not PI", () => {
    const y = desiredYaw(11.4, 73.8, 10, 68);
    assert.ok(Math.abs(y) < 0.5, `desired yaw=${y} should face -Z/tower, not +Z`);
    const w = wish(y);
    const dx = 10 - 11.4;
    const dz = 68 - 73.8;
    assert.ok(w.x * dx + w.z * dz > 0, "wish must point toward tower");
  });

  it("yaw=PI wish points +Z away from tower at z=68", () => {
    const w = wish(Math.PI);
    const dx = 10 - 11.4;
    const dz = 68 - 73.8;
    assert.ok(w.x * dx + w.z * dz < 0, "PI must be wrong for +Z approach");
  });

  it("shortest angDiff is signed correctly", () => {
    assert.ok(angDiff(0.2, -0.1) > 0);
    assert.ok(angDiff(-0.1, 0.2) < 0);
  });
});
