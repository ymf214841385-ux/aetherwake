/**
 * R23: MAX_RISE calibration must match real Sim.step locomotion —
 * not a validator copy. Ordinary moveY=1 only; no coordinate writes mid-walk.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, initWorld } from "./world.ts";
import { solidTop, supportY } from "./physics.ts";
import { FIXED_DT, FOOT_SNAP, STEP_UP } from "./params.ts";
import type { Actions } from "./input.ts";

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

function overworldBurst() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  return sim;
}

function walkForward(sim: Sim, frames: number, camYaw = 0) {
  sim.cam.yaw = camYaw;
  sim.player.yaw = camYaw;
  const trail: { x: number; y: number; z: number; support?: string }[] = [];
  for (let i = 0; i < frames; i++) {
    const a = emptyActions();
    a.moveY = 1;
    sim.step(FIXED_DT, a);
    trail.push({
      x: +sim.player.x.toFixed(3),
      y: +sim.player.y.toFixed(3),
      z: +sim.player.z.toFixed(3),
    });
  }
  return trail;
}

describe("R23 production Sim.step crosses burst apron rim", () => {
  it("b8 (118,34) → south door: ordinary W steps onto apron top ~10.36", () => {
    const sim = overworldBurst();
    const s = SHRINES.find((x) => x.id === "burst")!;
    const apron = sim.solids.find((q) => q.id === "burst-apron")!;
    const apronTop = solidTop(apron);

    // Start on outer south terrain (the historical first-fail sample feet).
    sim.player.x = 118;
    sim.player.z = 34;
    sim.player.y = sim.heightFn(118, 34);
    sim.player.state = "grounded";
    sim.player.grounded = true;
    sim.player.vy = 0;
    sim.player.vx = 0;
    sim.player.vz = 0;

    const y0 = sim.player.y;
    assert.ok(y0 < apronTop - 0.5, `start must be below apron: y0=${y0} apron=${apronTop}`);

    // Walk -Z (camYaw=0 → forward −Z) toward the door at z=30.8.
    const trail = walkForward(sim, 90, 0);
    const final = trail[trail.length - 1]!;

    assert.ok(
      sim.player.z < 32.5,
      `must advance north onto the apron, z=${sim.player.z} trail0=${JSON.stringify(trail[0])} final=${JSON.stringify(final)}`,
    );
    assert.ok(
      sim.player.y > y0 + 0.5,
      `must step up onto apron, y0=${y0} y=${sim.player.y} (apronTop=${apronTop})`,
    );
    assert.ok(
      Math.abs(sim.player.y - apronTop) < 0.08,
      `feet should sit on apron top, y=${sim.player.y} apronTop=${apronTop}`,
    );
    assert.ok(sim.player.state === "grounded", `state=${sim.player.state}`);
  });

  it("door-side start already on high terrain also reaches apron within a short walk", () => {
    const sim = overworldBurst();
    const apronTop = solidTop(sim.solids.find((q) => q.id === "burst-apron")!);
    sim.player.x = 118;
    sim.player.z = 32.5;
    sim.player.y = sim.heightFn(118, 32.5);
    sim.player.state = "grounded";
    sim.player.grounded = true;
    sim.player.vy = 0;
    walkForward(sim, 40, 0);
    assert.ok(
      Math.abs(sim.player.y - apronTop) < 0.08 || sim.player.y > apronTop - 0.35,
      `near-door walk y=${sim.player.y} apronTop=${apronTop}`,
    );
    assert.ok(sim.player.z < 31.5, `should be at door approach z=${sim.player.z}`);
  });

  it("high standable wall still blocks ordinary W (no walk-through)", () => {
    const sim = overworldBurst();
    // Thin wall ahead of spawn facing -Z... place a custom solid in front.
    sim.solids.push({
      id: "qa-high-wall",
      kind: "box",
      x: 16,
      y: 12,
      z: 98,
      w: 6,
      h: 2.5,
      d: 0.4,
      standable: false,
      climbable: false,
    });
    sim.player.x = 16;
    sim.player.z = 100;
    sim.player.y = sim.heightFn(16, 100);
    sim.player.state = "grounded";
    sim.player.grounded = true;
    const z0 = sim.player.z;
    walkForward(sim, 80, 0);
    // Wall occupies z≈97.8–98.2; blocked stop sits on the south face (~98.5).
    // Passing through would put the player at z < 97.5.
    assert.ok(
      sim.player.z > 98.0,
      `must not pass through the wall, z0=${z0} z=${sim.player.z}`,
    );
  });

  it("rise above production snap (2*FOOT_SNAP) is not stepped onto", () => {
    const sim = overworldBurst();
    // 1.5m cliff pad — above FOOT_SNAP*2=1.24 and queryWall treats h>=1 as wall side.
    sim.solids.push({
      id: "qa-cliff",
      kind: "box",
      x: 16,
      y: 12,
      z: 96,
      w: 8,
      h: 1.5,
      d: 4,
      standable: true,
      climbable: false,
    });
    sim.player.x = 16;
    sim.player.z = 100;
    sim.player.y = sim.heightFn(16, 100);
    sim.player.state = "grounded";
    sim.player.grounded = true;
    walkForward(sim, 80, 0);
    // Either blocked by the side (z stays south of the pad) or not lifted onto the top.
    const onCliffTop = Math.abs(sim.player.y - (12 + 1.5)) < 0.1 && sim.player.z < 97;
    assert.equal(onCliffTop, false, `must not mount 1.5m cliff, y=${sim.player.y} z=${sim.player.z}`);
  });

  it("validator MAX_RISE and production snap agree on the b8→b9 sample rise", () => {
    const sim = overworldBurst();
    const feet = sim.heightFn(118, 34);
    const sup = supportY(118, 33.3, feet + FOOT_SNAP, sim.solids, sim.heightFn, [], null);
    const rise = sup.y - feet;
    assert.equal(sup.id, "burst-apron");
    assert.ok(rise > STEP_UP, `sample rise ${rise.toFixed(3)} exceeds STEP_UP (historical reject)`);
    assert.ok(rise <= FOOT_SNAP * 2 + 1e-6, `sample rise ${rise.toFixed(3)} within production snap`);
  });
});
