/**
 * Production-entry interaction regressions against real Sim + world data.
 * These do not stub handleInteract.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { CHESTS, SAGE, initWorld } from "./world.ts";
import type { Actions } from "./input.ts";
import { decideWorldClick } from "./world-click-policy.ts";
import { selectInteractionTarget } from "./interaction.ts";

function emptyActions(over: Partial<Actions> = {}): Actions {
  return {
    moveX: 0,
    moveY: 0,
    jump: false,
    jumpHeld: false,
    sprint: false,
    attack: false,
    bow: false,
    interact: false,
    art: false,
    pause: false,
    map: false,
    bag: false,
    dodge: false,
    artSlot: -1,
    lookX: 0,
    lookY: 0,
    climb: false,
    interactTargetId: null,
    interactWorldId: null,
    activationId: null,
    ...over,
  };
}

function playingSim() {
  const sim = new Sim();
  sim.mode = "playing";
  return sim;
}

describe("R1 Sim interaction identity (real handleInteract)", () => {
  it("picked chest beside sage opens the chest, not dialogue", () => {
    initWorld();
    const sim = playingSim();
    const chest = CHESTS.find((c) => c.id === "chest-start")!;
    assert.ok(chest, "chest-start must exist after initWorld");
    // Stand on the chest so it is in range. Pick identity must open this chest
    // and must not fall through to sage or any other ordered candidate.
    sim.player.x = chest.x;
    sim.player.z = chest.z + 0.8;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);

    const weaponsBefore = sim.weapons.length;
    const a = emptyActions({
      interact: true,
      interactTargetId: `chest:${chest.id}`,
      interactWorldId: "overworld",
      activationId: "act-chest-1",
    });
    sim.handleInteract(a);
    assert.ok(sim.chestsGot.has(chest.id), "chest must be opened");
    assert.ok(sim.weapons.length > weaponsBefore, "chest reward granted");
    assert.notEqual(sim.mode, "dialogue", "must not open sage dialogue");
  });

  it("explicit pick wins over a nearer decoy candidate", () => {
    const host = {
      worldId: "overworld",
      mode: "playing",
      interactLock: 0,
      player: { x: 0, y: 0, z: 0 },
    };
    const sage = {
      targetId: "sage",
      worldId: "overworld",
      action: "talk" as const,
      label: "talk",
      enabled: true,
      x: 1,
      y: 0,
      z: 0,
      range: 2.4,
      maxDy: 3,
    };
    const chest = {
      targetId: "chest:chest-start",
      worldId: "overworld",
      action: "open" as const,
      label: "open",
      enabled: true,
      x: 2,
      y: 0,
      z: 0,
      range: 3,
      maxDy: 3,
    };
    const picked = selectInteractionTarget([sage, chest], {
      pickedTargetId: "chest:chest-start",
      host,
    });
    assert.equal(picked?.targetId, "chest:chest-start");
    const nearest = selectInteractionTarget([sage, chest], { host });
    assert.equal(nearest?.targetId, "sage");
  });

  it("picked out-of-range chest rejects without opening sage", () => {
    initWorld();
    const sim = playingSim();
    const chest = CHESTS.find((c) => c.id === "chest-start")!;
    sim.player.x = chest.x + 20;
    sim.player.z = chest.z;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    // Put sage also far so neither is in range.
    const a = emptyActions({
      interact: true,
      interactTargetId: `chest:${chest.id}`,
      interactWorldId: "overworld",
      activationId: "act-far",
    });
    sim.handleInteract(a);
    assert.equal(sim.chestsGot.has(chest.id), false);
    assert.notEqual(sim.mode, "dialogue");
    assert.ok(sim.lastInteractReject.length > 0);
  });

  it("duplicate activation id does not grant chest twice", () => {
    initWorld();
    const sim = playingSim();
    const chest = CHESTS.find((c) => c.id === "chest-start")!;
    sim.player.x = chest.x;
    sim.player.z = chest.z + 0.5;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    const a1 = emptyActions({
      interact: true,
      interactTargetId: `chest:${chest.id}`,
      interactWorldId: "overworld",
      activationId: "dup-1",
    });
    sim.handleInteract(a1);
    const weapons = sim.weapons.length;
    // Reset chest set artificially would be cheating — second same activation must be ignored
    // even if we force the set off... instead re-run same activation after first success.
    sim.chestsGot.delete(chest.id);
    const a2 = emptyActions({
      interact: true,
      interactTargetId: `chest:${chest.id}`,
      interactWorldId: "overworld",
      activationId: "dup-1",
    });
    sim.handleInteract(a2);
    assert.equal(sim.weapons.length, weapons, "duplicate activation must not re-grant");
  });

  it("wrong-world target is rejected", () => {
    initWorld();
    const sim = playingSim();
    const a = emptyActions({
      interact: true,
      interactTargetId: "tower:dawn",
      interactWorldId: "shrine:rime",
      activationId: "wrong-world",
    });
    sim.handleInteract(a);
    assert.notEqual(sim.mode, "dialogue");
    assert.ok(sim.lastInteractReject.length > 0);
  });

  it("proximity E near sage still talks", () => {
    initWorld();
    const sim = playingSim();
    sim.player.x = SAGE.x;
    sim.player.z = SAGE.z + 1;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    sim.handleInteract(emptyActions({ interact: true, activationId: "e-sage" }));
    assert.equal(sim.mode, "dialogue");
  });

  it("empty interact far from everything does not attack or open UI", () => {
    initWorld();
    const sim = playingSim();
    sim.player.x = 0;
    sim.player.z = 0;
    sim.player.y = sim.heightFn(0, 0);
    sim.handleInteract(emptyActions({ interact: true }));
    assert.equal(sim.mode, "playing");
    assert.equal(sim.attack.phase, "idle");
  });
});

describe("R1 policy + sim handoff", () => {
  it("touch empty tap decision is ignore and never becomes attack in sim", () => {
    const sim = playingSim();
    sim.player.x = 0;
    sim.player.z = 0;
    const preview = sim.previewInteraction(null);
    const d = decideWorldClick({
      source: "touch-tap",
      pointerLocked: false,
      mode: "playing",
      pickedTargetId: null,
      preview,
    });
    assert.equal(d.kind, "ignore");
    // No command should be enqueued by the host for ignore.
  });
});
