import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceMantle, planMantle, planTerrainMantle } from "./mantle.ts";
import { fittedTopPoint, outsideTopPoint, playerBodyClear, sweepPlayerBody } from "./physics.ts";
import type { Solid } from "./physics.ts";
import { FIXED_DT, MANTLE_REACH_XZ, MANTLE_REACH_Y, PLAYER_RADIUS } from "./params.ts";

// Geometry unit fixtures deliberately use controlled solids/flat terrain;
// original-world Sim/input and three real caps are covered in mantle.test.ts.
const ground = () => 0;
const top: Solid = { id: "top", kind: "box", x: 0, z: 0, y: 0, h: 2,
  w: 3, d: 3, standable: true, climbable: true };
const start = { x: 2, y: 1, z: 0 };

test("outside path uses the positive outward ray exit for rotated boxes and cylinders", () => {
  for (const solid of [
    { ...top, yaw: 0.6 },
    { id: "round", kind: "cyl" as const, x: 0, z: 0, y: 0, h: 2, r: 2, standable: true },
  ]) {
    for (const direction of [-1, 1]) {
      const p = { x: direction * 0.8, y: 0, z: 0 };
      const outside = outsideTopPoint(solid, p, { x: direction, z: 0 })!;
      assert.ok(outside);
      assert.ok((outside.x - p.x) * direction > 0, "never take the back/negative intersection");
      assert.ok(playerBodyClear(outside, [solid], ground));
      assert.equal(outside.y, p.y);
    }
  }
});

test("full-body sweep detects a thin overhang despite clear start/end poses", () => {
  const roof: Solid = { id: "thin", kind: "box", x: 0, z: 0, y: 2.8,
    h: 0.1, w: 3, d: 3, standable: true };
  const from = { x: -3, y: 2, z: 0 }, to = { x: 3, y: 2, z: 0 };
  assert.ok(playerBodyClear(from, [roof], ground));
  assert.ok(playerBodyClear(to, [roof], ground));
  assert.equal(sweepPlayerBody(from, to, [roof], ground), false);
});

test("a low ceiling rejects the whole plan before entering it", () => {
  const roof: Solid = { id: "roof", kind: "box", x: 0, z: 0, y: 3,
    h: 0.1, w: 3, d: 3, standable: true };
  assert.ok(playerBodyClear(start, [top, roof], ground));
  assert.equal(planMantle(start, [top], [top, roof], ground), null);
});

test("narrow top and target outside unchanged vertical/horizontal reach are rejected", () => {
  assert.equal(fittedTopPoint({ ...top, w: PLAYER_RADIUS * 2 }, start), null);
  assert.equal(planMantle(start, [{ ...top, h: start.y + MANTLE_REACH_Y + 0.01 }], [top], ground), null);
  assert.equal(planMantle({ ...start, x: 1.5 + MANTLE_REACH_XZ + 0.01 }, [top], [top], ground), null);
});

test("rotated corner target fits both full-foot extents", () => {
  const box = { ...top, yaw: Math.PI / 4 };
  const target = fittedTopPoint(box, { x: 5, y: 2, z: 0 })!;
  const c = Math.cos(box.yaw), sn = Math.sin(box.yaw);
  const lx = target.x * c + target.z * sn, lz = -target.x * sn + target.z * c;
  assert.ok(Math.abs(lx) + PLAYER_RADIUS < 1.5);
  assert.ok(Math.abs(lz) + PLAYER_RADIUS < 1.5);
  assert.equal(playerBodyClear(target, [box], ground), true);
});

test("too-high terrain is collision, not an automatically reachable standing target", () => {
  const high = () => 8;
  assert.equal(playerBodyClear(start, [], high), false);
  assert.equal(planMantle(start, [top], [top], high), null);
  assert.equal(planMantle(start, [top], [top], (x) => x < 1.7 ? 5 : 0), null);
});

