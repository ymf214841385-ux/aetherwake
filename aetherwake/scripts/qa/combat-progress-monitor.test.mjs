/**
 * E1: fail-first then pass — tests import the same production module.
 * Fake monotonic clock; no independent demo implementation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NO_DAMAGE_MS,
  RING_MAX,
  SAMPLE_BEAT_MS,
  createAbortLatch,
  createCombatProgressMonitor,
  classifyFightSnapshot,
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
    set(v) {
      t = v;
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

describe("E1 classifyFightSnapshot", () => {
  it("combat requires playing/alive/seal/hz8/dy3", () => {
    assert.equal(classifyFightSnapshot(combatSnap()), "combat");
    assert.equal(classifyFightSnapshot(navSnap()), "navigation");
    assert.equal(classifyFightSnapshot(null), "unknown");
    assert.equal(classifyFightSnapshot(combatSnap({ mode: "dead" })), "unknown");
    assert.equal(classifyFightSnapshot(combatSnap({ state: "dead" })), "dead");
    assert.equal(classifyFightSnapshot(combatSnap({ hp: 0 })), "dead");
    assert.equal(classifyFightSnapshot(combatSnap({ sealOpen: false })), "unknown");
    assert.equal(
      classifyFightSnapshot(combatSnap({ boss: { ...combatSnap().boss, alive: false } })),
      "unknown",
    );
    assert.equal(
      classifyFightSnapshot(
        combatSnap({ boss: { ...combatSnap().boss, x: 20, z: -2.5 } }),
      ),
      "navigation",
    );
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
    assert.equal(mon.latched, null, JSON.stringify(mon.latched));
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
    assert.ok(mon.noDamageMs >= NO_DAMAGE_MS, `noDamageMs=${mon.noDamageMs}`);
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
    assert.ok(afterFirst >= 8000 - 200, `afterFirst=${afterFirst}`);
    for (let i = 0; i < 600; i++) {
      clock.advance(100);
      mon.observe(navSnap());
    }
    assert.equal(mon.noDamageMs, afterFirst, "navigation must not reset no-damage");
    assert.equal(mon.latched, null);
    // First combat after nav is not combat-combat; need enough pairs to pass 15s total.
    for (let i = 0; i < 80; i++) {
      clock.advance(100);
      mon.observe(combatSnap());
    }
    assert.equal(mon.latched?.reason, "combat-no-damage", JSON.stringify(mon.latched));
  });

  it("boss HP drop resets no-damage accumulation", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    for (let i = 0; i < 100; i++) {
      mon.observe(combatSnap({ boss: { x: 6.5, y: 10.8, z: -2.5, hp: 20, alive: true, phase: "recover" } }));
      clock.advance(100);
    }
    assert.ok(mon.noDamageMs >= 9000);
    mon.observe(
      combatSnap({ boss: { x: 6.5, y: 10.8, z: -2.5, hp: 18.2, alive: true, phase: "hurt" } }),
    );
    assert.equal(mon.noDamageMs, 0);
    assert.equal(mon.latched, null);
  });

  it("sample gap >500ms is not counted as combat", () => {
    const clock = makeClock();
    const events = [];
    const mon = createCombatProgressMonitor({ now: clock.now, onEvent: (e) => events.push(e) });
    mon.observe(combatSnap());
    clock.advance(800);
    mon.observe(combatSnap());
    assert.equal(mon.combatMs, 0);
    assert.ok(events.some((e) => e.type === "sample-gap"));
  });

  it("unknown pauses timing (does not add combat/nav)", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    mon.observe(combatSnap());
    clock.advance(100);
    mon.observe(null);
    clock.advance(5000);
    mon.observe(combatSnap());
    clock.advance(100);
    mon.observe(combatSnap());
    // Only the fresh 100ms combat-combat pair after unknown counts.
    assert.equal(mon.combatMs, 100, `combatMs=${mon.combatMs}`);
    assert.equal(mon.navMs, 0);
    assert.equal(mon.noDamageMs, 100);
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
    const wait = async (ms) => clock.advance(ms);
    const r = await runCombatSampleLoop({
      read,
      monitor: mon,
      now: clock.now,
      wait,
      shouldStop: () => clock.now() >= 30000,
    });
    assert.ok(reads > 250, `reads=${reads}`);
    assert.equal(overlapping, false, "serial read must not overlap");
    assert.ok(mon.ring.length <= RING_MAX);
    const tNow = clock.now();
    assert.ok(mon.ring.every((e) => e.t >= tNow - 10000 - SAMPLE_BEAT_MS));
    assert.ok(r.samples === reads);
    assert.ok(SAMPLE_BEAT_MS === 100);
  });

  it("after 100 ring entries still tracks damage and timeout", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    for (let i = 0; i < 200; i++) {
      mon.observe(combatSnap({ boss: { x: 6.5, y: 10.8, z: -2.5, hp: 20, alive: true, phase: "windup" } }));
      clock.advance(100);
    }
    assert.ok(mon.ring.length <= RING_MAX);
    assert.ok(mon.noDamageMs >= NO_DAMAGE_MS, `noDamageMs=${mon.noDamageMs}`);
    assert.equal(mon.latched?.reason, "combat-no-damage");
  });

  it("stop() freezes monitor; no further samples accumulate", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    mon.observe(combatSnap());
    clock.advance(100);
    mon.observe(combatSnap());
    mon.stop("test");
    const cm = mon.combatMs;
    clock.advance(100);
    mon.observe(combatSnap());
    assert.equal(mon.combatMs, cm);
    assert.equal(mon.stopped, true);
  });
});

describe("E1 death latch + abort wrappers + focus gate", () => {
  it("death sample latches stop", () => {
    const clock = makeClock();
    const mon = createCombatProgressMonitor({ now: clock.now });
    mon.observe(combatSnap());
    mon.observe(combatSnap({ state: "dead", hp: 0 }));
    assert.equal(mon.latched?.reason, "death");
    assert.equal(mon.stopped, true);
  });

  it("abort latch blocks hold/goTo and releases keys", async () => {
    const latch = createAbortLatch();
    let held = 0;
    let went = 0;
    const hold = async () => {
      held += 1;
    };
    const goTo = async () => {
      went += 1;
      return { nav: { arrived: false } };
    };
    const released = { n: 0 };
    const holdW = wrapHoldForAbort(hold, () => latch, async () => {
      released.n += 1;
    });
    const goToW = wrapGoToForAbort(goTo, () => latch);
    await holdW(["KeyW"], 10);
    await goToW(6, -4, 1000);
    assert.equal(held, 1);
    assert.equal(went, 1);
    latch.abort("death");
    await holdW(["KeyW"], 10);
    const g = await goToW(6, -4, 1000);
    assert.equal(held, 1, "no new hold after abort");
    assert.equal(went, 1, "no new goTo after abort");
    assert.equal(released.n, 1, "releaseAll on aborted hold");
    assert.equal(g.aborted, true);
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
    assert.equal(r.reason, "precondition-failed");
    assert.equal(r.fightBossCalled, false);
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
