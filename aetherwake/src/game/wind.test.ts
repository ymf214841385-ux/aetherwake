import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWindWorld, occluded, sampleWind } from "./wind.ts";

describe("unified wind field", () => {
  it("world wind, local updraft and gust share the same sample", () => {
    const w = createWindWorld();
    w.zones.push({ id: "up", x: 10, z: 10, r: 6, dirX: 0, dirZ: 0, strength: 0, updraft: 8 });
    w.gust = { ox: 10, oy: 2, oz: 10, dx: 1, dy: 0, dz: 0, radius: 8, strength: 12, t: 1, max: 1 };
    const a = sampleWind(w, 10, 2, 10, 0);
    const b = sampleWind(w, 10, 2, 10, 0);
    assert.equal(a.x, b.x);
    assert.equal(a.z, b.z);
    assert.ok(a.updraft > 4);
    assert.ok(a.x > 4);
  });

  it("occlusion helper reports a blocked path", () => {
    const blocked = (x: number) => x > 2 && x < 3;
    assert.equal(occluded({ x: 0, y: 1, z: 0 }, { x: 5, z: 0 }, blocked), true);
    assert.equal(occluded({ x: 0, y: 1, z: 0 }, { x: 1, z: 0 }, blocked), false);
  });
});
