import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideWorldClick } from "./world-click-policy.ts";
import { ActivationLedger } from "./interaction.ts";

describe("R1 production world-click policy", () => {
  it("picked chest is not hijacked by nearby NPC proximity", () => {
    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: true,
      mode: "playing",
      pickedTargetId: "chest:chest-start",
      preview: { targetId: "chest:chest-start", worldId: "overworld", enabled: true },
    });
    assert.equal(d.kind, "interact");
    if (d.kind === "interact") assert.equal(d.targetId, "chest:chest-start");
  });

  it("click away from NPC does not redirect to sage", () => {
    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: false,
      mode: "playing",
      pickedTargetId: null,
      // Nearest proximity is sage, but empty click without a pick must NOT talk to NPC.
      preview: { targetId: "sage", worldId: "overworld", enabled: true },
    });
    assert.equal(d.kind, "pointer-lock");
  });

  it("E-style proximity interact still works when allowed", () => {
    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: true,
      mode: "playing",
      pickedTargetId: null,
      preview: { targetId: "sage", worldId: "overworld", enabled: true },
      allowProximity: true,
    });
    assert.equal(d.kind, "interact");
    if (d.kind === "interact") assert.equal(d.targetId, "sage");
  });

  it("out-of-range explicit pick does not attack", () => {
    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: true,
      mode: "playing",
      pickedTargetId: "chest:chest-start",
      preview: { targetId: "chest:chest-start", worldId: "overworld", enabled: false },
    });
    assert.equal(d.kind, "ignore");
    assert.notEqual(d.kind, "attack");
  });

  it("wrong world explicit pick is rejected without attack", () => {
    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: true,
      mode: "playing",
      pickedTargetId: "tower:dawn",
      preview: { targetId: "tower:dawn", worldId: "shrine:rime", enabled: false },
    });
    assert.equal(d.kind, "ignore");
  });

  it("empty touch short-tap never attacks", () => {
    const d = decideWorldClick({
      source: "touch-tap",
      pointerLocked: false,
      mode: "playing",
      pickedTargetId: null,
      preview: null,
    });
    assert.equal(d.kind, "ignore");
    assert.equal(d.reason, "empty-touch-tap");
  });

  it("empty unlocked mouse click only requests pointer lock", () => {
    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: false,
      mode: "playing",
      pickedTargetId: null,
      preview: null,
    });
    assert.equal(d.kind, "pointer-lock");
  });

  it("locked empty mouse click attacks", () => {
    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: true,
      mode: "playing",
      pickedTargetId: null,
      preview: null,
    });
    assert.equal(d.kind, "attack");
  });

  it("paused mode ignores world clicks", () => {
    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: true,
      mode: "map",
      pickedTargetId: "sage",
      preview: { targetId: "sage", worldId: "overworld", enabled: true },
    });
    assert.equal(d.kind, "ignore");
  });

  it("activation ledger rejects duplicate activation ids", () => {
    const led = new ActivationLedger();
    assert.equal(led.mark("a1"), true);
    assert.equal(led.mark("a1"), false);
    assert.equal(led.mark("a2"), true);
  });
});
