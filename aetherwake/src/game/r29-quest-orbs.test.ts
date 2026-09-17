/**
 * R29: deriveTrackedObjective must not crash on inconsistent orb/shrine sets.
 * Production HUD consumes this every frame.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveTrackedObjective } from "./quest.ts";
import { TOWERS, SHRINES, CITADEL_POI } from "./world.ts";

const base = {
  towersOn: new Set<string>(),
  shrinesOn: new Set<string>(),
  orbs: 0,
  bossDead: false,
  worldKind: "overworld",
  shrine: null,
  px: 16,
  py: 11,
  pz: 102,
  towers: TOWERS,
  shrines: SHRINES,
  citadel: { x: CITADEL_POI.x, z: CITADEL_POI.z },
  sealOpen: false,
  prompt: "",
};

describe("R29 quest inconsistent shrine/orbs", () => {
  it("all shrines claimed but orbs=0 does not throw (falls to seal/boss)", () => {
    const o = deriveTrackedObjective({
      ...base,
      shrinesOn: new Set(SHRINES.map((s) => s.id)),
      orbs: 0,
      towersOn: new Set(TOWERS.map((t) => t.id)),
      sealOpen: false,
    });
    assert.ok(o.objectiveId);
    assert.ok(Number.isFinite(o.x ?? 0) || o.x === undefined);
    // All shrines on → cannot target a missing shrine
    assert.notEqual(o.targetId, "burst");
    assert.ok(["citadel-seal", "citadel-boss", "free-roam"].includes(o.objectiveId), o.objectiveId);
  });

  it("orbs=3 with one shrine missing still targets that shrine", () => {
    const o = deriveTrackedObjective({
      ...base,
      orbs: 3,
      shrinesOn: new Set(["burst", "rime", "pull"]),
      towersOn: new Set(TOWERS.map((t) => t.id)),
      sealOpen: false,
    });
    assert.equal(o.targetId, "still");
  });

  it("consistent four-shrine + three-tower + seal + bossDead is free-roam", () => {
    const o = deriveTrackedObjective({
      ...base,
      orbs: 4,
      shrinesOn: new Set(SHRINES.map((s) => s.id)),
      towersOn: new Set(TOWERS.map((t) => t.id)),
      sealOpen: true,
      bossDead: true,
    });
    assert.equal(o.objectiveId, "free-roam");
  });
});
