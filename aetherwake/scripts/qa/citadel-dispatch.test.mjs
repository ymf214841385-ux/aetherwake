/**
 * Fail-first: 95073 citadel executor fell through dodge into unconditional
 * melee. Snapshots copied from durable-play-routes-95073.log.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bossFightDecision,
  nextCitadelAction,
  citadelFightStep,
  canAcceptDodge,
  BOSS_MELEE_MAX,
} from "./boss-fight-policy.mjs";

describe("citadel dispatch after dodge (95073)", () => {
  it("after dodge to recover d=6.4 must approach, not swing", () => {
    // Log: dodge → 6.5,-0.0 d=5.8 then swing=26 at dist=7.00 recover.
    const decision = bossFightDecision({
      hp: 1.25,
      dist: 6.4,
      bossPhase: "recover",
      bossHp: 12.8,
      state: "grounded",
      dodgeCd: 0.43,
      attackPhase: "idle",
      faceDot: 1,
    });
    assert.equal(decision.action, "approach", JSON.stringify(decision));
    const step = nextCitadelAction(decision, { dist: 7.0, faceDot: 1 });
    assert.equal(step.swing, false);
    assert.equal(step.act, "approach");
  });

  it("dodge action never authorizes a follow-up swing in the same tick", () => {
    const step = nextCitadelAction({ action: "dodge", reason: "telegraph" }, { dist: 2.2, faceDot: 1 });
    assert.equal(step.swing, false);
    assert.equal(step.act, "dodge");
  });

  it("swing only inside melee band with face; else approach/wait-facing", () => {
    assert.equal(nextCitadelAction({ action: "swing" }, { dist: 7.2, faceDot: 1 }).act, "approach");
    assert.equal(nextCitadelAction({ action: "swing" }, { dist: 2.2, faceDot: 0.2 }).act, "wait-facing");
    const ok = nextCitadelAction({ action: "swing", reason: "melee" }, { dist: 2.2, faceDot: 0.95 });
    assert.equal(ok.swing, true);
    assert.equal(ok.act, "swing");
  });

  it("95073 swing=26 pose: recover d=7.00 → approach not swing", () => {
    const s = {
      hp: 1.25,
      dist: 7.0,
      bossPhase: "recover",
      bossHp: 12.8,
      state: "grounded",
      dodgeCd: 0.2,
      attackPhase: "active",
      faceDot: 1,
    };
    const decision = bossFightDecision(s);
    const step = nextCitadelAction(decision, { dist: 7.0, faceDot: 1 });
    assert.ok(BOSS_MELEE_MAX < 7.0);
    assert.notEqual(step.swing, true, JSON.stringify({ decision, step }));
  });

  it("executor citadelFightStep: dodge then recover d=6.4 is approach not swing", () => {
    const tele = citadelFightStep({
      hp: 1.25,
      dist: 2.9,
      bossPhase: "windup",
      bossHp: 12.8,
      state: "grounded",
      dodgeCd: 0,
      stamina: 50,
      attackPhase: "idle",
      faceDot: 1,
    });
    assert.equal(tele.act, "dodge");
    assert.equal(tele.swing, false);
    const after = citadelFightStep({
      hp: 1.25,
      dist: 6.4,
      bossPhase: "recover",
      bossHp: 12.8,
      state: "grounded",
      dodgeCd: 0.43,
      attackPhase: "idle",
      faceDot: 1,
    });
    assert.equal(after.act, "approach");
    assert.equal(after.swing, false, "play-routes executor must not swing after dodge-out");
  });

  it("D3: bossMeleeBlocked forces reposition even in melee band", () => {
    const step = citadelFightStep({
      hp: 3.5,
      dist: 2.05,
      bossPhase: "approach",
      bossHp: 11,
      state: "grounded",
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.95,
      bossMeleeBlocked: true,
      blockerId: "citadel-wall-0-11-e",
    });
    assert.equal(step.act, "reposition");
    assert.equal(step.swing, false);
    assert.match(step.reason, /los-blocked/);
  });

  it("D4: airborne telegraph does not request dodge (sim would reject)", () => {
    assert.equal(
      canAcceptDodge({ state: "airborne", dodgeCd: 0, stamina: 100 }),
      false,
    );
    const step = citadelFightStep({
      hp: 1.25,
      dist: 3.0,
      bossPhase: "windup",
      bossHp: 18.2,
      state: "airborne",
      dodgeCd: 0,
      stamina: 100,
      attackPhase: "idle",
      faceDot: 1,
    });
    assert.notEqual(step.act, "dodge", JSON.stringify(step));
  });

  it("D4: stamina 18 or cd 0.02 does not request dodge", () => {
    assert.equal(canAcceptDodge({ state: "grounded", dodgeCd: 0, stamina: 18 }), false);
    assert.equal(canAcceptDodge({ state: "grounded", dodgeCd: 0.02, stamina: 100 }), false);
    const a = citadelFightStep({
      hp: 1,
      dist: 3.0,
      bossPhase: "windup",
      bossHp: 18,
      state: "grounded",
      dodgeCd: 0,
      stamina: 18,
      attackPhase: "idle",
      faceDot: 1,
    });
    assert.notEqual(a.act, "dodge");
    const b = citadelFightStep({
      hp: 1,
      dist: 3.0,
      bossPhase: "windup",
      bossHp: 18,
      state: "grounded",
      dodgeCd: 0.02,
      stamina: 100,
      attackPhase: "idle",
      faceDot: 1,
    });
    assert.notEqual(b.act, "dodge");
  });

  it("D4: grounded cd0 stamina>18 telegraph still dodges", () => {
    const step = citadelFightStep({
      hp: 1,
      dist: 3.0,
      bossPhase: "windup",
      bossHp: 18,
      state: "grounded",
      dodgeCd: 0,
      stamina: 50,
      attackPhase: "idle",
      faceDot: 1,
    });
    assert.equal(step.act, "dodge");
  });
});
