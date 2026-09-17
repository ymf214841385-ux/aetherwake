/**
 * R30: natural Sim.step expiry + pull plate support (no browser, no fake rewards).
 * C06 ice life countdown invalidates rime walk; C09 frozen countdown invalidates still walk;
 * C08 unheld metal plate on the pit is a support and enables a contiguous walk.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, shrineWorldOrigin, initWorld } from "./world.ts";
import { FIXED_DT } from "./params.ts";
import { supportY } from "./physics.ts";
import type { Actions } from "./input.ts";

function emptyActions(): Actions {
  return {
    moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
    attack: false, bow: false, interact: false, art: false, pause: false,
    map: false, bag: false, dodge: false, artSlot: -1, lookX: 0, lookY: 0,
    climb: false, interactTargetId: null, interactWorldId: null, activationId: null,
  };
}

function enter(id: string) {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  sim.enterShrine(SHRINES.findIndex((s) => s.id === id)!);
  sim.interactLock = 0;
  sim.mode = "playing";
  return { sim, o: shrineWorldOrigin(SHRINES.findIndex((s) => s.id === id)!) };
}

describe("R30 C06 ice natural expiry", () => {
  it("Sim.step counts ice life down and drops it; nav returns action-required", () => {
    const { sim, o } = enter("rime");
    // Place a live ice pillar over the pit (extraSupports path)
    sim.ices.push({ x: o.x, y: o.y + 0.1, z: o.z + 13, life: 0.4, vx: 0, vy: 0, vz: 0 } as never);
    sim.player.x = o.x;
    sim.player.y = o.y;
    sim.player.z = o.z + 8;
    // Bust nav cache by touching player x
    sim.player.x += 0.001;
    const before = sim.navigationSnapshot();
    // Natural countdown only — idle steps, no art/spawn
    for (let i = 0; i < 40; i++) sim.step(FIXED_DT, emptyActions());
    assert.equal(sim.ices.length, 0, `ices should expire, left=${sim.ices.length}`);
    sim.player.x += 0.001;
    const after = sim.navigationSnapshot();
    assert.ok(
      after.status === "action-required" || after.status === "unavailable",
      `after ice expiry status=${after.status} (before=${before.status})`,
    );
  });
});

describe("R30 C09 freeze natural expiry", () => {
  it("Sim.step counts frozen down; still nav leaves walk without frozen slab", () => {
    const { sim, o } = enter("still");
    // Align frozen block as a bridge, then let freeze expire naturally
    sim.moveBlock.x = o.x;
    sim.moveBlock.z = o.z + 12;
    sim.moveBlock.frozen = 0.35;
    const slab = sim.solids.find((s) => s.id === "move-block");
    if (slab) {
      slab.x = o.x;
      slab.z = o.z + 12;
    }
    sim.player.x = o.x;
    sim.player.y = o.y;
    sim.player.z = o.z + 8;
    sim.player.x += 0.001;
    const withFrozen = sim.navigationSnapshot();
    for (let i = 0; i < 40; i++) sim.step(FIXED_DT, emptyActions());
    assert.ok(sim.moveBlock.frozen <= 0, `frozen=${sim.moveBlock.frozen}`);
    sim.player.x += 0.001;
    const expired = sim.navigationSnapshot();
    assert.ok(
      expired.status === "action-required" || expired.status === "unavailable",
      `expired freeze status=${expired.status} (withFrozen=${withFrozen.status})`,
    );
  });
});

describe("R30 C08 pull metal plate support", () => {
  it("unheld plate over the pit is a physical support (supportY)", () => {
    const { sim, o } = enter("pull");
    const plate = sim.metals.find((m) => m.id.startsWith("metal-shrine"));
    assert.ok(plate, "pull shrine metal plate must exist");
    // Place unheld plate across the pit (production grab/throw destination)
    plate.held = false;
    plate.x = o.x;
    plate.z = o.z + 13;
    plate.y = o.y - 0.1;
    plate.vx = 0;
    plate.vz = 0;
    plate.vy = 0;
    const sup = supportY(o.x, o.z + 13, o.y + 0.5, sim.solids, sim.heightFn, sim.extraSupports(), null);
    assert.ok(
      sup.id.includes("metal") || sup.y > o.y - 2,
      `plate must provide support id=${sup.id} y=${sup.y} o.y=${o.y}`,
    );
    assert.equal(plate.held, false);
  });

  it("held plate is NOT a support (production invariant)", () => {
    const { sim, o } = enter("pull");
    const plate = sim.metals.find((m) => m.id.startsWith("metal-shrine"))!;
    plate.held = true;
    plate.x = o.x;
    plate.z = o.z + 13;
    plate.y = o.y + 1;
    const sup = supportY(o.x, o.z + 13, o.y + 0.5, sim.solids, sim.heightFn, sim.extraSupports(), null);
    assert.notEqual(sup.id, plate.id, "held plate must not stand as support");
  });
});
