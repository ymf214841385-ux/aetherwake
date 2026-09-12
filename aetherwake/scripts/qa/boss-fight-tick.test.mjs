/**
 * Review19: harness-level tick — must call the same planFightTick boss-resume
 * uses, with real 054532 failure coordinates as baseline.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planFightTick, applyFightAction } from "./boss-fight-tick.mjs";
import { citadelOffArena } from "./citadel-steer.mjs";
import { canAcceptDodge } from "./boss-fight-policy.mjs";

function snap(over = {}) {
  return {
    mode: "playing",
    x: 6,
    y: 10.8,
    z: -2,
    hp: 1,
    state: "grounded",
    dodgeCd: 0,
    // Controlled eligibility fixture; old recorded cases omitted stamina.
    // This is not a claim about their historical stamina measurement.
    stamina: 108,
    attackPhase: "idle",
    camYaw: 0,
    bossDead: false,
    boss: { x: 6, y: 10.8, z: -4.8, hp: 20, alive: true, phase: "approach" },
    ...over,
    boss: {
      x: 6,
      y: 10.8,
      z: -4.8,
      hp: 20,
      alive: true,
      phase: "approach",
      ...(over.boss || {}),
    },
  };
}

describe("planFightTick preserves readonly dodge eligibility", () => {
  it("forwards a grounded caller's actual stamina so a legal dodge is available", () => {
    const tick = planFightTick(snap({
      state: "grounded", dodgeCd: 0, stamina: 108,
      dist: 2.6, boss: { phase: "windup" },
    }));
    assert.equal(tick.kind, "fight");
    assert.equal(tick.action, "dodge", JSON.stringify(tick));
  });

  it("keeps the strict stamina threshold: exactly 18 cannot dodge", () => {
    const tick = planFightTick(snap({
      state: "grounded", dodgeCd: 0, stamina: 18,
      dist: 2.6, boss: { phase: "windup" },
    }));
    assert.equal(tick.kind, "fight");
    assert.equal(tick.action, "back-off", JSON.stringify(tick));
  });

  it("does not turn an airborne caller with full stamina into a legal dodge", () => {
    const tick = planFightTick(snap({
      state: "airborne", dodgeCd: 0, stamina: 108,
      dist: 2.6, boss: { phase: "windup" },
    }));
    assert.equal(tick.kind, "fight");
    assert.notEqual(tick.action, "dodge", JSON.stringify(tick));
  });

  it("forwards an explicit canDodge false veto even when the basic gate is legal", () => {
    const tick = planFightTick(snap({
      state: "grounded", dodgeCd: 0, stamina: 108, canDodge: false,
      dist: 2.6, boss: { phase: "windup" },
    }));
    assert.equal(tick.kind, "fight");
    assert.equal(tick.action, "back-off", JSON.stringify(tick));
  });
});

describe("planFightTick outer branches (Review19)", () => {
  it("054532 i=43: windup d=3.31 cd=0 must dodge (old run hold-attack stood still)", () => {
    const tick = planFightTick(
      snap({
        hp: 2,
        dist: 3.31,
        boss: { phase: "windup", hp: 20, z: -4.8 },
      }),
    );
    assert.equal(tick.kind, "fight");
    assert.equal(tick.action, "dodge", JSON.stringify(tick));
  });

  it("054532 i=60: windup d=3.36 cd=0.05 must retreat, not hold into the hit", () => {
    const tick = planFightTick(
      snap({
        hp: 1,
        dist: 3.36,
        dodgeCd: 0.05,
        boss: { phase: "windup", hp: 20, z: -4.8 },
      }),
    );
    assert.equal(tick.kind, "fight");
    assert.equal(tick.action, "back-off", JSON.stringify(tick));
  });

  it("054532 i=66: recover d=3.3 hp=0.5 must approach (not legacy back-off)", () => {
    const tick = planFightTick(
      snap({
        hp: 0.5,
        dist: 3.3,
        boss: { phase: "recover", hp: 20, z: -4.8 },
      }),
    );
    assert.equal(tick.kind, "fight");
    assert.equal(tick.action, "approach", JSON.stringify(tick));
  });

  it("hurt at 2.56 m after a landed hit keeps swinging within the verified band", () => {
    const tick = planFightTick(
      snap({
        hp: 0.75,
        dist: 2.56,
        boss: { phase: "hurt", hp: 18.2, z: -4.8 },
      }),
    );
    assert.equal(tick.kind, "fight");
    assert.equal(tick.action, "swing", JSON.stringify(tick));
  });

  it("walk/approach phase does not stop the fight loop", () => {
    for (const phase of ["approach", "patrol", "lost", "recover", "hurt"]) {
      const tick = planFightTick(
        snap({ dist: 4.2, boss: { phase, hp: 16.4, z: -4.8 } }),
      );
      assert.equal(tick.kind, "fight", `phase=${phase} ${JSON.stringify(tick)}`);
      assert.notEqual(tick.kind, "stop");
    }
  });

  it("054532 death-respawn world spawn z≈102 is off-arena north-of-gate + recover", () => {
    const s = snap({
      x: 16,
      y: 8.5,
      z: 102,
      hp: 4,
      dist: 122,
      boss: { x: 6, z: -4.8, y: 10.6, hp: 20, phase: "approach" },
    });
    const off = citadelOffArena({ x: s.x, z: s.z, y: s.y }, s.boss);
    assert.equal(off.off, true);
    assert.equal(off.reason, "north-of-gate");
    const tick = planFightTick(s);
    assert.equal(tick.kind, "recover", JSON.stringify(tick));
    assert.equal(tick.far, true);
    assert.ok(tick.wps.length >= 2, `must have return legs: ${JSON.stringify(tick.wps)}`);
  });

  it("courtyard pose near boss stays in fight, no recover", () => {
    const tick = planFightTick(
      snap({ x: 6, y: 10.8, z: -2.2, dist: 2.4, boss: { phase: "recover", z: -4.6 } }),
    );
    assert.equal(tick.kind, "fight", JSON.stringify(tick));
  });
});

describe("continuous trajectory via planFightTick + applyFightAction", () => {
  it("3.9 non-telegraph small steps enter melee and swing; telegraph dodges", () => {
    let pose = {
      dist: 3.9,
      hp: 0.25,
      bossHp: 20,
      dodgeCd: 0,
      landed: 0,
      swings: 0,
    };
    const trail = [];
    for (let step = 0; step < 16; step++) {
      const phase =
        step === 4 ? "windup" : step === 5 ? "strike" : step < 4 ? "approach" : "recover";
      const tick = planFightTick(
        snap({
          dist: pose.dist,
          hp: pose.hp,
          dodgeCd: pose.dodgeCd,
          boss: { phase, hp: pose.bossHp, z: -4.8 },
        }),
      );
      trail.push({
        step,
        dist: +pose.dist.toFixed(2),
        phase,
        action: tick.action ?? tick.kind,
        bossHp: pose.bossHp,
        hp: pose.hp,
      });
      pose = applyFightAction(pose, tick);
    }
    const swings = trail.filter((t) => t.action === "swing");
    assert.ok(swings.length >= 1, `must swing: ${JSON.stringify(trail)}`);
    assert.ok(
      swings[0].dist <= 3.2 && swings[0].dist >= 1.85,
      `swing in melee: ${JSON.stringify(swings[0])}`,
    );
    const tele = trail.find((t) => t.phase === "windup");
    assert.equal(tele.action, "dodge", JSON.stringify(tele));
    assert.ok(
      trail.some((t) => t.step > tele.step && t.action === "swing") || pose.bossHp < 20,
      `must press after telegraph: ${JSON.stringify(trail)}`,
    );
  });

  it("full finish: repeated recover windows drive bossHp to 0 with multiple hits", () => {
    let pose = { dist: 5.2, hp: 2, bossHp: 20, dodgeCd: 0, landed: 0, swings: 0 };
    const trail = [];
    for (let step = 0; step < 80 && pose.bossHp > 0; step++) {
      const cycle = step % 7;
      const phase =
        cycle < 3 ? "approach" : cycle === 3 ? "windup" : cycle === 4 ? "strike" : "recover";
      const tick = planFightTick(
        snap({
          dist: pose.dist,
          hp: pose.hp,
          dodgeCd: cycle === 4 ? 1.2 : pose.dodgeCd,
          boss: { phase, hp: pose.bossHp, z: -4.8 },
        }),
      );
      trail.push({
        step,
        action: tick.action ?? tick.kind,
        dist: +pose.dist.toFixed(2),
        phase,
        bossHp: pose.bossHp,
      });
      if (cycle === 4) pose.dodgeCd = 1.2;
      pose = applyFightAction(pose, tick);
    }
    assert.ok(pose.landed >= 5, `landed=${pose.landed} ${JSON.stringify(trail.slice(-6))}`);
    assert.ok(pose.bossHp <= 0.01, `bossHp=${pose.bossHp}`);
    assert.ok(trail.some((t) => t.action === "dodge"), "telegraph must dodge");
  });

  it("kill4 recorded decisions preserve dodge eligibility; airborne C stays illegal", () => {
    // Keep the recorded scalars from kill4 (PID 55164), with controlled stamina108.
    // Correct the impossible airborne-C expectation, not the late state's survival.
    // These scalar gate checks make no claim that holding or movement avoids a hit.
    const seq = [
      { label: "dec4", hp: 3.5, dist: 2.36, phase: "windup", cd: 0, state: "grounded", want: "dodge" },
      { label: "dec5", hp: 3.5, dist: 1.03, phase: "windup", cd: 0.42, state: "grounded", want: "back-off" },
      { label: "dec10", hp: 2.25, dist: 2.6, phase: "windup", cd: 0, state: "airborne" },
      { label: "dec20", hp: 1.0, dist: 0.65, phase: "windup", cd: 0.43, state: "airborne", want: "back-off-too-close" },
    ];
    for (const step of seq) {
      const s = snap({
        hp: step.hp,
        dist: step.dist,
        state: step.state,
        dodgeCd: step.cd,
        boss: { phase: step.phase, hp: 18.2, z: -4.8 },
      });
      const tick = planFightTick(s);
      assert.equal(tick.kind, "fight", step.label);
      if (step.label === "dec10") {
        assert.equal(canAcceptDodge(s), false);
        assert.notEqual(tick.action, "dodge", JSON.stringify(tick));
        const grounded = { ...s, state: "grounded" };
        assert.equal(canAcceptDodge(grounded), true);
        assert.equal(planFightTick(grounded).action, "dodge");
        continue;
      }
      assert.equal(
        tick.action,
        step.want,
        `${step.label} ${JSON.stringify(tick)}`,
      );
    }
  });

  it("far-respawn recover is selected before fight decisions at d=122", () => {
    const s = snap({
      x: 16,
      y: 8.5,
      z: 102,
      hp: 4,
      dist: 122,
      boss: { x: 6, z: -4.8, y: 10.6, hp: 20, phase: "approach" },
    });
    const tick = planFightTick(s);
    assert.equal(tick.kind, "recover");
    // applying recover must not shrink fight dist — navigation owns the next move
    const next = applyFightAction({ dist: 122, hp: 4, bossHp: 20 }, tick);
    assert.equal(next.dist, 122);
    assert.ok(Array.isArray(next.pendingRecover) && next.pendingRecover.length >= 2);
  });
});
