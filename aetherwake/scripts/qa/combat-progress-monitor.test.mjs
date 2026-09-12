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

// E1.2 production orchestration regressions live in route-navigation.test.mjs.

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


describe("E23 first player HP decrease", () => {
  it("finite initial/equal HP and invalid values do not trigger or replace baseline", () => {
    const clock = makeClock();
    const events = [];
    const mon = createCombatProgressMonitor({ now: clock.now, stopFirstHpDrop: true,
      onEvent: (e) => events.push(e) });
    for (const hp of [undefined, null, NaN, Infinity, "2.5", 2.5, 2.5, NaN, null, -Infinity]) {
      mon.observe(navSnap({ hp }));
      clock.advance(100);
      assert.equal(mon.latched, null);
    }
    const post = navSnap({ hp: 2.25, vy: -18, grounded: false, cold: true,
      spicy: 0, coldAcc: 1, invuln: 0.9,
      nearbyEnemies: [{ id: "e", brain: { phase: "attack" } }],
      nearbyProjectiles: [{ kind: "beam", x: 2 }] });
    mon.observe(post);
    assert.equal(mon.latched.reason, "player-hp-drop");
    assert.equal(mon.latched.pre.snap.hp, 2.5);
    assert.equal(mon.latched.source, "unknown");
    assert.equal(mon.latched.ring.at(-1).vy, -18);
    assert.equal(mon.latched.ring.at(-1).cold, true);
    post.nearbyEnemies[0].id = "mutated";
    clock.advance(30000);
    mon.observe(navSnap({ hp: 0 }));
    assert.equal(mon.latched.post.snap.nearbyEnemies[0].id, "e");
    assert.equal(events.filter((e) => e.type === "player-hp-drop").length, 1);
    assert.equal(mon.latched.to, 2.25);
  });

  it("actual serial sample loop latches a navigation drop including lethal drops", async () => {
    for (const hp of [2.25, 0]) {
      const clock = makeClock();
      const mon = createCombatProgressMonitor({ now: clock.now, stopFirstHpDrop: true });
      const snaps = [navSnap(), navSnap(), navSnap({ hp })];
      const result = await runCombatSampleLoop({ read: async () => snaps.shift(), monitor: mon,
        now: clock.now, wait: async (ms) => clock.advance(ms), shouldStop: () => false });
      assert.equal(result.samples, 3);
      assert.equal(result.latched.reason, "player-hp-drop");
      assert.equal(result.latched.ring[0].phase, "navigation");
      assert.equal(result.combatMs, 0);
    }
  });

  it("opt-out preserves death precedence and ignores nonlethal player drops", () => {
    const mon = createCombatProgressMonitor({ now: () => 0 });
    mon.observe(navSnap());
    mon.observe(navSnap({ hp: 2.25 }));
    assert.equal(mon.latched, null);
    mon.observe(navSnap({ hp: 0 }));
    assert.equal(mon.latched.reason, "death");
  });
});
