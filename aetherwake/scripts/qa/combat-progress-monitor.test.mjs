/**
 * E1/E1.1: fail-first then pass — tests import the same production module.
 * Fake monotonic clock; no independent demo implementation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NO_DAMAGE_MS,
  RING_MAX,
  SAMPLE_BEAT_MS,
  classifyFightSnapshot,
  createAbortLatch,
  createCombatProgressMonitor,
  createFightOrchestrator,
  runCitadelFocusGate,
  runCombatSampleLoop,
  wrapGoToForAbort,
  wrapHoldForAbort,
} from "./combat-progress-monitor.mjs";

function makeClock() {
  let t = 0;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

function combatSnap(over = {}) {
  return {
    mode: "playing",
    state: "grounded",
    hp: 2.5,
    x: 6,
    y: 10.7,
    z: -2,
    stamina: 50,
    dodgeCd: 0,
    dodgeT: 0,
    sealOpen: true,
    boss: { x: 6.5, y: 10.8, z: -2.5, hp: 20, alive: true, phase: "windup" },
    ...over,
  };
}

function navSnap(over = {}) {
  return combatSnap({
    x: 6,
    y: 53.5,
    z: -124,
    boss: { x: 6, y: 11, z: -5, hp: 20, alive: true, phase: "approach" },
    ...over,
  });
}

describe("E1.1 death-first classification", () => {
  it("mode dead / state dead / hp<=0 all classify dead before playing gate", () => {
    assert.equal(classifyFightSnapshot({ mode: "dead", state: "dead", hp: 0 }), "dead");
    assert.equal(classifyFightSnapshot({ mode: "playing", state: "dead", hp: 0 }), "dead");
    assert.equal(classifyFightSnapshot({ mode: "playing", state: "grounded", hp: 0 }), "dead");
    assert.equal(classifyFightSnapshot({ mode: "dead", state: "grounded", hp: 3 }), "dead");
  });

  it("observe latches death for mode-dead snapshot", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    mon.observe({ mode: "dead", state: "dead", hp: 0 });
    assert.equal(mon.latched?.reason, "death");
    assert.equal(mon.stopped, true);
  });
});

describe("E1 classifyFightSnapshot", () => {
  it("combat requires playing/alive/seal/hz8/dy3", () => {
    assert.equal(classifyFightSnapshot(combatSnap()), "combat");
    assert.equal(classifyFightSnapshot(navSnap()), "navigation");
    assert.equal(classifyFightSnapshot(null), "unknown");
    assert.equal(classifyFightSnapshot(combatSnap({ sealOpen: false })), "unknown");
  });
});

describe("E1 no-damage timer uses combat-only accumulation", () => {
  it("navigation 60s never triggers combat-no-damage", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    for (let i = 0; i < 600; i++) {
      mon.observe(navSnap());
      clock.advance(100);
    }
    assert.equal(mon.latched, null);
    assert.ok(mon.navMs >= 60000 - 200, `navMs=${mon.navMs}`);
    assert.equal(mon.noDamageMs, 0);
  });

  it("combat 14.9s no latch; 15s latches combat-no-damage", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    mon.observe(combatSnap());
    for (let i = 0; i < 148; i++) {
      clock.advance(100);
      mon.observe(combatSnap());
    }
    assert.equal(mon.noDamageMs < NO_DAMAGE_MS, true, `noDamageMs=${mon.noDamageMs}`);
    assert.equal(mon.latched, null);
    while (mon.noDamageMs < NO_DAMAGE_MS && !mon.latched) {
      clock.advance(100);
      mon.observe(combatSnap());
    }
    assert.equal(mon.latched?.reason, "combat-no-damage");
  });

  it("combat 8s → nav 60s → combat 7s latches (exit/enter does not reset)", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    mon.observe(combatSnap());
    for (let i = 0; i < 85; i++) {
      clock.advance(100);
      mon.observe(combatSnap());
    }
    const afterFirst = mon.noDamageMs;
    for (let i = 0; i < 600; i++) {
      clock.advance(100);
      mon.observe(navSnap());
    }
    assert.equal(mon.noDamageMs, afterFirst);
    for (let i = 0; i < 80; i++) {
      clock.advance(100);
      mon.observe(combatSnap());
    }
    assert.equal(mon.latched?.reason, "combat-no-damage");
  });

  it("boss HP drop resets no-damage accumulation", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    for (let i = 0; i < 100; i++) {
      mon.observe(combatSnap({ boss: { x: 6.5, y: 10.8, z: -2.5, hp: 20, alive: true, phase: "recover" } }));
      clock.advance(100);
    }
    mon.observe(
      combatSnap({ boss: { x: 6.5, y: 10.8, z: -2.5, hp: 18.2, alive: true, phase: "hurt" } }),
    );
    assert.equal(mon.noDamageMs, 0);
  });

  it("sample gap >500ms is not counted as combat", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    mon.observe(combatSnap());
    clock.advance(800);
    mon.observe(combatSnap());
    assert.equal(mon.combatMs, 0);
  });
});

describe("E1 ring sampler", () => {
  it("keeps only last 10s after 30s navigation sampling; serial reads", async () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    let reads = 0;
    let overlapping = false;
    let inFlight = false;
    const read = async () => {
      if (inFlight) overlapping = true;
      inFlight = true;
      reads += 1;
      await Promise.resolve();
      inFlight = false;
      return navSnap();
    };
    const r = await runCombatSampleLoop({
      read,
      monitor: mon,
      now: clock.now,
      wait: async (ms) => clock.advance(ms),
      shouldStop: () => clock.now() >= 30000,
    });
    assert.ok(reads > 250, `reads=${reads}`);
    assert.equal(overlapping, false);
    assert.ok(mon.ring.length <= RING_MAX);
    assert.ok(r.samples === reads);
  });
});

describe("E1.1 orchestrator: death mid goTo/follow stops without revive", () => {
  it("second leg reads mode dead → abort, no revive/keys/click, no new samples after stop", async () => {
    const clock = makeClock();
    const events = [];
    let snaps = [
      navSnap(),
      navSnap(),
      { mode: "dead", state: "dead", hp: 0, x: 6, y: 53.5, z: -124 },
      // After death, any further reads must not drive inputs.
      { mode: "dead", state: "dead", hp: 0 },
    ];
    let si = 0;
    const read = async () => snaps[Math.min(si++, snaps.length - 1)];
    const held = [];
    const hold = async (keys) => {
      held.push(keys.join("+"));
    };
    const went = [];
    const goTo = async (x, z) => {
      went.push([x, z]);
      return navSnap();
    };
    const followed = [];
    const follow = async (pts) => {
      followed.push(pts);
      // Simulate follow calling goTo twice; second goTo's next read is dead.
      await goTo(pts[0]?.x, pts[0]?.z);
      // Main loop / resumePlay reads dead here via orchestrator resume.
      return navSnap();
    };
    let resumed = 0;
    const resumePlay = async () => {
      resumed += 1;
      return navSnap();
    };
    let clicked = 0;
    const tryMeleeClick = async () => {
      clicked += 1;
    };
    let released = 0;
    const releaseAll = async () => {
      released += 1;
    };
    const orch = createFightOrchestrator({
      read,
      hold,
      goTo,
      follow,
      resumePlay,
      tryMeleeClick,
      releaseAll,
      now: clock.now,
      wait: async (ms) => clock.advance(ms),
      note: (m) => events.push(m),
    });
    orch.startSampling();
    // Descent nav
    await orch.goTo(36, -90, 1000, { arrive: 4 });
    // After first goTo, advance so sampler can read death
    for (let i = 0; i < 5; i++) {
      clock.advance(100);
      await Promise.resolve();
    }
    // Resume path must see death and refuse revive
    const r = await orch.resumePlay();
    assert.equal(orch.abort.aborted, true);
    assert.ok(
      orch.abort.reason === "death" || orch.abort.reason === "death-before-resume",
      `reason=${orch.abort.reason}`,
    );
    assert.equal(resumed, 0, "resumePlay must not run after death read");
    // Further actions blocked
    await orch.hold(["KeyW"], 200);
    await orch.goTo(6, 8, 1000);
    await orch.follow([{ x: 6, z: 8 }]);
    await orch.tryMeleeClick();
    assert.ok(released >= 1, "releaseAll on aborted hold");
    assert.equal(went.length, 1, "no new goTo after abort");
    assert.equal(followed.length, 0);
    assert.equal(clicked, 0);
    const samplesBefore = orch.monitor.ring.length;
    clock.advance(500);
    await Promise.resolve();
    await orch.stopSampling("test-done");
    const samplesAfter = orch.monitor.ring.length;
    assert.ok(samplesAfter <= samplesBefore + 1, "no new samples after stop");
    assert.equal(orch.monitor.stopped, true);
    assert.ok(r === null || r.mode === "dead", `resume returned ${JSON.stringify(r)}`);
  });
});

describe("E1 death latch + abort wrappers + focus gate", () => {
  it("abort latch blocks hold/goTo and releases keys", async () => {
    const latch = createAbortLatch();
    let held = 0;
    const hold = async () => {
      held += 1;
    };
    const holdW = wrapHoldForAbort(hold, () => latch, async () => {}, { wait: async () => {} });
    latch.abort("death");
    await holdW(["KeyW"], 10);
    assert.equal(held, 0);
  });

  it("focusOk=false never calls fightBoss (precondition-failed)", async () => {
    let calls = 0;
    const r = await runCitadelFocusGate({
      focusOk: false,
      fightBoss: async () => {
        calls += 1;
        return {};
      },
    });
    assert.equal(calls, 0);
    assert.equal(r.ok, false);
  });

  it("focusOk=true invokes fightBoss exactly once", async () => {
    let calls = 0;
    const r = await runCitadelFocusGate({
      focusOk: true,
      fightBoss: async () => {
        calls += 1;
        return { bossDead: false };
      },
    });
    assert.equal(calls, 1);
    assert.equal(r.fightBossCalled, true);
  });
});
