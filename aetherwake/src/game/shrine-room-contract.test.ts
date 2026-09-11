/**
 * Shared shrine-room metrics must drive both sim solids and Scene meshes.
 * Guards the visual/physics split Codex flagged: Scene drew ±7.15 walks and a
 * 9-wide still pit after sim removed walks and widened the pit to 17.6.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import { SHRINES, shrineHasSidewalk, shrinePitHalfWidth, shrinePitSpanZ } from "./world.ts";

describe("shrine room shared metrics (visual/physics contract)", () => {
  it("still has no sidewalk solid and a full-width pit in heightFn", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const sh = SHRINES.find((t) => t.id === "still")!;
    s.player.x = sh.x;
    s.player.z = sh.z;
    s.player.y = sh.y + 0.2;
    s.step(1 / 60, {
      moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
      attack: false, bow: false, interact: true, art: false, pause: false,
      map: false, bag: false, dodge: false, climb: false, artSlot: -1, lookX: 0, lookY: 0,
    });
    for (let i = 0; i < 70; i++) {
      s.step(1 / 60, {
        moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
        attack: false, bow: false, interact: false, art: false, pause: false,
        map: false, bag: false, dodge: false, climb: false, artSlot: -1, lookX: 0, lookY: 0,
      });
    }
    assert.ok(s.shrine !== null);
    assert.equal(shrineHasSidewalk("still"), false);
    assert.equal(shrineHasSidewalk("rime"), true);
    assert.equal(shrineHasSidewalk("pull"), true);
    assert.equal(shrinePitHalfWidth("still"), 8.8);
    assert.equal(s.solids.some((q) => q.id.startsWith("shrine-sidewalk")), false);
    // Center of pit is down; far rim at |lx|>8.8 is floor (thin, not a walk).
    const originY = 520;
    const pitY = s.heightFn(364 + 0, 13);
    const rimY = s.heightFn(364 + 8.9, 13);
    assert.ok(pitY < originY - 4, `still center pit y=${pitY}`);
    assert.ok(rimY >= originY - 0.01, `still outer rim y=${rimY}`);
  });

  it("burst crack solid is the full interior span (matches BURST_WALL)", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const sh = SHRINES.find((t) => t.id === "burst")!;
    s.player.x = sh.x;
    s.player.z = sh.z;
    s.player.y = sh.y + 0.2;
    s.step(1 / 60, {
      moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
      attack: false, bow: false, interact: true, art: false, pause: false,
      map: false, bag: false, dodge: false, climb: false, artSlot: -1, lookX: 0, lookY: 0,
    });
    for (let i = 0; i < 70; i++) {
      s.step(1 / 60, {
        moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
        attack: false, bow: false, interact: false, art: false, pause: false,
        map: false, bag: false, dodge: false, climb: false, artSlot: -1, lookX: 0, lookY: 0,
      });
    }
    const crack = s.solids.find((q) => q.id === "crack");
    assert.ok(crack, "burst crack solid missing");
    assert.equal(crack!.w, 18.6);
    assert.equal(crack!.d, 0.8);
  });

  it("rime/pull pit half-widths stay as designed (sidewalk remains)", () => {
    assert.equal(shrinePitHalfWidth("rime"), 4.8);
    assert.equal(shrinePitHalfWidth("pull"), 4.6);
    assert.deepEqual(shrinePitSpanZ("still"), { z0: 10, z1: 16.5, depth: 4.4 });
  });
});
