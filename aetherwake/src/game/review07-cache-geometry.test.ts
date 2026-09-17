/**
 * R7 cache: geometry/support signatures, not count-only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, initWorld } from "./world.ts";
import { useHud } from "./store.ts";

function playingSim() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  return sim;
}

describe("R7 nav cache geometry invalidation", () => {
  it("metal height change alone invalidates cache", () => {
    const sim = playingSim();
    sim.enterShrine(SHRINES.findIndex((s) => s.id === "pull")!);
    sim.interactLock = 0;
    sim.mode = "playing";
    const a = sim.navigationSnapshot();
    const m = sim.metals.find((x) => x.id.startsWith("metal-shrine"));
    if (m) m.y += 0.4;
    const b = sim.navigationSnapshot();
    assert.notEqual(a, b, "metal y change must invalidate");
  });

  it("same-count solid move across path invalidates", () => {
    const sim = playingSim();
    const n = sim.solids.length;
    const a = sim.navigationSnapshot();
    const s = sim.solids.find((x) => x.id === "crack") ?? sim.solids[0];
    if (s) {
      s.z += 3;
    }
    assert.equal(sim.solids.length, n);
    const b = sim.navigationSnapshot();
    assert.notEqual(a, b, "moved solid must invalidate");
  });

  it("plank move invalidates", () => {
    const sim = playingSim();
    sim.planks[0]!.x += 5;
    const a = sim.navigationSnapshot();
    sim.planks[0]!.x += 2;
    const b = sim.navigationSnapshot();
    assert.notEqual(a, b);
  });

  it("target complete while another replaces set member at equal size invalidates", () => {
    const sim = playingSim();
    sim.towersOn.add("dawn");
    const a = sim.navigationSnapshot();
    // Equal size: remove dawn, add mere
    sim.towersOn.delete("dawn");
    sim.towersOn.add("mere");
    assert.equal(sim.towersOn.size, 1);
    const b = sim.navigationSnapshot();
    assert.notEqual(a, b, "set membership change at equal size must invalidate");
  });

  it("moveBlock coordinate change invalidates even when frozen flag same", () => {
    const sim = playingSim();
    sim.enterShrine(SHRINES.findIndex((s) => s.id === "still")!);
    sim.interactLock = 0;
    sim.mode = "playing";
    sim.moveBlock.frozen = 0;
    const a = sim.navigationSnapshot();
    sim.moveBlock.x += 1.5;
    const b = sim.navigationSnapshot();
    assert.notEqual(a, b);
  });
});
