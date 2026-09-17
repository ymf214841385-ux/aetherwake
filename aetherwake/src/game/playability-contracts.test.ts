import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_WANDERER_ORIENTATION, orientationForAsset } from "./character/orientation.ts";
import type { Actions } from "./input.ts";
import { Sim } from "./sim.ts";

function emptyActions(): Actions {
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
  };
}

describe("A01 asset orientation calibration", () => {
  it("default wanderer.glb has measured-bones provisional calibration", () => {
    const o = orientationForAsset("/assets/character/wanderer.glb");
    assert.equal(o.authoredForward, "+z");
    assert.ok(Math.abs(o.yawCalibration - Math.PI) < 1e-9);
    assert.equal(o.evidence, "measured-bones");
  });

  it("unmeasured assets do not inherit asserted pi", () => {
    const v4 = orientationForAsset("/__terra-preview/wanderer-v4.glb");
    assert.equal(v4.evidence, "unmeasured");
    assert.equal(v4.yawCalibration, 0);
    assert.equal(v4.authoredForward, "unmeasured");
    const unknown = orientationForAsset("/assets/character/other.glb");
    assert.equal(unknown.yawCalibration, 0);
  });

  it("evidence note records measurement basis", () => {
    assert.match(DEFAULT_WANDERER_ORIENTATION.evidenceNote, /hair_tie/);
  });
});

describe("E03 bag/map same-frame isolation", () => {
  it("opening map ends the frame without locomotion side effects", () => {
    const sim = new Sim();
    sim.mode = "playing";
    const x0 = sim.player.x;
    const z0 = sim.player.z;
    const a = emptyActions();
    a.map = true;
    a.moveY = 1;
    a.attack = true;
    sim.step(1 / 60, a);
    assert.equal(sim.mode, "map");
    assert.equal(sim.player.x, x0);
    assert.equal(sim.player.z, z0);
  });

  it("opening bag ends the frame without locomotion side effects", () => {
    const sim = new Sim();
    sim.mode = "playing";
    const x0 = sim.player.x;
    const a = emptyActions();
    a.bag = true;
    a.moveY = 1;
    sim.step(1 / 60, a);
    assert.equal(sim.mode, "inventory");
    assert.equal(sim.player.x, x0);
  });

  it("pause still isolates the frame", () => {
    const sim = new Sim();
    sim.mode = "playing";
    const x0 = sim.player.x;
    const a = emptyActions();
    a.pause = true;
    a.moveY = 1;
    sim.step(1 / 60, a);
    assert.equal(sim.mode, "paused");
    assert.equal(sim.player.x, x0);
  });
});
