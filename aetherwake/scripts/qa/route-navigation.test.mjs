import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouteNavigation } from "./route-navigation.mjs";
import { createAbortLatch } from "./combat-progress-monitor.mjs";

function fixture({ dieAt = Infinity, onWait, hpAt = () => 5 } = {}) {
  let t = 0,
    reads = 0,
    revives = 0;
  const events = [],
    pressed = new Set();
  const abort = createAbortLatch();
  const scope = { abort, markInput() {} };
  const read = async () => {
    reads++;
    return {
      mode: reads >= dieAt ? "dead" : "playing",
      hp: reads >= dieAt ? 0 : hpAt(reads),
      state: "grounded",
      x: 0,
      y: 0,
      z: 0,
      camYaw: 0,
      stamina: 20,
    };
  };
  const nav = createRouteNavigation({
    page: {
      keyboard: {
        down: async (k) => {
          events.push(["down", k]);
          pressed.add(k);
        },
        up: async (k) => {
          events.push(["up", k]);
          pressed.delete(k);
        },
        press: async (k) => events.push(["press", k]),
      },
      getByRole: () => ({
        count: async () => 1,
        click: async () => {
          revives++;
        },
      }),
    },
    read,
    wait: async (ms) => {
      t += ms;
      await onWait?.(ms, scope, pressed);
    },
    now: () => t,
    ensureOpen() {},
    MOVE_CODES: ["KeyW", "KeyS", "KeyA", "KeyD", "ShiftLeft"],
    releaseAll: async () => {
      pressed.clear();
    },
    note: (m) => events.push(["note", m]),
    state: {},
    clickNamed: async () => {},
    clickCanvas: async () => {},
    focusPlaySurface: async () => {},
    shrineWorldOrigin: () => ({ x: 0, z: 0 }),
  });
  return {
    nav,
    scope,
    events,
    pressed,
    read,
    get reads() {
      return reads;
    },
    get revives() {
      return revives;
    },
  };
}

test("production goTo second read sees death: no revive, new input, or next waypoint", async () => {
  const f = fixture({ dieAt: 3 });
  await assert.rejects(
    f.nav.follow(
      [
        { x: 20, z: 0 },
        { x: 40, z: 0 },
      ],
      600,
      1,
      f.scope,
    ),
    (e) => e.name === "FightStopError" && e.reason === "death",
  );
  assert.equal(f.revives, 0);
  assert.equal(f.events.filter((e) => e[0] === "down").length, 2);
  assert.equal(f.pressed.size, 0);
  assert.equal(f.reads, 3);
});

test("production follow stops on failed waypoint", async () => {
  const f = fixture();
  const s = await f.nav.follow(
    [
      { x: 20, z: 0 },
      { x: 40, z: 0 },
    ],
    200,
    1,
  );
  assert.equal(s.nav.arrived, false);
  assert.equal(s.nav.tx, 20);
  assert.equal(f.events.filter((e) => e[0] === "down").length, 2);
});

import { createFightOrchestrator } from "./combat-progress-monitor.mjs";
import { readFileSync } from "node:fs";

