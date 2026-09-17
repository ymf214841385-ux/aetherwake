/**
 * R18 still nav: use real slab top, stay on board, no diagonal off-edge.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, STILL_BLOCK, shrineWorldOrigin, initWorld } from "./world.ts";
import { solidTop } from "./physics.ts";
import { buildStillShrineRoute } from "./shrine-route-dynamic.ts";

function enterStill() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  sim.enterShrine(SHRINES.findIndex((s) => s.id === "still")!);
  sim.interactLock = 0;
  sim.mode = "playing";
  return sim;
}

describe("R18 still slab top and board path", () => {
  it("navigationSnapshot uses move-block solid top not pit floor", () => {
    const sim = enterStill();
    sim.moveBlock.frozen = 4;
    sim.moveBlock.x = shrineWorldOrigin(3).x; // aligned
    const slab = sim.solids.find((s) => s.id === "move-block")!;
    slab.x = sim.moveBlock.x;
    slab.z = sim.moveBlock.z;
    const top = solidTop(slab);
    const pit = sim.heightFn(sim.moveBlock.x, sim.moveBlock.z);
    assert.ok(top - pit > 1, "slab top must be well above pit floor");
    sim.player.x = shrineWorldOrigin(3).x;
    sim.player.z = shrineWorldOrigin(3).z + 8;
    sim.player.y = shrineWorldOrigin(3).y;
    const snap = sim.navigationSnapshot();
    // If walk segments exist, their points should sit near slab top when on board
    const onBoard = snap.segments.filter(
      (s) => s.validated && s.kind === "walk" && Math.abs(s.to.x - sim.moveBlock.x) < 1.6 && Math.abs(s.to.z - sim.moveBlock.z) < 4,
    );
    if (snap.status === "walk" && onBoard.length) {
      assert.ok(Math.abs(onBoard[0]!.to.y - top) < 0.5, `board point y=${onBoard[0]!.to.y} top=${top}`);
    }
  });

  it("aligned frozen block can produce walk or explicit wait — never fake ready off-board", () => {
    const sim = enterStill();
    const o = shrineWorldOrigin(3);
    sim.moveBlock.frozen = 4;
    sim.moveBlock.x = o.x;
    sim.moveBlock.z = o.z + STILL_BLOCK.zOff;
    const slab = sim.solids.find((s) => s.id === "move-block")!;
    slab.x = sim.moveBlock.x;
    slab.z = sim.moveBlock.z;
    sim.player.x = o.x;
    sim.player.z = o.z + 8;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    for (const seg of snap.segments) {
      if (!seg.validated || seg.kind !== "walk") continue;
      // Board samples must stay within board X half-width (+small margin)
      const half = STILL_BLOCK.w / 2 + 0.35;
      for (const p of seg.polyline ?? []) {
        if (Math.abs(p.z - sim.moveBlock.z) < STILL_BLOCK.d / 2) {
          assert.ok(
            Math.abs(p.x - sim.moveBlock.x) <= half + 0.05,
            `polyline left board x=${p.x} block=${sim.moveBlock.x} half=${half}`,
          );
        }
      }
    }
  });

  it("offset block far from center is action-required wait, not walk through wall", () => {
    const sim = enterStill();
    const o = shrineWorldOrigin(3);
    sim.moveBlock.frozen = 3;
    sim.moveBlock.x = o.x + STILL_BLOCK.xAmp; // fully offset
    sim.moveBlock.z = o.z + STILL_BLOCK.zOff;
    const slab = sim.solids.find((s) => s.id === "move-block")!;
    slab.x = sim.moveBlock.x;
    slab.z = sim.moveBlock.z;
    sim.player.x = o.x;
    sim.player.z = o.z + 8;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    assert.notEqual(snap.status, "walk");
  });
});
