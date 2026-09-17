/**
 * R35 QA documentation accuracy: pit vs plate gap formulas (not physics).
 * Entry gap = max(0, (plate.z - r) - pit.z0)
 * Far gap   = max(0, pit.z1 - (plate.z + r))
 * Centered plate r=1.15 in pit[10,16.5] → both gaps 2.1.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function plateGaps(plateZ: number, r: number, z0: number, z1: number) {
  const entryGap = Math.max(0, plateZ - r - z0);
  const farGap = Math.max(0, z1 - (plateZ + r));
  // Disc covers a lip iff that lip lies within [plateZ-r, plateZ+r].
  const coverEntry = plateZ - r <= z0 && z0 <= plateZ + r;
  const coverFar = plateZ - r <= z1 && z1 <= plateZ + r;
  return { entryGap, farGap, coverEntry, coverFar };
}

describe("R35 pit/plate gap math", () => {
  it("centered r=1.15 in pit[10,16.5] leaves 2.1 on each side", () => {
    const plateZ = 13.25;
    const g = plateGaps(plateZ, 1.15, 10, 16.5);
    assert.ok(Math.abs(g.entryGap - 2.1) < 1e-6, `entryGap=${g.entryGap}`);
    assert.ok(Math.abs(g.farGap - 2.1) < 1e-6, `farGap=${g.farGap}`);
    // Centered disc covers neither lip.
    assert.equal(g.coverEntry, false);
    assert.equal(g.coverFar, false);
    assert.ok(g.entryGap + g.farGap > 0);
  });

  it("plate at south lip covers entry only", () => {
    const g = plateGaps(10.5, 1.15, 10, 16.5);
    assert.equal(g.coverEntry, true);
    assert.equal(g.coverFar, false);
    assert.ok(g.farGap > 0);
  });
});
