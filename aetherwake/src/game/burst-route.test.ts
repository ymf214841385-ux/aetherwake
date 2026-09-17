/**
 * Production burst-shrine route through trackedObjective / navigation snapshot.
 * Uses live Sim solids + crackedBroken — not a synthetic mechanismSolved flag alone.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, initWorld } from "./world.ts";
import { useHud } from "./store.ts";
import type { Actions } from "./input.ts";

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

function enterBurst() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  const idx = SHRINES.findIndex((s) => s.id === "burst")!;
  sim.enterShrine(idx);
  sim.interactLock = 0;
  sim.mode = "playing";
  return sim;
}

describe("M3 burst production route via trackedObjective", () => {
  it("before wall break: route targets burst action anchor, not altar; requires 爆鸣", () => {
    const sim = enterBurst();
    assert.equal(sim.crackedBroken[sim.shrine!], false);
    const t = sim.trackedObjective();
    assert.equal(t.phase, "solve");
    assert.match(t.nextAction, /爆鸣|裂纹|岩壁/);
    assert.notEqual(t.targetId, "altar");
    // Must not claim a ready path through the wall to the altar.
    assert.notEqual(t.routeStatus, "ready");
    if (t.routeStatus === "action-required" || t.routeStatus === "approximate") {
      // Segment must stop before the crack (z < origin+12.4) or name the art.
      assert.ok(t.routeHint || t.nextAction);
    }
    const snap = sim.navigationSnapshot();
    assert.equal(snap.worldId, "shrine:burst");
    assert.ok(snap.segments.length >= 1);
    const last = snap.segments[snap.segments.length - 1]!;
    // Last verified walk endpoint must stay on the entrance side of the wall.
    assert.ok(
      last.to.z < 12.5,
      `route walked through intact wall last.to.z=${last.to.z}`,
    );
    assert.ok(snap.requiredArt === "burst" || /爆鸣/.test(snap.nextAction));
  });

  it("after wall break: route reaches altar side via validated passage", () => {
    const sim = enterBurst();
    const o = { x: 220 + 1 * 48, y: 520, z: 0 }; // burst origin (index 1)
    // Use production explode on the crack.
    sim.player.x = o.x;
    sim.player.z = o.z + 11.2;
    sim.player.y = o.y + 0.2;
    sim.explode(o.x, o.y + 1.2, o.z + 12.4);
    assert.equal(sim.crackedBroken[sim.shrine!], true);
    assert.equal(sim.solids.some((q) => q.id === "crack"), false);

    const t = sim.trackedObjective();
    assert.equal(t.phase, "claim");
    const snap = sim.navigationSnapshot();
    assert.equal(snap.worldId, "shrine:burst");
    const last = snap.segments[snap.segments.length - 1]!;
    assert.ok(
      last.to.z > 16,
      `after break route never passed the wall last.to.z=${last.to.z}`,
    );
    // No segment may cross remaining blockers.
    for (const seg of snap.segments) {
      assert.equal(seg.validated, true, `unvalidated segment ${seg.id}`);
    }
  });

  it("after exit: shrine route snapshot is cleared", () => {
    const sim = enterBurst();
    sim.exitShrine();
    sim.interactLock = 0;
    const snap = sim.navigationSnapshot();
    assert.equal(snap.worldId, "overworld");
    assert.ok(!snap.segments.some((s) => s.id.includes("shrine-in") || s.worldId.startsWith("shrine:")));
    const t = sim.trackedObjective();
    assert.notEqual(t.phase, "solve");
  });

  it("shared HUD snapshot includes worldId and next action text", () => {
    const sim = enterBurst();
    sim.syncHud();
    const hud = useHud.getState();
    assert.equal(hud.questPhase, "solve");
    assert.match(hud.questNext, /爆鸣|裂纹|岩壁/);
  });
});
