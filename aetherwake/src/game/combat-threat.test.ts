/**
 * R15 multi-enemy threat decision sequence tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideCombatAction, pickPriorityThreat } from "./combat-threat.ts";

describe("R15 combat-threat priority", () => {
  it("multiple windup within 2.2m → dodge preferred when available", () => {
    const enemies = [
      { id: "a", d: 1.7, phase: "windup", x: 1, z: 0 },
      { id: "b", d: 1.8, phase: "windup", x: -1, z: 0 },
      { id: "c", d: 1.9, phase: "recover", x: 0, z: 1 },
    ];
    const d = decideCombatAction(enemies, { hp: 3, stamina: 80, player: { x: 0, z: 0 } });
    assert.equal(d.kind, "dodge");
  });

  it("multiple windup with dodge unavailable → flee non-zero", () => {
    const enemies = [
      { id: "a", d: 1.7, phase: "windup", x: 1, z: 0 },
      { id: "b", d: 1.8, phase: "windup", x: 2, z: 0 },
    ];
    const d = decideCombatAction(enemies, { hp: 3, stamina: 10, player: { x: 0, z: 0 } }, { dodgeAvailable: false });
    assert.equal(d.kind, "flee");
    if (d.kind === "flee") {
      assert.ok(Math.hypot(d.dx, d.dz) > 0.5);
      assert.ok(d.dx < 0, "flee away from enemies at +x");
    }
  });

  it("symmetric surround with no dodge still flees a non-zero direction", () => {
    const enemies = [
      { id: "a", d: 1.5, phase: "windup", x: 1, z: 0 },
      { id: "b", d: 1.5, phase: "windup", x: -1, z: 0 },
    ];
    const d = decideCombatAction(enemies, { hp: 3, stamina: 5, player: { x: 0, z: 0 } }, { dodgeAvailable: false });
    // Cluster vector cancels, but single-threat flee still yields a non-zero dir
    assert.equal(d.kind, "flee");
    if (d.kind === "flee") {
      assert.ok(Math.hypot(d.dx, d.dz) > 0.5, "must not return zero flee");
    }
  });

  it("nearest recover but another windup → dodge windup first", () => {
    const enemies = [
      { id: "near-recover", d: 1.2, phase: "recover", x: 1, z: 0 },
      { id: "far-windup", d: 3.0, phase: "windup", x: -2, z: 0 },
    ];
    const t = pickPriorityThreat(enemies);
    assert.equal(t?.id, "far-windup");
    const d = decideCombatAction(enemies, { hp: 3, stamina: 80, player: { x: 0, z: 0 } });
    assert.equal(d.kind, "dodge");
  });

  it("single windup → dodge not attack", () => {
    const d = decideCombatAction([{ id: "a", d: 2.0, phase: "windup", x: 1, z: 0 }], {
      hp: 3,
      stamina: 80,
      player: { x: 0, z: 0 },
    });
    assert.equal(d.kind, "dodge");
  });

  it("strike with dodge unavailable → flee away", () => {
    const d = decideCombatAction([{ id: "a", d: 2.0, phase: "strike", x: 1, z: 0 }], {
      hp: 3,
      stamina: 10,
      player: { x: 0, z: 0 },
    }, { dodgeAvailable: false });
    assert.equal(d.kind, "flee");
  });

  it("recover in melee + attack available → attack", () => {
    const d = decideCombatAction([{ id: "a", d: 2.0, phase: "recover", x: 1, z: 0 }], {
      hp: 3,
      stamina: 80,
      player: { x: 0, z: 0 },
    }, { attackAvailable: true, canFaceEnemy: true });
    assert.equal(d.kind, "attack");
  });

  it("no threat → continue", () => {
    assert.equal(decideCombatAction([], { hp: 3, stamina: 80 }).kind, "continue");
    assert.equal(
      decideCombatAction([{ id: "a", d: 10, phase: "patrol" }], { hp: 3, stamina: 80 }).kind,
      "continue",
    );
  });

  it("dodgeCd blocks dodge → other path", () => {
    const d = decideCombatAction([{ id: "a", d: 2.0, phase: "windup", x: 1, z: 0 }], {
      hp: 3,
      stamina: 80,
      dodgeCd: 2,
      player: { x: 0, z: 0 },
    });
    assert.equal(d.kind, "flee");
  });
});