test("removed or shifted target cancels at exactly the last checked pose", () => {
  for (const shifted of [false, true]) {
    const plan = planMantle(start, [top], [top], ground)!;
    assert.ok(plan);
    const first = advanceMantle(plan, start, FIXED_DT, [top], ground);
    assert.equal(first.status, "moving");
    const before = { ...first.position };
    // Deliberate changing-geometry unit input; no Sim/world state is injected.
    const result = advanceMantle(plan, before, FIXED_DT, shifted ? [{ ...top, x: 0.1 }] : [], ground);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.position, before);
  }
});

test("a newly occupied next segment is blocked without an endpoint push", () => {
  const plan = planMantle(start, [top], [top], ground)!;
  assert.ok(plan);
  const obstruction: Solid = { id: "new-overhang", kind: "box", x: 2, z: 0,
    y: 2.85, h: 0.1, w: 0.8, d: 0.8, standable: true };
  assert.ok(playerBodyClear(start, [top, obstruction], ground));
  const result = advanceMantle(plan, start, FIXED_DT, [top, obstruction], ground);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.position, start);
});

const retaining: Solid = { id: "retaining", kind: "box", x: 0, z: 0, y: 0, h: 2,
  w: 4, d: 0.4, standable: false, climbable: true };
const terrainStart = { x: 0, y: 0.6, z: -1 };
const terrace = (_x: number, z: number) => z >= 0.2 ? 2 : 0;

test("a nonstandable retaining wall leads to actual supported terrain without changing the wall", () => {
  const before = { ...retaining };
  const plan = planTerrainMantle(terrainStart, retaining, { x: 0, z: -1 }, [retaining], terrace)!;
  assert.ok(plan?.terrain);
  assert.equal(plan.target.standable, false);
  let p = terrainStart, done = false;
  for (let n = 0; n < 80; n++) {
    const result = advanceMantle(plan, p, FIXED_DT, [retaining], terrace);
    assert.notEqual(result.status, "blocked");
    assert.ok(playerBodyClear(result.position, [retaining], terrace));
    p = result.position;
    if (result.status === "done") { done = true; break; }
  }
  assert.ok(done);
  assert.equal(p.y, terrace(p.x, p.z));
  assert.ok(p.z - PLAYER_RADIUS > 0.2, "the whole foot is beyond the actual far wall edge");
  assert.deepEqual(retaining, before);
});

test("terrain mantle rejects an unsupported foot edge, steep slope, excessive reach, and ceiling", () => {
  const normal = { x: 0, z: -1 };
  assert.equal(planTerrainMantle(terrainStart, retaining, normal, [retaining], (_x, z) => z >= 0.3 ? 2 : 0), null);
  assert.equal(planTerrainMantle(terrainStart, retaining, normal, [retaining], (x, z) => z >= 0.2 ? 2 + x : 0), null);
  assert.equal(planTerrainMantle(terrainStart, retaining, normal, [retaining], (_x, z) => z >= 0.2 ? 4 : 0), null);
  assert.equal(planTerrainMantle({ ...terrainStart, z: -3 }, retaining, normal, [retaining], terrace), null);
  const roof: Solid = { id: "roof", kind: "box", x: 0, z: 0, y: 2.4, h: 0.1, w: 4, d: 4 };
  assert.ok(playerBodyClear(terrainStart, [retaining, roof], terrace));
  assert.equal(planTerrainMantle(terrainStart, retaining, normal, [retaining, roof], terrace), null);
});

test("terrain support is rechecked each fixed step and cannot move beneath an active mantle", () => {
  const plan = planTerrainMantle(terrainStart, retaining, { x: 0, z: -1 }, [retaining], terrace)!;
  assert.ok(plan);
  const first = advanceMantle(plan, terrainStart, FIXED_DT, [retaining], terrace);
  const changed = (_x: number, z: number) => z >= 0.2 ? 2.1 : 0;
  const result = advanceMantle(plan, first.position, FIXED_DT, [retaining], changed);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.position, first.position);
});
