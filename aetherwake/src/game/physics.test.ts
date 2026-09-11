import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closestPointOnSolidXZ, queryWall, resolveHorizontal, supportY, type Solid } from "./physics.ts";

const ground = () => 0;

describe("B03 self-support exclusion", () => {
  it("a metal plate does not use its own top as the next ground", () => {
    const plate: Solid = {
      id: "metal-0",
      kind: "box",
      x: 0,
      y: 0.4,
      z: 0,
      w: 1.6,
      h: 0.28,
      d: 2.2,
      standable: true,
    };
    const extra = [{ id: "metal-0", x: 0, y: 0.68, z: 0, r: 1.2 }];
    const withSelf = supportY(0, 0, 0.7, [plate], ground, extra, null);
    assert.ok(withSelf.y >= 0.67);
    const without = supportY(0, 0, 0.7, [plate], ground, extra, "metal-0");
    assert.ok(without.y <= 0.05);
  });

  it("does not creep upward over 60s of self queries", () => {
    let y = 0.5;
    const extra = [{ id: "m", x: 2, y, z: 2, r: 1.2 }];
    for (let i = 0; i < 3600; i++) {
      const s = supportY(2, 2, y, [], ground, extra, "m");
      y = Math.max(s.y + 0.45, y - 0.01);
      extra[0]!.y = y;
    }
    assert.ok(y < 0.6, `rose to ${y}`);
  });
});

describe("B04 jump into a tall cylinder does not snap to the roof", () => {
  const tower: Solid = {
    id: "dawn-shaft",
    kind: "cyl",
    x: 0,
    y: 0,
    z: 0,
    r: 4.2,
    h: 38,
    climbable: true,
    standable: false,
  };
  const cap: Solid = {
    id: "dawn-cap",
    kind: "cyl",
    x: 0,
    y: 37.6,
    z: 0,
    r: 3.2,
    h: 0.4,
    standable: true,
  };

  it("feet near ground do not select the 38m cap", () => {
    const s = supportY(0.5, 0, 1.2, [tower, cap], ground, []);
    assert.ok(s.y < 2, `snapped to ${s.y}`);
  });

  it("horizontal move while rising is blocked by the shaft", () => {
    const moved = resolveHorizontal(0, 0, 4, [tower]);
    assert.ok(Math.hypot(moved.x, moved.z) >= 4.2);
    assert.ok(moved.wall);
  });

  it("standing on the cap is allowed when already near the top", () => {
    const s = supportY(0, 0, 37.9, [tower, cap], ground, []);
    assert.ok(s.y > 37);
  });
});

describe("wall query", () => {
  it("reports a climbable wall ahead of the capsule", () => {
    const wall: Solid = {
      id: "cliff",
      kind: "box",
      x: 0,
      y: 0,
      z: 2,
      w: 6,
      h: 8,
      d: 0.6,
      climbable: true,
      standable: false,
    };
    const hit = queryWall(0, 1.55, 1, [wall]);
    assert.ok(hit);
    assert.equal(hit?.climbable, true);
  });
});

describe("box center / axis / rotated / overlap", () => {
  it("center of a box yields a non-zero escape normal", () => {
    const wall: Solid = { id: "wall", kind: "box", x: 0, y: 0, z: 0, w: 4, d: 4, h: 4 };
    const moved = resolveHorizontal(0, 0, 0, [wall]);
    assert.ok(moved.wall);
    assert.ok(Math.hypot(moved.wall!.nx, moved.wall!.nz) > 0.9, `n=${moved.wall!.nx},${moved.wall!.nz}`);
    assert.ok(Math.hypot(moved.x, moved.z) >= 2.3, `escaped to ${moved.x},${moved.z}`);
  });

  it("axis-aligned inside-face uses the shallow axis", () => {
    const wall: Solid = { id: "wall", kind: "box", x: 0, y: 0, z: 0, w: 4, d: 4, h: 4 };
    const moved = resolveHorizontal(0, 1.2, 0, [wall]);
    assert.ok(Math.abs(moved.z) >= 2.3 || Math.abs(moved.x) >= 2.3);
    assert.ok(moved.wall);
    assert.ok(Math.hypot(moved.wall.nx, moved.wall.nz) > 0.9);
  });

  it("rotated box still ejects with a unit normal", () => {
    const wall: Solid = { id: "rot", kind: "box", x: 0, y: 0, z: 0, w: 4, d: 2, h: 4, yaw: Math.PI / 4 };
    const moved = resolveHorizontal(0, 0, 0, [wall]);
    assert.ok(moved.wall);
    const nlen = Math.hypot(moved.wall.nx, moved.wall.nz);
    assert.ok(Math.abs(nlen - 1) < 1e-6, `nlen=${nlen}`);
    assert.ok(Math.hypot(moved.x, moved.z) > 0.2);
  });

  it("overlapping boxes resolve without NaN", () => {
    const solids: Solid[] = [
      { id: "a", kind: "box", x: 0, y: 0, z: 0, w: 3, d: 3, h: 3 },
      { id: "b", kind: "box", x: 1.2, y: 0, z: 0.4, w: 3, d: 3, h: 3 },
    ];
    const moved = resolveHorizontal(0.6, 0.2, 0.5, solids);
    assert.ok(Number.isFinite(moved.x) && Number.isFinite(moved.z));
    assert.ok(!moved.wall || Math.hypot(moved.wall.nx, moved.wall.nz) > 0.5);
  });

  it("closestPointOnSolidXZ is the edge, not the center", () => {
    const ledge: Solid = {
      id: "dawn-ledge-0",
      kind: "box",
      x: 5.5,
      y: 4,
      z: 0,
      w: 3.45,
      h: 0.42,
      d: 2.45,
      yaw: 0,
      standable: true,
    };
    const c = closestPointOnSolidXZ(ledge, 4.5, 0);
    assert.ok(c.dist < 1.3, `edge dist=${c.dist}`);
    assert.ok(Math.abs(c.x - 5.5) < 1.8);
    const far = closestPointOnSolidXZ(ledge, -5.5, 0);
    assert.ok(far.dist > 8, `opposite-side dist=${far.dist} must not count as reachable`);
  });

  it("standing on a standable box is not pushed sideways", () => {
    const ledge: Solid = {
      id: "dawn-ledge-0",
      kind: "box",
      x: 0,
      y: 4,
      z: 0,
      w: 2.9,
      h: 0.36,
      d: 1.85,
      standable: true,
    };
    const top = 4.36;
    const moved = resolveHorizontal(0, 0, top, [ledge]);
    assert.ok(Math.hypot(moved.x, moved.z) < 0.05, `ejected to ${moved.x},${moved.z}`);
    assert.equal(moved.wall, null);
  });
});
