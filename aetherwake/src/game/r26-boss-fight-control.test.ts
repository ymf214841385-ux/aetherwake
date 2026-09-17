/**
 * R26 boss fight control-layer regressions.
 * These assert decision contracts, not a copy of the implementation loop.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOSS_MELEE_R,
  BOSS_STRIKE_R,
  BOSS_SAFE_R,
  BOSS_HIT_R,
  decideBossFight,
  decideLookToward,
  facingBody,
  isInCourtyard,
} from "./boss-combat.ts";

const P = {
  x: 6,
  z: -3,
  camYaw: 0,
  bodyYaw: 0,
  hp: 3,
  stamina: 100,
  invuln: 0,
  dodgeCd: 0,
  attackPhase: "idle",
};

function boss(over: Partial<Parameters<typeof decideBossFight>[0]["boss"]> & { d: number; phase: string }) {
  return { id: "boss", x: 6, z: -3 + over.d, hp: 20, ...over };
}

describe("R26 look-only vs move", () => {
  it("decideLookToward never returns a move action", () => {
    for (const camYaw of [0, 1, -2, 3]) {
      const r = decideLookToward({ x: 0, z: 0, camYaw }, { x: 10, z: 5 });
      assert.ok(r.kind === "turn" || r.kind === "done");
    }
  });

  it("recover in melee while not facing → look, not drive/attack", () => {
    // Boss behind the player (cam/body yaw 0 faces −Z; boss at +Z)
    const b = { id: "boss", d: 2.0, phase: "recover", x: 6, z: -1, hp: 20 };
    const a = decideBossFight({
      player: { ...P, bodyYaw: 0, camYaw: 0 },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "look", JSON.stringify(a));
  });

  it("recover in melee while facing → attack (not move)", () => {
    // Boss south of player at −Z; bodyYaw=0 faces −Z
    const b = { id: "boss", d: 2.0, phase: "recover", x: 6, z: -5, hp: 20 };
    const a = decideBossFight({
      player: { ...P, x: 6, z: -3, bodyYaw: 0, camYaw: 0 },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "attack", JSON.stringify(a));
  });

  it("attack windup busy → wait, not another attack", () => {
    const b = { id: "boss", d: 2.0, phase: "recover", x: 6, z: -5, hp: 20 };
    const a = decideBossFight({
      player: { ...P, bodyYaw: 0, attackPhase: "windup" },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "wait");
  });
});

describe("R26 boss strike band (3.8) outranks generic DANGER 3.6", () => {
  it("windup at 3.7m is a real threat → dodge", () => {
    const b = { id: "boss", d: 3.7, phase: "windup", x: 6, z: -3 + 3.7, hp: 20 };
    const a = decideBossFight({ player: P, boss: b, inCourtyard: true });
    assert.equal(a.kind, "dodge", JSON.stringify(a));
  });

  it("windup at 3.7m without dodge → courtyard sidestep stays inside (not through gate)", () => {
    const b = { id: "boss", d: 3.7, phase: "windup", x: 6, z: -3 + 3.7, hp: 20 };
    const a = decideBossFight({
      player: { ...P, stamina: 5, dodgeCd: 0.5, z: -3, x: 6 },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "move", JSON.stringify(a));
    assert.match(a.reason, /strike-no-dodge/);
    assert.ok(a.tz > -6.3 && a.tz < -1.5, `sidestep z=${a.tz} must stay in courtyard`);
    assert.ok(a.tx > 2 && a.tx < 10, `sidestep x=${a.tx}`);
  });

  it("invuln already active still prefers dodge only if ready; else spacing", () => {
    const b = { id: "boss", d: 3.7, phase: "strike", x: 6, z: -3 + 3.7, hp: 20 };
    const a = decideBossFight({
      player: { ...P, invuln: 0.2, dodgeCd: 0.9, stamina: 100 },
      boss: b,
      inCourtyard: true,
    });
    // dodge on CD → must leave, not stand
    assert.equal(a.kind, "move");
  });
});

describe("R26 courtyard re-entry never skips threats", () => {
  it("out of courtyard + windup inside strike band → dodge first (not reenter move)", () => {
    const b = { id: "boss", d: 3.5, phase: "windup", x: 6, z: 0.5, hp: 20 };
    const a = decideBossFight({
      player: { ...P, z: 0.5, x: 6 },
      boss: b,
      inCourtyard: false,
    });
    assert.equal(a.kind, "dodge", JSON.stringify(a));
  });

  it("out of courtyard and safe → look then move toward anchor (no attack)", () => {
    const look = decideBossFight({
      player: { ...P, z: 1.5, x: 8, camYaw: 2.5 },
      boss: null,
      inCourtyard: false,
    });
    assert.equal(look.kind, "look");
    const move = decideBossFight({
      player: { ...P, z: 1.5, x: 8, camYaw: Math.atan2(-(6 - 8), -(-3 - 1.5)) },
      boss: null,
      inCourtyard: false,
    });
    assert.equal(move.kind, "move");
  });
});

describe("R26 spacing and facing helpers", () => {
  it("recover outside melee closes toward boss (does not back off)", () => {
    const b = { id: "boss", d: 4.0, phase: "recover", x: 6, z: -3 - 4.0, hp: 20 };
    const a = decideBossFight({
      player: { ...P, x: 6, z: -3, bodyYaw: 0, camYaw: 0 },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "move", JSON.stringify(a));
    assert.match(a.reason, /close-hit/);
  });

  it("recover at 3.0m is inside production boss hit range (3.45) — attack", () => {
    const b = { id: "boss", d: 3.0, phase: "recover", x: 6, z: -3 - 3.0, hp: 20 };
    const a = decideBossFight({
      player: { ...P, x: 6, z: -3, bodyYaw: 0, camYaw: 0 },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "attack", JSON.stringify(a));
    assert.ok(BOSS_HIT_R > 3.4);
  });

  it("recover at 1.9m while cam-facing → attack", () => {
    const b = { id: "boss", d: 1.9, phase: "recover", x: 6, z: -3 - 1.9, hp: 20 };
    const a = decideBossFight({
      player: { ...P, x: 6, z: -3, bodyYaw: 0.2, camYaw: 0 },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "attack", JSON.stringify(a));
  });

  it("boss hurt at 1.9m is also a punish window (not spacing)", () => {
    const b = { id: "boss", d: 1.9, phase: "hurt", x: 6, z: -3 - 1.9, hp: 18 };
    const a = decideBossFight({
      player: { ...P, x: 6, z: -3, camYaw: 0 },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "attack", JSON.stringify(a));
  });

  it("stillReady + unfrozen boss → freeze (legal Digit5+F)", () => {
    const b = { id: "boss", d: 5, phase: "approach", x: 6, z: -8, hp: 20, frozen: 0 };
    const a = decideBossFight({
      player: P,
      boss: b,
      inCourtyard: true,
      stillReady: true,
    });
    assert.equal(a.kind, "freeze", JSON.stringify(a));
  });

  it("already frozen boss does not re-freeze — punish instead", () => {
    const b = { id: "boss", d: 2.5, phase: "windup", x: 6, z: -5.5, hp: 20, frozen: 3.5 };
    const a = decideBossFight({
      player: { ...P, x: 6, z: -3, camYaw: 0 },
      boss: b,
      inCourtyard: true,
      stillReady: true,
    });
    assert.notEqual(a.kind, "freeze", JSON.stringify(a));
  });

  it("frozen windup is not a dodge threat — production skips frozen AI", () => {
    const b = { id: "boss", d: 3.0, phase: "windup", x: 6, z: -6, hp: 20, frozen: 3.0 };
    const a = decideBossFight({
      player: { ...P, x: 6, z: -3, camYaw: 0 },
      boss: b,
      inCourtyard: true,
    });
    assert.notEqual(a.kind, "dodge", JSON.stringify(a));
    assert.equal(a.kind, "attack", JSON.stringify(a));
  });

  it("inside strike-unsafe band but not recover → move out (no attack)", () => {
    const b = { id: "boss", d: 3.0, phase: "approach", x: 6, z: 0, hp: 20 };
    const a = decideBossFight({
      player: { ...P, z: -3, x: 6 },
      boss: b,
      inCourtyard: true,
    });
    assert.equal(a.kind, "move", JSON.stringify(a));
    assert.ok(BOSS_SAFE_R > BOSS_STRIKE_R);
    assert.ok(BOSS_STRIKE_R > BOSS_MELEE_R);
  });

  it("facingBody uses body yaw not mere distance", () => {
    assert.equal(facingBody({ x: 0, z: 0, bodyYaw: 0, camYaw: 0 }, { x: 0, z: -2 }), true);
    assert.equal(facingBody({ x: 0, z: 0, bodyYaw: 0, camYaw: 0 }, { x: 0, z: 2 }), false);
  });

  it("isInCourtyard matches the real gate/keep band", () => {
    assert.equal(isInCourtyard(6, -3), true);
    assert.equal(isInCourtyard(6, 0.9), false);
    assert.equal(isInCourtyard(6, -24), false);
    assert.equal(isInCourtyard(18, -3), false);
  });
});
