/**
 * R23: pull sidewalk is a real Sim.step walk (not just a validator path).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, shrineWorldOrigin, initWorld, SHRINE_ROOM } from "./world.ts";
import { FIXED_DT } from "./params.ts";
import type { Actions } from "./input.ts";

function emptyActions(): Actions {
  return {
    moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
    attack: false, bow: false, interact: false, art: false, pause: false,
    map: false, bag: false, dodge: false, artSlot: -1, lookX: 0, lookY: 0,
    climb: false, interactTargetId: null, interactWorldId: null, activationId: null,
  };
}

function enterPull() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  const idx = SHRINES.findIndex((s) => s.id === "pull");
  sim.enterShrine(idx);
  sim.interactLock = 0;
  sim.mode = "playing";
  return { sim, o: shrineWorldOrigin(idx) };
}

function walk(sim: Sim, camYaw: number, frames: number) {
  sim.cam.yaw = camYaw;
  sim.player.yaw = camYaw;
  for (let i = 0; i < frames; i++) {
    const a = emptyActions();
    a.moveY = 1;
    sim.step(FIXED_DT, a);
  }
}

describe("R23 pull sidewalk ordinary walk to altar", () => {
  it("+X sidewalk mid, then +Z past pit, then −X to altar approach", () => {
    const { sim, o } = enterPull();
    // Start on the +X sidewalk rim (production QF3 pose).
    sim.player.x = o.x + 7.15;
    sim.player.z = o.z + 10;
    sim.player.y = o.y;
    sim.player.state = "grounded";
    sim.player.grounded = true;
    sim.player.vy = 0;

    // Walk +Z along the sidewalk (yaw=π → forward +Z).
    walk(sim, Math.PI, 120); // +Z past the pit (z0=10, z1=16.5)
    assert.ok(sim.player.z > o.z + 16.5, `must pass the pit on the sidewalk, z=${sim.player.z} o.z=${o.z}`);
    // Ensure we are actually on far-shore floor, not still on the +X rim only.
    assert.ok(sim.player.y > o.y - 0.5, `sidewalk/far-shore feet y=${sim.player.y}`);

    // Then −X toward altar (yaw=π/2 → forward (−1, 0)).
    walk(sim, Math.PI / 2, 120);
    const altar = { x: o.x, z: o.z + SHRINE_ROOM.altarZ };
    const d = Math.hypot(sim.player.x - altar.x, sim.player.z - altar.z);
    assert.ok(d < 4.5, `must reach altar approach d=${d.toFixed(2)} pos=${sim.player.x.toFixed(1)},${sim.player.z.toFixed(1)} y=${sim.player.y.toFixed(2)}`);
    assert.ok(String(sim.player.state) !== "dead", `state=${sim.player.state}`);
    // Did not fall into the pit floor.
    assert.ok(sim.player.y > o.y - 1, `must stay on sidewalk/altar pad, y=${sim.player.y}`);
  });
});
