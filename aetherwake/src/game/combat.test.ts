import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttack, losBlocked, meleeHit, startAttack, tickAttack } from "./combat.ts";
import { ATTACK_ACTIVE, ATTACK_WINDUP } from "./params.ts";

describe("B08 melee windows", () => {
  it("does not hit during windup, hits once in the active window", () => {
    const atk = createAttack();
    assert.equal(startAttack(atk, false), true);
    assert.equal(atk.phase, "windup");
    const inFront = meleeHit(0, 0, 0, 0, 0, 0.8, -1.4);
    assert.equal(inFront, true);
    tickAttack(atk, ATTACK_WINDUP + 0.001);
    assert.equal(atk.phase, "active");
    const id = "e1";
    assert.equal(atk.hit.has(id), false);
    atk.hit.add(id);
    tickAttack(atk, ATTACK_ACTIVE * 0.5);
    assert.equal(atk.hit.has(id), true);
    tickAttack(atk, ATTACK_ACTIVE);
    assert.equal(atk.phase, "recover");
  });

  it("rejects behind, over a wall, and extreme height", () => {
    assert.equal(meleeHit(0, 0, 0, 0, 0, 0.8, 1.4), false);
    assert.equal(meleeHit(0, 0, 0, 0, 0, 4, -1), false);
    assert.equal(
      losBlocked(0, 0, 0, -3, (x, z) => z < -1 && z > -2),
      true,
    );
  });

  it("cannot start a new swing until idle", () => {
    const atk = createAttack();
    startAttack(atk, false);
    assert.equal(startAttack(atk, false), false);
  });
});
