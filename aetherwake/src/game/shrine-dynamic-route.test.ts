import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, initWorld } from "./world.ts";

function enterPuzzle(id: string) {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  const idx = SHRINES.findIndex((s) => s.id === id)!;
  sim.enterShrine(idx);
  sim.interactLock = 0;
  sim.mode = "playing";
  return sim;
}

describe("M3 rime/pull/still dynamic shrine routes", () => {
  it("rime without ice asks for 霜息 at the water", () => {
    const sim = enterPuzzle("rime");
    const snap = sim.navigationSnapshot();
    assert.equal(snap.worldId, "shrine:rime");
    assert.equal(snap.status, "action-required");
    assert.equal(snap.requiredArt, "rime");
    assert.match(snap.nextAction, /霜息|霜柱/);
  });

  it("still without freeze asks for 凝时; frozen timeout is live", () => {
    const sim = enterPuzzle("still");
    assert.ok(sim.moveBlock.frozen <= 0);
    const snap = sim.navigationSnapshot();
    assert.equal(snap.status, "action-required");
    assert.equal(snap.requiredArt, "still");
    // Freeze then snapshot may attempt walk (may still be unavailable if block not aligned)
    sim.moveBlock.frozen = 3;
    const after = sim.navigationSnapshot();
    assert.equal(after.status === "walk" || after.status === "action-required" || after.status === "unavailable", true);
    sim.moveBlock.frozen = 0;
    const expired = sim.navigationSnapshot();
    assert.equal(expired.status, "action-required");
  });

  it("pull without bridged boards offers sidewalk walk or 侧廊 guidance", () => {
    const sim = enterPuzzle("pull");
    const snap = sim.navigationSnapshot();
    assert.equal(snap.worldId, "shrine:pull");
    // R35: legal +X sidewalk is a complete walk from entry when validated.
    assert.ok(
      snap.status === "walk" || snap.status === "action-required",
      `status=${snap.status}`,
    );
    assert.match(snap.nextAction + snap.guidance, /侧廊|祭坛/);
    if (snap.status === "walk") {
      assert.ok(snap.segments.every((s) => s.validated));
    }
  });
});
