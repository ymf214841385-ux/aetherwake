/**
 * R16 world flee vector → stick offset inverse transform tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { worldToStickOffset, wishFromMove, camForward, camRight } from "./walk-steer.ts";

const YAWS = [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.3, -1.2];
const VECS = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
  { x: 0.6, z: 0.8 },
  { x: -0.8, z: 0.6 },
];

function dotNorm(a: { x: number; z: number }, b: { x: number; z: number }) {
  const la = Math.hypot(a.x, a.z) || 1;
  const lb = Math.hypot(b.x, b.z) || 1;
  return (a.x * b.x + a.z * b.z) / (la * lb);
}

describe("R16 worldToStickOffset matches sim wish inverse", () => {
  for (const yaw of YAWS) {
    for (const v of VECS) {
      it(`yaw=${yaw.toFixed(2)} v=(${v.x},${v.z}) wish·v > 0.99`, () => {
        const off = worldToStickOffset(v, yaw, 40);
        const wish = wishFromMove(yaw, off.moveX, off.moveY);
        assert.ok(dotNorm(wish, v) > 0.99, `dot=${dotNorm(wish, v)}`);
      });
    }
  }

  it("basis is orthonormal", () => {
    for (const yaw of YAWS) {
      const f = camForward(yaw);
      const r = camRight(yaw);
      assert.ok(Math.abs(f.x * r.x + f.z * r.z) < 1e-9);
      assert.ok(Math.abs(Math.hypot(f.x, f.z) - 1) < 1e-9);
      assert.ok(Math.abs(Math.hypot(r.x, r.z) - 1) < 1e-9);
    }
  });

  it("zero vector yields zero stick", () => {
    const off = worldToStickOffset({ x: 0, z: 0 }, 1);
    assert.equal(off.dx, 0);
    assert.equal(off.dy, 0);
  });

  it("yaw=π flee +Z world → stick should not point at +Z camera-forward", () => {
    // camYaw=π forward is +Z. Flee world +Z means move +Z = camera forward → stick up (dy negative)
    const off = worldToStickOffset({ x: 0, z: 1 }, Math.PI, 40);
    assert.ok(off.dy < 0, "screen up = camera forward = +Z when yaw=π");
  });
});
