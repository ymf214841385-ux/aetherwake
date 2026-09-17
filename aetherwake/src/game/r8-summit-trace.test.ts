/**
 * Review 08/09 — INVALID fixture documentation (not a production defect).
 * Old r8 used y=tw.y+30.6=41.7 at x13.1,z70: terrain support ~11.8, body not clear.
 * Real headed i23 rest is x13.08,z71.94,y=30.585 on dawn-spiral-4.
 * Production summit from valid rest: see r9-rest-summit.test.ts (passes).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import { TOWERS } from "./world.ts";
import { supportY, queryWall } from "./physics.ts";
import { FOOT_SNAP } from "./params.ts";

describe("R8 invalid fixture is not production summit failure", () => {
  it("old fixture pose has terrain support and is not body-clear", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    const x = 13.1;
    const z = 70;
    const y = tw.y + 30.6; // INVALID: mixed local/world height
    const sup = supportY(x, z, y + FOOT_SNAP, s.solids, s.heightFn, s.extraSupports(), null);
    assert.equal(sup.id, "terrain", `old fixture must not sit on spiral, got ${sup.id}`);
    const wall = queryWall(x, z, y, s.solids);
    assert.ok(wall !== null || sup.y < y - 5, "old fixture is not a valid grounded rest pose");
  });

  it("real i23 pose is body-clear on dawn-spiral-4", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const x = 13.08;
    const z = 71.94;
    const feet = 30.58500038146973;
    const sup = supportY(x, z, feet + FOOT_SNAP, s.solids, s.heightFn, s.extraSupports(), null);
    assert.equal(sup.id, "dawn-spiral-4");
    assert.equal(queryWall(x, z, feet, s.solids), null);
  });
});
