/**
 * R31 CODE-layer (not headed): support lifetime and pull plate identity.
 * C09: aligned frozen slab yields walk, natural Sim.step expiry removes it.
 * C06: ice supports appear/disappear with life; do not invent walk from ice alone.
 * C08: exact plate id is the support; held or removed plate loses that id.
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
  const idx = SHRINES.findIndex((s) => s.id === id)!;
  sim.enterShrine(idx);
  sim.interactLock = 0;
  sim.mode = "playing";
  return { sim, o: shrineWorldOrigin(idx) };
}

describe("CODE C09 still freeze: walk then natural expiry", () => {
  it("aligned frozen slab → walk with validated segments; Sim.step expiry → not walk", () => {
    const { sim, o } = enter("still");
    sim.moveBlock.frozen = 1.2;
    sim.moveBlock.x = o.x;
    sim.moveBlock.z = o.z + 13;
    const slab = sim.solids.find((s) => s.id === "move-block");
    assert.ok(slab, "move-block solid required");
    slab.x = o.x;
    slab.z = o.z + 13;
    sim.player.x = o.x;
    sim.player.y = o.y;
    sim.player.z = o.z + 8;

    const before = sim.navigationSnapshot();
    assert.equal(before.status, "walk", `aligned frozen must walk, got ${before.status} ${before.reason}`);
    assert.ok(before.segments.some((s) => s.validated), "need validated walk segments on the slab");
    assert.ok(before.segments.some((s) => s.polyline && s.polyline.length >= 2), "need support-following polyline");

    // Natural countdown only. navCacheKey includes frozen — no player nudge.
    for (let i = 0; i < 200 && sim.moveBlock.frozen > 0; i++) {
      sim.step(FIXED_DT, emptyActions());
    }
    assert.ok(sim.moveBlock.frozen <= 0, `frozen=${sim.moveBlock.frozen}`);

    const after = sim.navigationSnapshot();
    assert.notEqual(after.status, "walk", `expiry must not keep walk, got ${after.status}`);
    assert.equal(after.status, "action-required", `expected replan, got ${after.status} ${after.reason}`);
  });
});

describe("CODE C06 rime ice lifetime (no fake walk)", () => {
  it("live ice is in extraSupports; expiry removes it; nav never walk from ice-only chain", () => {
    const { sim, o } = enter("rime");
    sim.ices.push({ x: o.x, y: o.y - 1, z: o.z + 12, life: 0.5, vx: 0, vy: 0, vz: 0 } as never);
    sim.ices.push({ x: o.x, y: o.y - 1, z: o.z + 16, life: 0.5, vx: 0, vy: 0, vz: 0 } as never);
    sim.player.x = o.x;
    sim.player.y = o.y;
    sim.player.z = o.z + 8;

    const extrasBefore = sim.extraSupports();
    assert.ok(extrasBefore.some((e) => e.id.startsWith("ice-")), `live ice must be a support ${JSON.stringify(extrasBefore)}`);

    const before = sim.navigationSnapshot();
    // Ice tops are not a production-walkable bridge in this geometry — do not claim walk.
    assert.notEqual(before.status, "walk", `ice-only must not fake walk: ${before.status}`);

    for (let i = 0; i < 60 && sim.ices.length > 0; i++) {
      sim.step(FIXED_DT, emptyActions());
    }
    assert.equal(sim.ices.length, 0, "ice life must expire");
    const extrasAfter = sim.extraSupports();
    assert.ok(!extrasAfter.some((e) => e.id.startsWith("ice-")), "expired ice leaves extraSupports");

    const after = sim.navigationSnapshot();
    assert.notEqual(after.status, "walk");
    assert.equal(after.requiredArt, "rime");
  });
});

describe("CODE C08 pull plate exact support id", () => {
  it("unheld plate id is the support at expected height; held/removed loses that id", () => {
    const { sim, o } = enter("pull");
    const plate = sim.metals.find((m) => m.id.startsWith("metal-shrine"));
    assert.ok(plate, "shrine metal plate required");
    const plateId = plate.id;
    plate.held = false;
    plate.x = o.x;
    plate.z = o.z + 13;
    plate.y = o.y - 0.05;
    plate.vx = 0;
    plate.vy = 0;
    plate.vz = 0;

    const extras = sim.extraSupports();
    const extra = extras.find((e) => e.id === plateId);
    assert.ok(extra, `extraSupports must list ${plateId}, got ${extras.map((e) => e.id).join(",")}`);
    // Production: metal support y = plate.y + 0.28
    assert.ok(Math.abs(extra.y - (plate.y + 0.28)) < 1e-6, `support y=${extra.y} expected ${plate.y + 0.28}`);

    const sup = supportY(o.x, o.z + 13, o.y + 0.5, sim.solids, sim.heightFn, sim.extraSupports(), null);
    assert.equal(sup.id, plateId, `supportY must report exact plate id, got ${sup.id}`);
    assert.ok(Math.abs(sup.y - extra.y) < 0.05, `support height ${sup.y} vs extra ${extra.y}`);

    plate.held = true;
    const heldExtras = sim.extraSupports();
    assert.ok(!heldExtras.some((e) => e.id === plateId), "held plate leaves extraSupports");
    const heldSup = supportY(o.x, o.z + 13, o.y + 0.5, sim.solids, sim.heightFn, sim.extraSupports(), null);
    assert.notEqual(heldSup.id, plateId, `held plate must not be support, got ${heldSup.id}`);
  });
});
