/**
 * R27: production still-freeze (Digit5+F) and boss meleeHit range.
 * Ordinary Actions only — no writes to frozen/HP.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { initWorld, TOWERS } from "./world.ts";
import { meleeHit } from "./combat.ts";
import { ATTACK_RANGE, ATTACK_RANGE_HEAVY, ATTACK_ARC, ATTACK_HEIGHT, FIXED_DT } from "./params.ts";
import type { Actions } from "./input.ts";

function emptyActions(): Actions {
  return {
    moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
    attack: false, bow: false, interact: false, art: false, pause: false,
    map: false, bag: false, dodge: false, artSlot: -1, lookX: 0, lookY: 0,
    climb: false, interactTargetId: null, interactWorldId: null, activationId: null,
  };
}

function citadelSim() {
  initWorld();
  const s = new Sim();
  s.mode = "playing";
  // Place player in the courtyard south of the keep
  s.player.x = 6;
  s.player.z = -3;
  s.player.y = s.heightFn(6, -3);
  s.player.state = "grounded";
  s.player.grounded = true;
  return s;
}

describe("R27 production still-freeze on boss", () => {
  it("Digit5 slot + art freezes the nearest living enemy within 16m", () => {
    const s = citadelSim();
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss, "boss must exist");
    assert.ok(boss.alive);
    assert.equal(boss.frozen, 0);
    // Put boss 4m south in the courtyard
    boss.x = 6;
    boss.z = -7;
    const a = emptyActions();
    a.artSlot = 4;
    a.art = true;
    s.step(FIXED_DT, a);
    assert.equal(s.art, 4);
    assert.ok(boss.frozen > 4, `boss.frozen=${boss.frozen} after Digit5+F`);
  });

  it("still art prefers the nearest enemy — not a farther sentinel", () => {
    const s = citadelSim();
    const boss = s.enemies.find((e) => e.kind === "boss")!;
    boss.x = 6;
    boss.z = -5;
    boss.frozen = 0;
    // Push any other enemy far
    for (const e of s.enemies) {
      if (e.id !== boss.id) {
        e.x = 200;
        e.z = 200;
      }
    }
    s.art = 4;
    const a = emptyActions();
    a.art = true;
    s.step(FIXED_DT, a);
    assert.ok(boss.frozen > 4, "nearest must be the boss");
    for (const e of s.enemies) {
      if (e.id !== boss.id && e.alive) {
        assert.equal(e.frozen, 0, `far enemy ${e.id} must not freeze`);
      }
    }
  });

  it("no enemy within 16m does not freeze the boss", () => {
    const s = citadelSim();
    const boss = s.enemies.find((e) => e.kind === "boss")!;
    boss.x = 80;
    boss.z = -80;
    s.art = 4;
    const a = emptyActions();
    a.art = true;
    s.step(FIXED_DT, a);
    assert.equal(boss.frozen, 0);
  });
});

describe("R27 production meleeHit boss range", () => {
  it("boss uses HEAVY base + 0.6 rangeBoost → 3.45m, not ATTACK_RANGE 2.15", () => {
    // Simulate the exact call in sim.handleCombat
    const rangeBoost = 0 + 0.6; // sword + boss
    const expected = ATTACK_RANGE_HEAVY + rangeBoost;
    assert.ok(Math.abs(expected - 3.45) < 1e-9, `expected 3.45 got ${expected}`);
    // In front at 3.0m — must hit
    const hit = meleeHit(6, 10.8, -3, 0, 6, 10.8, -3 - 3.0, rangeBoost);
    assert.equal(hit, true, "3.0m front should hit boss");
    // 3.5m — out of 3.45
    const miss = meleeHit(6, 10.8, -3, 0, 6, 10.8, -3 - 3.5, rangeBoost);
    assert.equal(miss, false, "3.5m should miss");
    // Behind at 2.0m — arc reject
    const behind = meleeHit(6, 10.8, -3, 0, 6, 10.8, -3 + 2.0, rangeBoost);
    assert.equal(behind, false, "behind must miss");
    // Tall dy — height reject
    const high = meleeHit(6, 10.8, -3, 0, 6, 10.8 + 2, -3 - 1, rangeBoost);
    assert.equal(high, false, "height must reject");
    assert.ok(ATTACK_RANGE < ATTACK_RANGE_HEAVY);
    assert.ok(ATTACK_ARC > 0.5);
    assert.ok(ATTACK_HEIGHT > 1);
  });
});
