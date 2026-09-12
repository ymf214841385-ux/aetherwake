/**
 * Review16: boss fight decision — fail first on the 41902 sample.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bossFightDecision, canAcceptDodge, citadelFightStep } from "./boss-fight-policy.mjs";

// Eligibility fixtures explicitly assume stamina 108 where old captures omitted it.
// These controlled values are not historical measurements. Attack band 1.85–3.2 m
// follows the independently exercised production Boss melee boundary (E30).

describe("bossFightDecision (41902 failing sample)", () => {
  it("legacy low-hp gate would back-off the 41902 sample (baseline)", () => {
    const s = { hp: 0.25, dist: 2.2, bossPhase: "recover", bossHp: 20 };
    const telegraph = s.bossPhase === "windup" || s.bossPhase === "strike";
    const bossCritical = s.bossHp < 4;
    const legacyBackOff = s.hp < 0.85 && !(bossCritical && !telegraph && s.dist <= 2.6);
    assert.equal(legacyBackOff, true, "legacy gate must show why 0 swings happened");
    const r = bossFightDecision({
      ...s,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.95,
    });
    assert.equal(r.action, "swing");
  });

  it("telegraph with dodgeCd not ready far from boss holds, does not swing", () => {
    const r = bossFightDecision({
      hp: 1.0,
      dist: 5.5,
      bossPhase: "windup",
      bossHp: 20,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0.35,
      attackPhase: "idle",
      faceDot: 0.95,
    });
    assert.equal(r.action, "hold-attack", JSON.stringify(r));
  });

  it("telegraph with dodgeCd not ready inside boss threat retreats", () => {
    // Latest boss-resume: hp=1.00 dist=3.36 windup cd=0.05 then died
    const r = bossFightDecision({
      hp: 1.0,
      dist: 3.36,
      bossPhase: "windup",
      bossHp: 20,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0.05,
      attackPhase: "idle",
      faceDot: 0.95,
    });
    assert.equal(r.action, "back-off", JSON.stringify(r));
  });

  it("keeps retreating outside the 3.8m strike edge until residual motion has margin", () => {
    // E31 actual Sim/controller trajectory: at 3.93m the old 3.55m gate
    // released movement; collision/inertia brought it to 3.78m at strike.
    const s = { hp: 1, bossHp: 14.6, bossPhase: "windup", state: "grounded",
      stamina: 95.6, dodgeCd: 0.2167, attackPhase: "idle", faceDot: 0.57 };
    for (const dist of [3.55, 3.79, 3.931848321757693, 4.1]) {
      assert.equal(bossFightDecision({ ...s, dist }).action, "back-off", `d=${dist}`);
    }
    assert.equal(bossFightDecision({ ...s, dist: 4.3 }).action, "hold-attack");
    assert.equal(bossFightDecision({ ...s, dist: 3.93, bossPhase: "recover" }).action, "approach");
  });

  it("hp=0.25 dist=2.2 bossHp=20 recover must swing, not back-off", () => {
    const r = bossFightDecision({
      hp: 0.25,
      dist: 2.2,
      bossPhase: "recover",
      bossHp: 20,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.95,
    });
    assert.equal(r.action, "swing", JSON.stringify(r));
  });

  it("same sample with telegraph must dodge", () => {
    const r = bossFightDecision({
      hp: 0.25,
      dist: 2.2,
      bossPhase: "windup",
      bossHp: 20,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.95,
    });
    assert.equal(r.action, "dodge", JSON.stringify(r));
  });

  it("low hp far from boss approaches (bounded back-off, not infinite retreat)", () => {
    const r = bossFightDecision({
      hp: 0.75,
      dist: 12,
      bossPhase: "approach",
      bossHp: 20,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.9,
    });
    assert.equal(r.action, "approach", JSON.stringify(r));
  });

  it("low hp just outside melee approaches to re-enter (Review17 stall d=3.9)", () => {
    // Real sample: hp=0.25 d=3.9 bossHp=16.4 phase=approach — must not back-off forever.
    const r = bossFightDecision({
      hp: 0.25,
      dist: 3.9,
      bossPhase: "approach",
      bossHp: 16.4,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.9,
    });
    assert.equal(r.action, "approach", JSON.stringify(r));
  });

  it("low bossHp in melee still swings (critical finish)", () => {
    const r = bossFightDecision({
      hp: 0.25,
      dist: 2.0,
      bossPhase: "hurt",
      bossHp: 3.2,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.95,
    });
    assert.equal(r.action, "swing", JSON.stringify(r));
  });

  it("hold while own attack recovers", () => {
    const r = bossFightDecision({
      hp: 3,
      dist: 2.1,
      bossPhase: "approach",
      bossHp: 12,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "active",
      faceDot: 0.95,
    });
    assert.equal(r.action, "hold-attack", JSON.stringify(r));
  });

  it("too close backs off into melee band", () => {
    const r = bossFightDecision({
      hp: 3,
      dist: 1.4,
      bossPhase: "approach",
      bossHp: 12,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.95,
    });
    assert.equal(r.action, "back-off-too-close", JSON.stringify(r));
  });
});

/**
 * Review18: continuous trajectory — not a single-point assert.
 * From d=3.9 non-telegraph, several approach moves must enter melee and swing;
 * telegraph mid-run must still dodge.
 */
