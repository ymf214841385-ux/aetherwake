import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveTrackedObjective, type QuestInput } from "./quest.ts";

const towers = [
  { id: "dawn", name: "晨光塔", x: 10, z: 68, y: 0 },
  { id: "mere", name: "镜湖塔", x: -108, z: 8, y: 0 },
  { id: "crown", name: "雪冠塔", x: 48, z: -128, y: 0 },
];
const shrines = [
  { id: "rime", name: "霜息祠", x: -72, z: 36, y: 0, hint: "在水面唤出霜柱" },
  { id: "burst", name: "爆鸣祠", x: 88, z: 20, y: 0 },
  { id: "pull", name: "牵引祠", x: -20, z: -90, y: 0 },
  { id: "still", name: "凝时祠", x: 120, z: -40, y: 0 },
];

function base(over: Partial<QuestInput> = {}): QuestInput {
  return {
    towersOn: new Set(),
    shrinesOn: new Set(),
    orbs: 0,
    bossDead: false,
    worldKind: "overworld",
    shrine: null,
    px: 16,
    py: 28,
    pz: 100,
    towers,
    shrines,
    citadel: { x: 0, z: -160 },
    sealOpen: false,
    prompt: "",
    ...over,
  };
}

describe("C01 quest derivation from real progress", () => {
  it("new save tracks dawn tower approach with distance", () => {
    const t = deriveTrackedObjective(base());
    assert.equal(t.targetId, "dawn");
    assert.equal(t.phase, "approach");
    assert.ok((t.distance ?? 0) > 10);
    assert.match(t.nextAction, /晨光塔|攀爬/);
  });

  it("near dawn tower foot switches to climb, not activate", () => {
    const t = deriveTrackedObjective(base({ px: 10, py: 2, pz: 64 }));
    assert.equal(t.phase, "climb");
  });

  it("high on unfinished tower asks to activate", () => {
    const t = deriveTrackedObjective(base({ px: 10, py: 14, pz: 68 }));
    assert.equal(t.phase, "activate");
  });

  it("does not mark tower complete from position alone", () => {
    const t = deriveTrackedObjective(base({ px: 10, py: 20, pz: 68 }));
    assert.notEqual(t.phase, "done");
    const still = deriveTrackedObjective(base({ towersOn: new Set() }));
    assert.equal(still.targetId, "dawn");
  });

  it("after three towers tracks next shrine", () => {
    const t = deriveTrackedObjective(
      base({
        towersOn: new Set(["dawn", "mere", "crown"]),
        px: -72,
        py: 1,
        pz: 36,
      }),
    );
    assert.match(t.targetId, /rime|burst|pull|still/);
    assert.ok(t.phase === "enter" || t.phase === "approach" || t.phase === "solve");
  });

  it("inside shrine uses puzzle hint rather than overworld tower", () => {
    const t = deriveTrackedObjective(
      base({
        towersOn: new Set(["dawn", "mere", "crown"]),
        shrine: "rime",
        prompt: "",
      }),
    );
    assert.equal(t.phase, "solve");
    assert.match(t.nextAction, /霜柱|机关|提示/);
  });

  it("boss only after seal opens", () => {
    const sealed = deriveTrackedObjective(
      base({
        towersOn: new Set(["dawn", "mere", "crown"]),
        shrinesOn: new Set(["rime", "burst", "pull", "still"]),
        orbs: 4,
        sealOpen: false,
      }),
    );
    assert.match(sealed.title, /封印/);
    const open = deriveTrackedObjective(
      base({
        towersOn: new Set(["dawn", "mere", "crown"]),
        shrinesOn: new Set(["rime", "burst", "pull", "still"]),
        orbs: 4,
        sealOpen: true,
      }),
    );
    assert.equal(open.phase, "approach");
    assert.match(open.title, /空王|残堡/);
  });

  it("free roam after boss death", () => {
    const t = deriveTrackedObjective(
      base({
        towersOn: new Set(["dawn", "mere", "crown"]),
        shrinesOn: new Set(["rime", "burst", "pull", "still"]),
        orbs: 4,
        sealOpen: true,
        bossDead: true,
      }),
    );
    assert.equal(t.phase, "done");
  });
});
