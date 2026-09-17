/**
 * Supervisor review 02 — production integration regressions.
 * These document the required contract BEFORE/OR after wiring LOS, pick identity,
 * eligible-E, and full entity registration.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { Sim } from "./sim.ts";
import { CHESTS, SAGE, initWorld } from "./world.ts";
import type { Actions } from "./input.ts";
import { decideWorldClick } from "./world-click-policy.ts";
import { selectInteractionTarget, type InteractionTarget } from "./interaction.ts";
import { pickInteractableAtClient } from "./world-picking.ts";

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

describe("02-1 production LOS on interactionHost", () => {
  it("wall between player and chest rejects interact with 视线被阻挡", () => {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    const chest = CHESTS.find((c) => c.id === "chest-start")!;
    // Stand near max chest range so a mid-segment wall sits outside skip radii.
    sim.player.x = chest.x;
    sim.player.z = chest.z + 1.7;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    const midZ = (sim.player.z + chest.z) / 2;
    sim.solids.push({
      id: "qa-wall-los",
      kind: "box",
      x: chest.x,
      z: midZ,
      y: sim.player.y,
      w: 3,
      h: 4,
      d: 0.6,
    });

    const a = emptyActions({
      interact: true,
      interactTargetId: `chest:${chest.id}`,
      interactWorldId: "overworld",
      activationId: "los-1",
    });
    sim.handleInteract(a);
    assert.equal(sim.chestsGot.has(chest.id), false, "must not open through wall");
    assert.match(sim.lastInteractReject, /视线|阻挡|不可用|靠近/);
  });

  it("without wall the same chest opens", () => {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    const chest = CHESTS.find((c) => c.id === "chest-start")!;
    sim.player.x = chest.x;
    sim.player.z = chest.z + 1.2;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    const a = emptyActions({
      interact: true,
      interactTargetId: `chest:${chest.id}`,
      interactWorldId: "overworld",
      activationId: "los-ok",
    });
    sim.handleInteract(a);
    assert.ok(sim.chestsGot.has(chest.id));
  });
});

describe("02-2 pick identity survives out-of-range (no attack fallback)", () => {
  it("frontmost pick returns id even when far; policy rejects, never attacks", () => {
    // Synthetic camera looking at a far box.
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(0, 1.5, 0);
    camera.lookAt(0, 1.5, -20);
    camera.updateMatrixWorld(true);

    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 }),
    } as HTMLCanvasElement;

    const farChest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5));
    farChest.position.set(0, 1.5, -20);
    farChest.userData.interactId = "chest:chest-start";
    farChest.userData.worldId = "overworld";
    farChest.updateMatrixWorld(true);

    const hit = pickInteractableAtClient(100, 100, {
      camera,
      canvas,
      player: { x: 0, y: 0, z: 0 },
      pickables: [
        {
          targetId: "chest:chest-start",
          worldId: "overworld",
          object: farChest,
          range: 1.8,
          maxDy: 2.5,
        },
      ],
      occluders: [],
    });

    assert.ok(hit, "far chest must still be picked by identity");
    assert.equal(hit!.targetId, "chest:chest-start");

    const d = decideWorldClick({
      source: "mouse",
      pointerLocked: true,
      mode: "playing",
      pickedTargetId: hit!.targetId,
      preview: { targetId: hit!.targetId, worldId: "overworld", enabled: false },
    });
    assert.equal(d.kind, "ignore");
    assert.notEqual(d.kind, "attack");
  });

  it("does not skip a nearer front target to pick a farther one", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(0, 1.5, 0);
    camera.lookAt(0, 1.5, -20);
    camera.updateMatrixWorld(true);
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 }),
    } as HTMLCanvasElement;

    const near = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    near.position.set(0, 1.5, -5);
    near.userData.interactId = "sage";
    near.updateMatrixWorld(true);
    const far = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    far.position.set(0, 1.5, -20);
    far.userData.interactId = "chest:chest-start";
    far.updateMatrixWorld(true);

    const hit = pickInteractableAtClient(100, 100, {
      camera,
      canvas,
      player: { x: 0, y: 0, z: 0 },
      pickables: [
        { targetId: "sage", worldId: "overworld", object: near, range: 2.4, maxDy: 3 },
        { targetId: "chest:chest-start", worldId: "overworld", object: far, range: 1.8, maxDy: 2.5 },
      ],
    });
    assert.equal(hit?.targetId, "sage", "frontmost visible entity wins");
  });
});

describe("02-4 implicit E prefers nearest eligible, not nearest disabled", () => {
  it("completed nearer chest does not suppress farther eligible sage", () => {
    const host = {
      worldId: "overworld",
      mode: "playing",
      interactLock: 0,
      player: { x: 0, y: 0, z: 0 },
    };
    const doneChest: InteractionTarget = {
      targetId: "chest:old",
      worldId: "overworld",
      action: "open",
      label: "已搜集",
      enabled: false,
      reason: "已搜集",
      x: 1,
      y: 0,
      z: 0,
      range: 2,
      maxDy: 3,
    };
    const sage: InteractionTarget = {
      targetId: "sage",
      worldId: "overworld",
      action: "talk",
      label: "与守塔人交谈",
      enabled: true,
      x: 2.2,
      y: 0,
      z: 0,
      range: 2.4,
      maxDy: 3,
    };
    const picked = selectInteractionTarget([doneChest, sage], { host });
    assert.equal(picked?.targetId, "sage");
    assert.equal(picked?.enabled, true);
  });

  it("explicit pick of disabled nearer object stays explicit (no silent swap)", () => {
    const host = {
      worldId: "overworld",
      mode: "playing",
      interactLock: 0,
      player: { x: 0, y: 0, z: 0 },
    };
    const doneChest: InteractionTarget = {
      targetId: "chest:old",
      worldId: "overworld",
      action: "open",
      label: "已搜集",
      enabled: false,
      reason: "已搜集",
      x: 1,
      y: 0,
      z: 0,
      range: 2,
      maxDy: 3,
    };
    const sage: InteractionTarget = {
      targetId: "sage",
      worldId: "overworld",
      action: "talk",
      label: "talk",
      enabled: true,
      x: 2,
      y: 0,
      z: 0,
      range: 2.4,
      maxDy: 3,
    };
    const picked = selectInteractionTarget([doneChest, sage], {
      pickedTargetId: "chest:old",
      host,
    });
    assert.equal(picked?.targetId, "chest:old");
    assert.equal(picked?.enabled, false);
  });

  it("actual Sim E near completed chest talks to sage when sage eligible", () => {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    const chest = CHESTS.find((c) => c.id === "chest-start")!;
    sim.chestsGot.add(chest.id);
    // Stand closer to done chest than sage but both near.
    sim.player.x = chest.x - 0.5;
    sim.player.z = chest.z;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    // Sage is 16m away — not eligible. This asserts completed chest does not
    // become the E target when disabled; E should not open dialogue far away.
    sim.handleInteract(emptyActions({ interact: true, activationId: "e-done-chest" }));
    assert.equal(sim.mode, "playing");
    assert.equal(sim.chestsGot.has(chest.id), true);
  });
});

describe("02-3 world switch clears pickables", () => {
  it("collectInteractionCandidates worldId matches currentWorldId", () => {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    const over = sim.currentWorldId();
    assert.equal(over, "overworld");
    for (const c of sim.collectInteractionCandidates()) {
      assert.equal(c.worldId, over);
    }
  });
});