test("orchestrator uses production goTo; sampler stops held keys and shutdown drains reads", async () => {
  const f = fixture();
  let sampleReads = 0;
  let resolveRead;
  const orch = createFightOrchestrator({
    ...f.nav,
    read: () => {
      sampleReads++;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    now: () => 0,
    wait: async () => {},
    releaseAll: async () => {},
    tryMeleeClick: async () => {},
  });
  const sampling = orch.startSampling();
  const movement = orch.goTo(20, 0, 1000);
  // Allow the production hold to press a key, then deliver death via the sampler.
  for (let i = 0; i < 20 && !f.pressed.size; i++) await Promise.resolve();
  assert.ok(f.pressed.size > 0);
  resolveRead({ mode: "dead", hp: 0 });
  await assert.rejects(movement, (e) => e.name === "FightStopError" && e.reason === "death");
  await orch.stopSampling();
  await sampling;
  assert.equal(f.pressed.size, 0);
  assert.equal(f.revives, 0);
  const downs = f.events.filter((e) => e[0] === "down").length;
  await assert.rejects(orch.follow([{ x: 40, z: 0 }]), { name: "FightStopError" });
  await assert.rejects(orch.resumePlay(), { name: "FightStopError" });
  assert.equal(f.events.filter((e) => e[0] === "down").length, downs);
  const count = orch.monitor.ring.length;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(orch.monitor.ring.length, count);
  assert.equal(sampleReads, 1);
});

test("shutdown awaits an in-flight sample and discards it after stop", async () => {
  const f = fixture();
  let finish,
    reads = 0,
    stopped = false;
  const orch = createFightOrchestrator({
    ...f.nav,
    read: () => {
      reads++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    now: () => 0,
    wait: async () => {},
    tryMeleeClick: async () => {},
  });
  orch.startSampling();
  const stopping = orch.stopSampling().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish({ mode: "playing" });
  await stopping;
  assert.equal(reads, 1);
  assert.equal(orch.monitor.ring.length, 0);
});

test("scope preserves first cause; unscoped resume still revives", async () => {
  const f = fixture({ dieAt: 1 });
  f.scope.abort.abort("read-error:first");
  await assert.rejects(f.nav.resumePlay(f.scope), (e) => e.reason === "read-error:first");
  assert.equal(f.reads, 0);
  await f.nav.resumePlay();
  assert.equal(f.revives, 1);
});

test("play-routes uses the tested factory and stops sampling before cleanup", () => {
  const source = readFileSync(new URL("../play-routes.mjs", import.meta.url), "utf8");
  assert.match(source, /createRouteNavigation\(\{/);
  assert.doesNotMatch(source, /async function (?:goTo|follow|hold|resumePlay)\(/);
  assert.ok(source.indexOf("orch.startSampling()") < source.indexOf("await fightGoTo(36"));
  assert.match(source, /finally \{[^}]*await orch.stopSampling[\s\S]*?await releaseAll\(\)/);
});

test("production hold checks during waits at 100ms and releases without another key-down", async () => {
  const slices = [];
  const f = fixture({
    onWait(ms, scope, pressed) {
      assert.equal(pressed.size, 2);
      slices.push(ms);
      scope.abort.abort("death");
    },
  });
  await assert.rejects(f.nav.hold(["KeyW", "KeyA"], 450, f.scope), { name: "FightStopError" });
  assert.deepEqual(slices, [100]);
  assert.equal(f.pressed.size, 0);
  assert.deepEqual(
    f.events.filter((e) => e[0] !== "note"),
    [
      ["down", "KeyW"],
      ["down", "KeyA"],
      ["up", "KeyA"],
      ["up", "KeyW"],
    ],
  );
});

for (const kind of ['goTo', 'follow']) test(`fight caller guard stops after actual factory ${kind} failure`, async () => {
  const f = fixture();
  let attacks = 0, laterTargets = 0;
  const orch = createFightOrchestrator({ ...f.nav, read: f.read, now: () => 0, wait: async () => {}, tryMeleeClick: async () => { attacks++; } });
  await assert.rejects(async () => {
    if (kind === 'follow') await orch.follow([{ x: 20, z: 0 }, { x: 40, z: 0 }], 200, 1);
    else await orch.goTo(20, 0, 200, { arrive: 1, label: 'first' });
    laterTargets++;
    await orch.goTo(60, 0, 200);
    await orch.tryMeleeClick();
  }, e => e.name === 'FightStopError' && e.reason === 'navigation-failed');
  assert.equal(orch.abort.reason, 'navigation-failed');
  assert.equal(orch.scope.navigationFailure.snap.x, 0);
  assert.equal(orch.scope.navigationFailure.nav.tx, 20);
  assert.equal(orch.scope.navigationFailure.nav.arrived, false);
  assert.equal(orch.scope.navigationFailure.nav.status, 'timeout');
  assert.equal(laterTargets, 0);
  assert.equal(attacks, 0);
  assert.equal(f.pressed.size, 0);
  await assert.rejects(orch.goTo(60, 0, 200), { name: 'FightStopError' });
  await assert.rejects(orch.tryMeleeClick(), { name: 'FightStopError' });
  assert.equal(attacks, 0);
});

 test("fightBoss binds every navigation call to tested orchestrator guards", () => {
  const source = readFileSync(new URL("../play-routes.mjs", import.meta.url), "utf8");
  const fight = source.slice(source.indexOf("async function fightBoss()"), source.indexOf("async function readSaveEnvelope()"));
  assert.match(fight, /const fightGoTo = orch.goTo;/);
  assert.match(fight, /const fightFollow = orch.follow;/);
  assert.doesNotMatch(fight, /await (?:goTo|follow)\(/);
  assert.match(fight, /navigationFailure: orch.scope.navigationFailure/);
  assert.match(fight, /if \(!\(err instanceof FightStopError\)\) throw err/);
});

test('orchestrator guard checks returned failure from real unscoped factory navigation', async () => {
  for (const kind of ['goTo', 'follow']) {
    const f = fixture();
    // Exercise the caller boundary independently of the internal scoped guard.
    const orch = createFightOrchestrator({ ...f.nav,
      goTo: (x, z, ms, opts) => f.nav.goTo(x, z, ms, opts),
      follow: (points, ms, arrive) => f.nav.follow(points, ms, arrive),
      read: f.read, now: () => 0, wait: async () => {}, tryMeleeClick: async () => {} });
    await assert.rejects(kind === 'goTo' ? orch.goTo(20, 0, 200) : orch.follow([{ x: 20, z: 0 }, { x: 40, z: 0 }], 200, 1),
      e => e.name === 'FightStopError' && e.reason === 'navigation-failed');
    assert.equal(orch.scope.navigationFailure.nav.tx, 20);
    assert.equal(orch.scope.navigationFailure.snap.x, 0);
  }
});


test("E23 actual navigation detects HP decrease before later input and preserves first evidence", async () => {
  const f = fixture({ hpAt: (n) => n < 3 ? 2.5 : 2.25 });
  const saved = [];
  const orch = createFightOrchestrator({
    ...f.nav, read: f.read, now: () => f.reads * 100,
    wait: async () => {}, stopFirstHpDrop: true,
    onFirstHpDrop: (event) => saved.push(structuredClone(event)),
  });
  try {
    await assert.rejects(orch.follow([{ x: 20, z: 0 }, { x: 40, z: 0 }], 600, 1),
      (e) => e.reason === "player-hp-drop");
    assert.equal(f.reads, 3);
    assert.equal(f.events.filter((e) => e[0] === "down").length, 2);
    assert.equal(f.pressed.size, 0);
    assert.equal(f.revives, 0);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].pre.snap.hp, 2.5);
    assert.equal(saved[0].post.snap.hp, 2.25);
    assert.equal(saved[0].source, "unknown");
    assert.equal(saved[0].ring.length, 3);
    await assert.rejects(orch.goTo(40, 0, 600), (e) => e.reason === "player-hp-drop");
    await assert.rejects(orch.resumePlay(), (e) => e.reason === "player-hp-drop");
    assert.equal(f.reads, 3);
  } finally {
    await orch.stopSampling();
  }
});

test("E23 opt-out navigation keeps previous failure and input behavior despite HP decrease", async () => {
  const f = fixture({ hpAt: (n) => n < 3 ? 2.5 : 2.25 });
  const orch = createFightOrchestrator({ ...f.nav, read: f.read, now: () => 0 });
  await assert.rejects(orch.follow([{ x: 20, z: 0 }], 600, 1),
    (e) => e.reason === "navigation-failed");
  assert.ok(f.events.filter((e) => e[0] === "down").length > 2);
  assert.equal(orch.monitor.latched, null);
  assert.equal(orch.scope.observeSnapshot, undefined);
});


test("E23 entry enables only explicit citadel opt-in and persists at the latch callback", () => {
  const source = readFileSync(new URL("../play-routes.mjs", import.meta.url), "utf8");
  assert.match(source, /const stopFirstHpDrop = process.env.QA_FOCUS === CITADEL_RESUME_FOCUS &&\s*process.env.QA_STOP_FIRST_HP_DROP === "1"/);
  assert.match(source, /createFightOrchestrator\(\{\s*stopFirstHpDrop,\s*onFirstHpDrop:/);
  assert.match(source, /mkdtempSync\(resolve\(runs, "e23-first-hp-drop-"\)\)/);
  assert.match(source, /flag: "wx"/);
});