describe("bossFightDecision continuous trajectory (Review18)", () => {
  function snap(over) {
    return {
      hp: 0.25,
      dist: 3.9,
      bossPhase: "approach",
      bossHp: 20,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.9,
      ...over,
    };
  }

  it("low HP at 2.56 m during Boss hurt swings within the verified melee band", () => {
    // Run 49935: hp=0.75 d=2.56 phase=hurt → dodge pushed away, then died.
    const r = bossFightDecision({
      hp: 0.75,
      dist: 2.56,
      bossPhase: "hurt",
      bossHp: 18.2,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.9,
    });
    assert.equal(r.action, "swing", JSON.stringify(r));
  });

  it("low HP at 2.8 m swings within the verified melee band instead of retreating", () => {
    // Real 054532: d=3.31 recover hp=1.5 then died swings=0.
    // E30 verifies d=2.8 is already in melee; another approach wastes the window.
    const r = bossFightDecision({
      hp: 0.75,
      dist: 2.8,
      bossPhase: "approach",
      bossHp: 20,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.9,
    });
    assert.equal(r.action, "swing", JSON.stringify(r));
  });

  it("small-step trajectory 3.9→melee must swing (Review18 continuous)", () => {
    // Real harness steps ~0.25–0.4 m, not the old 0.9 that skipped the dodge band.
    const actions = [];
    let dist = 3.9;
    let bossHp = 20;
    let hp = 0.25;
    for (let step = 0; step < 16 && bossHp > 0; step++) {
      const phase = step === 4 ? "windup" : step === 5 ? "strike" : step < 4 ? "approach" : "recover";
      const dodgeCd = step === 4 ? 0 : step === 5 ? 0.8 : 0;
      const r = bossFightDecision(
        snap({ dist, hp, bossHp, bossPhase: phase, dodgeCd, attackPhase: "idle", faceDot: 0.9 }),
      );
      actions.push({ step, dist: +dist.toFixed(2), phase, action: r.action, bossHp, hp });
      if (r.action === "approach") {
        dist = Math.max(2.05, dist - 0.32);
      } else if (r.action === "swing") {
        bossHp = Math.max(0, bossHp - 1.8);
        // boss may counter after swing
        if (bossHp > 0 && step % 3 === 2) hp = Math.max(0.2, hp - 0.4);
      } else if (r.action === "dodge") {
        dist = Math.min(4.5, dist + 0.6);
      } else if (r.action === "back-off") {
        dist = Math.min(5.5, dist + 0.35);
      } else if (r.action === "back-off-too-close") {
        dist = Math.min(2.2, dist + 0.3);
      }
      // wait-facing / hold-attack: dist unchanged
    }
    const swings = actions.filter((a) => a.action === "swing");
    assert.ok(swings.length >= 1, `must swing in small-step trajectory: ${JSON.stringify(actions)}`);
    assert.ok(
      swings[0].dist <= 3.2 && swings[0].dist >= 1.85,
      `first swing in melee band: ${JSON.stringify(swings[0])}`,
    );
    const tele = actions.find((a) => a.phase === "windup");
    assert.ok(tele, `telegraph missing: ${JSON.stringify(actions)}`);
    assert.equal(tele.action, "dodge", `telegraph must dodge: ${JSON.stringify(tele)}`);
    // After telegraph window, must re-enter and land at least one more swing or
    // drive bossHp down from the pre-telegraph value.
    const preTeleBossHp = actions.find((a) => a.phase === "windup")?.bossHp;
    const anyLaterSwing = actions.some((a) => a.step > tele.step && a.action === "swing");
    const bossDropped = actions.some((a) => a.bossHp < preTeleBossHp);
    assert.ok(
      anyLaterSwing || bossDropped,
      `must continue pressure after telegraph: ${JSON.stringify(actions)}`,
    );
  });

  it("full-finish trajectory: approach→melee→repeat swings until bossDead", () => {
    const actions = [];
    let dist = 5.2;
    let bossHp = 20;
    let hp = 2;
    let landed = 0;
    for (let step = 0; step < 40 && bossHp > 0; step++) {
      // boss cycles: approach 3, windup 1, strike 1, recover 2
      const cycle = step % 7;
      const phase =
        cycle < 3 ? "approach" : cycle === 3 ? "windup" : cycle === 4 ? "strike" : "recover";
      const dodgeCd = cycle === 4 ? 1.2 : 0;
      const r = bossFightDecision(
        snap({ dist, hp, bossHp, bossPhase: phase, dodgeCd, attackPhase: "idle", faceDot: 0.92 }),
      );
      actions.push({ step, dist: +dist.toFixed(2), phase, action: r.action, bossHp, hp });
      if (r.action === "approach") dist = Math.max(2.1, dist - 0.55);
      else if (r.action === "swing") {
        bossHp = Math.max(0, bossHp - 1.8);
        landed += 1;
        if (cycle === 5 || cycle === 6) hp = Math.max(0.3, hp - 0.35);
      } else if (r.action === "dodge") {
        dist = Math.min(4.2, dist + 0.4);
      } else if (r.action === "back-off") dist = Math.min(5.0, dist + 0.3);
      else if (r.action === "back-off-too-close") dist = Math.min(2.15, dist + 0.25);
    }
    assert.ok(landed >= 5, `need multiple hits to finish: landed=${landed} ${JSON.stringify(actions.slice(-8))}`);
    assert.ok(bossHp <= 0.01, `must drive boss to death: bossHp=${bossHp}`);
    const dodges = actions.filter((a) => a.action === "dodge");
    assert.ok(dodges.length >= 1, `telegraph windows must dodge: ${JSON.stringify(actions)}`);
  });

  it("telegraph airborne holds, does not back-off off the ledge", () => {
    // Run 50116: airborne telegraph back-off → y=3.5 west ledge → dead.
    // cd not ready → hold, do not retreat off the ledge.
    const r = bossFightDecision({
      hp: 0.5,
      dist: 3.25,
      bossPhase: "windup",
      bossHp: 18.2,
      state: "airborne",
      stamina: 108,
      dodgeCd: 0.8,
      attackPhase: "idle",
      faceDot: 0.9,
    });
    assert.equal(r.action, "hold-attack", JSON.stringify(r));
  });

  it("kill4 dec#10: airborne C is illegal; grounded eligibility remains available", () => {
    // Preserve the recorded scalars; stamina108 is an explicit controlled assumption.
    // The old expectation demanded an input production rejects while airborne.
    // This gate test does not prove holding, movement, or survival at the late pose.
    const s = {
      hp: 2.25,
      dist: 2.6,
      bossPhase: "windup",
      bossHp: 18.2,
      state: "airborne",
      stamina: 108,
      dodgeCd: 0,
      attackPhase: "idle",
      faceDot: 0.95,
    };
    assert.equal(canAcceptDodge(s), false);
    const r = bossFightDecision(s);
    assert.notEqual(r.action, "dodge", JSON.stringify(r));
    assert.notEqual(citadelFightStep(s).act, "dodge");
    const grounded = { ...s, state: "grounded" };
    assert.equal(canAcceptDodge(grounded), true);
    assert.equal(bossFightDecision(grounded).action, "dodge");
    assert.equal(citadelFightStep(grounded).act, "dodge");
  });

  it("kill4 dec#20: telegraph inside body must leave, not hold into the hit", () => {
    const r = bossFightDecision({
      hp: 1.0,
      dist: 0.65,
      bossPhase: "windup",
      bossHp: 18.2,
      state: "airborne",
      stamina: 108,
      dodgeCd: 0.43,
      attackPhase: "idle",
      faceDot: 0.5,
    });
    assert.equal(r.action, "back-off-too-close", JSON.stringify(r));
  });

  it("telegraph grounded inside threat still retreats", () => {
    const r = bossFightDecision({
      hp: 1.0,
      dist: 3.2,
      bossPhase: "windup",
      bossHp: 20,
      state: "grounded",
      stamina: 108,
      dodgeCd: 0.3,
      attackPhase: "idle",
      faceDot: 0.95,
    });
    assert.equal(r.action, "back-off", JSON.stringify(r));
  });

  it("3.9 non-telegraph → approach steps → melee swing (not one-shot)", () => {
    // Simulate harness: approach shrinks dist by ~0.9/tick until melee.
    let dist = 3.9;
    const actions = [];
    for (let step = 0; step < 8; step++) {
      const r = bossFightDecision(snap({ dist, bossPhase: "approach" }));
      actions.push({ step, dist: +dist.toFixed(2), action: r.action });
      if (r.action === "approach") {
        dist = Math.max(1.9, dist - 0.9);
        continue;
      }
      break;
    }
    assert.ok(
      actions.some((a) => a.action === "approach"),
      `must approach from 3.9: ${JSON.stringify(actions)}`,
    );
    const last = actions[actions.length - 1];
    assert.ok(
      last.dist <= 3.2 && last.dist >= 1.85,
      `must have closed into melee band: ${JSON.stringify(actions)}`,
    );
    const swing = bossFightDecision(snap({ dist: last.dist, bossPhase: "recover" }));
    assert.equal(swing.action, "swing", JSON.stringify({ actions, swing }));
  });

  it("mid-trajectory telegraph still dodges (does not swing into windup)", () => {
    const actions = [];
    // Scheduled windup still interrupts after entering the wider verified band:
    // 3.9 approach → 3.15 swing → windup at 3.15 → dodge.
    let dist = 3.9;
    for (let step = 0; step < 6; step++) {
      const phase = step === 2 ? "windup" : "approach";
      const r = bossFightDecision(snap({ dist, bossPhase: phase }));
      actions.push({ step, dist: +dist.toFixed(2), phase, action: r.action });
      if (r.action === "approach") dist = Math.max(2.2, dist - 0.75);
      else if (phase === "windup") break;
      else assert.equal(r.action, "swing", JSON.stringify(actions));
    }
    const tele = actions.find((a) => a.phase === "windup");
    assert.ok(tele, `telegraph step missing: ${JSON.stringify(actions)}`);
    assert.equal(tele.action, "dodge", JSON.stringify(actions));
    assert.ok(actions.some((a) => a.step < tele.step && a.action === "swing"),
      `must keep observing after the first swing: ${JSON.stringify(actions)}`);
    assert.ok(
      actions.filter((a) => a.action === "approach").length >= 1,
      `must approach before telegraph: ${JSON.stringify(actions)}`,
    );
  });

  it("low-hp melee recover keeps swinging until boss critical (no infinite back-off)", () => {
    let bossHp = 20;
    const actions = [];
    for (let step = 0; step < 12 && bossHp > 3.5; step++) {
      const r = bossFightDecision(
        snap({ dist: 2.2, bossPhase: "recover", bossHp, attackPhase: "idle" }),
      );
      actions.push({ step, bossHp, action: r.action });
      if (r.action === "swing") bossHp = Math.max(0, bossHp - 1.8);
      else break;
    }
    assert.equal(actions[0].action, "swing", JSON.stringify(actions));
    assert.ok(
      actions.every((a) => a.action === "swing"),
      `must keep swinging in melee recover: ${JSON.stringify(actions)}`,
    );
    assert.ok(bossHp <= 4, `should have driven boss critical: ${bossHp}`);
  });
});
