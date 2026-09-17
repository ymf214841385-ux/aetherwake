/**
 * R19 still route cropping — remaining path from current support stage.
 * Known-feasible fixtures must produce NON-EMPTY validated walk.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, STILL_BLOCK, shrineWorldOrigin, initWorld } from "./world.ts";
import { solidTop } from "./physics.ts";

function enterStill() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  sim.enterShrine(SHRINES.findIndex((s) => s.id === "still")!);
  sim.interactLock = 0;
  sim.mode = "playing";
  return sim;
}

function placeAlignedFrozen(sim: Sim) {
  const o = shrineWorldOrigin(3);
  sim.moveBlock.frozen = 4;
  sim.moveBlock.x = o.x;
  sim.moveBlock.z = o.z + STILL_BLOCK.zOff;
  const slab = sim.solids.find((s) => s.id === "move-block")!;
  slab.x = sim.moveBlock.x;
  slab.z = sim.moveBlock.z;
  return { o, slab, top: solidTop(slab) };
}

describe("R19 still remaining-route crop", () => {
  it("player on board z=13: non-empty forward walk, no return to entry z=4.4", () => {
    const sim = enterStill();
    const { o, top } = placeAlignedFrozen(sim);
    sim.player.x = o.x;
    sim.player.z = o.z + 13;
    sim.player.y = top;
    const snap = sim.navigationSnapshot();
    const walks = snap.segments.filter((s) => s.validated && s.kind === "walk");
    assert.ok(walks.length > 0, "on-board must produce non-empty walk segments");
    // First remaining target must be toward back/altar, never entry
    const first = walks[0]!;
    assert.ok(
      first.to.z > o.z + 12,
      `on-board first hop z=${first.to.z} must go forward past board center (entry z=${o.z + 4.4})`,
    );
    assert.ok(first.from.z > o.z + 10, `start should be on/near board, not entry`);
  });

  it("player on far shore z=17.5: direct walk to altar, no board/entry reset", () => {
    const sim = enterStill();
    const { o } = placeAlignedFrozen(sim);
    sim.player.x = o.x;
    sim.player.z = o.z + 17.5;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    const walks = snap.segments.filter((s) => s.validated && s.kind === "walk");
    assert.ok(walks.length > 0, "far shore must produce non-empty walk to altar");
    // Must not walk back into pit (z < 16.5)
    for (const w of walks) {
      assert.ok(w.to.z > o.z + 16 || w.to.z > w.from.z, `far-shore segment must not retreat into pit to.z=${w.to.z}`);
    }
    const last = walks[walks.length - 1]!;
    assert.ok(last.to.z > o.z + 18, `route should reach altar approach, last z=${last.to.z}`);
  });

  it("far shore even when block unfrozen: still walks to altar", () => {
    const sim = enterStill();
    const o = shrineWorldOrigin(3);
    sim.moveBlock.frozen = 0;
    sim.moveBlock.x = o.x + STILL_BLOCK.xAmp;
    sim.moveBlock.z = o.z + STILL_BLOCK.zOff;
    const slab = sim.solids.find((s) => s.id === "move-block")!;
    slab.x = sim.moveBlock.x;
    slab.z = sim.moveBlock.z;
    sim.player.x = o.x;
    sim.player.z = o.z + 17.5;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    assert.notEqual(snap.status, "action-required", "far shore must not wait for freeze");
    assert.ok(!/凝时|石块/.test(snap.guidance || ""), `far shore guidance=${snap.guidance}`);
    const walks = snap.segments.filter((s) => s.validated);
    assert.ok(walks.length > 0, "unfrozen far shore still needs altar approach segments");
  });

  it("aligned frozen from near entry: non-empty walk forward", () => {
    const sim = enterStill();
    const { o, top } = placeAlignedFrozen(sim);
    sim.player.x = o.x;
    sim.player.z = o.z + 8;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    assert.equal(snap.status, "walk");
    const walks = snap.segments.filter((s) => s.validated && s.kind === "walk");
    assert.ok(walks.length >= 1, "near-entry aligned frozen must have non-empty walk");
    // Progress should increase in z
    assert.ok(walks[0]!.to.z > walks[0]!.from.z, "first hop must go forward");
  });

  it("offset frozen from near entry: action-required with align hint, not walk", () => {
    const sim = enterStill();
    const o = shrineWorldOrigin(3);
    sim.moveBlock.frozen = 3;
    sim.moveBlock.x = o.x + STILL_BLOCK.xAmp;
    sim.moveBlock.z = o.z + STILL_BLOCK.zOff;
    const slab = sim.solids.find((s) => s.id === "move-block")!;
    slab.x = sim.moveBlock.x;
    slab.z = sim.moveBlock.z;
    sim.player.x = o.x;
    sim.player.z = o.z + 8;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    assert.equal(snap.status, "action-required");
    assert.match(snap.nextAction, /对齐|等待/);
  });
});
