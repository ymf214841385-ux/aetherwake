import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../../src/game/sim.ts';
import { memoryStorage } from '../../src/game/persistence.ts';
import { FIXED_DT } from '../../src/game/params.ts';
import { TOWERS, SHRINES } from '../../src/game/world.ts';
import { resetInput, pressKeyForTest, releaseKeyForTest, takeSimActions } from '../../src/game/input.ts';
import { createRouteNavigation, CombatReady } from './route-navigation.mjs';
import { createFightOrchestrator } from './combat-progress-monitor.mjs';

const archive = JSON.parse(readFileSync(new URL('../../../docs/rebuild-evidence/runs/e28-controller-residual/citadel-stop.json', import.meta.url)));
const recorded = archive.ring.find(s => Math.abs(s.t - 38554.3465) < .001);
const prior = archive.ring.find(s => Math.abs(s.t - 38454.37425) < .001);
const decision = archive.navigationEvidence.completed.find(e => e.final.id === 2).decisions.find(d => d.deferredArrival);
const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'];

// Controlled initial fixture, NOT a browser replay. Keep real terrain, solids,
// all enemies, collision, gravity, input normalization and Sim.step unchanged.
// Missing vx/vz = secant of the two nearby recorded ring poses over wall time.
// Camera yaw inferred from that motion and the recorded KeyS hold; vy/HP and
// nearby enemy state come from the complete ring snapshot, even for the earlier
// decision-pose variant. Initialize once only; no state writes after stepping.
function actualFixture(useDecisionPose) {
  resetInput();
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  for (const t of TOWERS) sim.towersOn.add(t.id);
  for (const s of SHRINES) sim.shrinesOn.add(s.id);
  const dt = (recorded.t - prior.t) / 1000;
  const vx = (recorded.x - prior.x) / dt, vz = (recorded.z - prior.z) / dt;
  const pose = useDecisionPose ? decision : recorded;
  Object.assign(sim.player, { x: pose.x, y: pose.y, z: pose.z, vx, vz,
    vy: recorded.vy, hp: recorded.hp, stamina: recorded.stamina, staminaMax: 108,
    state: 'airborne', grounded: false, gliding: false, climbing: false,
    coyote: 0, jumpBuf: 0, invuln: recorded.invuln, dodgeT: 0, dodgeCd: 0 });
  for (const enemy of recorded.nearbyEnemies) Object.assign(sim.enemies.find(e => e.id === enemy.id), structuredClone(enemy));
  sim.cam.yaw = Math.atan2(vx, vz);
  const frames = [], damage = [];
  const hurt = sim.hurt.bind(sim);
  sim.hurt = (amount, source) => { damage.push({ amount, source }); return hurt(amount, source); };
  const snap = () => ({ ...sim.player, mode: sim.mode, camYaw: sim.cam.yaw });
  return { sim, frames, damage, snap, inference: { priorT: prior.t, recordedT: recorded.t, vx, vz, camYaw: sim.cam.yaw },
    frame() {
      const actions = takeSimActions({ consumeCommands: true, consumeLook: true });
      sim.step(FIXED_DT, actions);
      frames.push({ ...snap(), actions });
    } };
}

function driver({ real, initial = {}, onWait, onRead, onRelease, initialApproach = false, clockOffset = 0, acceptGlide = true } = {}) {
  let ms = 0, simulatedMs = 0, reads = 0;
  let s = { mode: 'playing', hp: 2, x: 26, y: 11.8, z: -44, camYaw: 0,
    state: 'airborne', grounded: false, vy: -.3667, stamina: 108, ...initial };
  const held = new Set(), events = [], waits = [], observations = [];
  const up = async k => { held.delete(k); events.push({ t: ms, type: 'up', k }); if (real) releaseKeyForTest(k); };
  const releaseAll = async () => {
    events.push({ t: ms, type: 'release' });
    for (const k of [...held]) await up(k);
    onRelease?.(f);
  };
  const nav = createRouteNavigation({
    page: { keyboard: {
      down: async k => { held.add(k); events.push({ t: ms, type: 'down', k }); if (real) pressKeyForTest(k); },
      up,
      press: async k => { events.push({ t: ms, type: 'press', k }); if (real) { pressKeyForTest(k); releaseKeyForTest(k); } else if (acceptGlide) s = { ...s, state: 'gliding' }; },
    } },
    read: async () => {
      onRead?.(f, ++reads);
      const value = real ? real.snap() : structuredClone(s);
      observations.push({ t: ms, s: structuredClone(value) });
      return value;
    },
    wait: async n => {
      waits.push(n); ms += n;
      if (real) while (simulatedMs + FIXED_DT * 1000 <= ms + 1e-6) {
        real.frame(); simulatedMs += FIXED_DT * 1000;
      }
      await onWait?.(f, n);
    },
    now: () => ms + clockOffset, releaseAll, ensureOpen() {}, MOVE_CODES: codes, note() {}, state: {},
  });
  const orch = createFightOrchestrator({ ...nav, releaseAll, now: () => ms });
  orch.scope.initialApproach = initialApproach;
  const f = { nav, orch, held, events, waits, observations, now: () => ms,
    elapse: n => { ms += n; }, // Mock transport latency only; real fixtures never use this.
    set: changes => { s = { ...s, ...changes }; },
    evidence: () => orch.getNavigationEvidence().completed[0],
    run: (budget = 1000, options = {}) => orch.goTo(24, -40, budget, { safeDescent: true, arrive: 5, label: 'controlled-settlement', ...options }),
  };
  return f;
}

for (const useDecisionPose of [false, true]) test(`actual production Sim/input/navigation natural landing, decisionPose=${useDecisionPose}`, async t => {
  const real = actualFixture(useDecisionPose), f = driver({ real, initialApproach: true });
  // Simulate a key inherited at entry, so releaseAll must really reach input.
  f.held.add('KeyS'); pressKeyForTest('KeyS');
  let result, failure;
  try { result = await f.run(1200); } catch (e) { failure = e.reason; }
  t.diagnostic(JSON.stringify({ controlledOnly: true, useDecisionPose, inference: real.inference,
    elapsedMs: f.now(), failure, events: f.events, decisions: f.evidence().decisions,
    reads: f.observations, frameCount: real.frames.length, damage: real.damage }));
  assert.equal(failure, undefined);
  assert.equal(result.nav.arrived, true);
  assert.ok(f.now() > 0 && f.now() <= 300);
  assert.equal(result.state, 'grounded'); assert.equal(result.grounded, true);
  assert.ok(result.nav.dist <= 5);
  assert.equal(result.hp, recorded.hp); assert.deepEqual(real.damage, []);
  assert.equal(f.events.filter(e => e.type === 'down' || e.type === 'press').length, 0);
  assert.equal(f.held.size, 0);
  assert.ok(real.frames.every(s => s.actions.moveX === 0 && s.actions.moveY === 0 && !s.actions.jump && !s.actions.sprint));
  assert.equal(f.evidence().final.stage, 'settling');
  assert.equal(f.evidence().decisions.at(-1).settlement, 'landed');
  // Next waypoint starts only after the actual landed return, at the observed pose.
  await f.orch.goTo(result.x, result.z, 100, { arrive: .1, label: 'controlled-next' });
  assert.equal(f.orch.getNavigationEvidence().completed[1].final.startedAt, f.evidence().endedAt);
});

for (const scoped of [false, true]) test(`no opt-in proximity contract unchanged scoped=${scoped}`, async () => {
  const f = driver();
  const result = scoped ? await f.run(1000, { safeDescent: false }) : await f.nav.goTo(24, -40, 1000, { arrive: 5 });
  assert.equal(result.nav.arrived, true); assert.equal(f.now(), 0); assert.deepEqual(f.waits, []);
});
test('valid grounded arrival unchanged', async () => {
  const f = driver({ initial: { state: 'grounded', grounded: true } });
  assert.equal((await f.run()).nav.arrived, true); assert.deepEqual(f.waits, []);
});
test('already gliding retains directional behavior with no arrival or cancellation', async () => {
  const f = driver({ initial: { state: 'gliding', vy: -2.2 } });
  await assert.rejects(f.run(220), e => e.reason === 'navigation-failed');
  assert.ok(f.events.some(e => e.type === 'down'));
  assert.equal(f.events.filter(e => e.type === 'press').length, 0);
  assert.equal(f.evidence().decisions.some(d => d.stage === 'settling'), false);
});
for (const vy of [0, -2.999]) test(`finite low-vy boundary settles vy=${vy}`, async () => {
  const f = driver({ initial: { vy }, onWait: f => f.set({ state: 'grounded', grounded: true }) });
  assert.equal((await f.run()).nav.arrived, true); assert.deepEqual(f.waits, [100]);
});
for (const vy of [NaN, Infinity, .01]) test(`outside settlement velocity gate vy=${vy}`, async () => {
  const f = driver({ initial: { vy } });
  await assert.rejects(f.run(220), e => e.reason === 'navigation-failed');
  assert.equal(f.evidence().decisions.some(d => d.stage === 'settling'), false);
});
test('settlement fastfall returns to original glide before any directional input, exactly one Space', async () => {
  const f = driver({ onWait: f => { if (f.now() === 100) f.set({ vy: -3 }); } });
  await assert.rejects(f.run(320), e => e.reason === 'navigation-failed');
  const inputs = f.events.filter(e => ['down', 'press'].includes(e.type));
  assert.deepEqual(inputs[0], { t: 100, type: 'press', k: 'Space' });
  assert.equal(inputs.filter(e => e.type === 'press').length, 1);
  assert.equal(f.evidence().decisions.find(d => d.settlement === 'fastfall').t, 100);
});
for (const kind of ['stamina', 'rejected', 'already-attempted']) test(`settlement fastfall preserves existing glide guard: ${kind}`, async () => {
  const f = driver({ acceptGlide: kind !== 'rejected',
    initial: { stamina: kind === 'stamina' ? 8 : 108 },
    onWait: f => f.set({ state: 'airborne', vy: -3 }),
  });
  if (kind === 'already-attempted') {
    f.set({ state: 'gliding', vy: -2.2 });
    // Mark the existing glide across calls without introducing a new Space.
    await f.nav.goTo(24, -40, 220, { arrive: 5, safeDescent: true });
    f.set({ state: 'airborne', vy: -.3667 });
  }
  await assert.rejects(f.run(), e => e.reason === (kind === 'stamina' ? 'glide-unavailable' : 'glide-not-started'));
  assert.equal(f.events.filter(e => e.type === 'press').length, kind === 'rejected' ? 1 : 0);
  const event = f.orch.getNavigationEvidence().completed[0];
  assert.equal(event.decisions.some(d => d.settlement === 'fastfall'), true);
  assert.equal(f.held.size, 0);
});
test('settlement drift outside resumes original navigation', async () => {
  const f = driver({ onWait: f => f.set({ x: 30 }) });
  await assert.rejects(f.run(320), e => e.reason === 'navigation-failed');
  assert.equal(f.events.find(e => e.type === 'down').t, 100);
  assert.equal(f.evidence().decisions.find(d => d.settlement === 'drifted').navigationOutcome.arrived, false);
});
test('grounded outside arrival radius resumes navigation without accepted settlement', async () => {
  const f = driver({ onWait: f => f.set({ x: 30, state: 'grounded', grounded: true }) });
  await assert.rejects(f.run(300), e => e.reason === 'navigation-failed');
  assert.equal(f.evidence().decisions.some(d => d.arrived), false);
  assert.equal(f.events.find(e => e.type === 'down').t, 100);
});
for (const changes of [{ x: 30 }, { vy: -3 }, { state: 'gliding', vy: -2.2 }]) test(`settlement exit at original deadline sends no further input: ${JSON.stringify(changes)}`, async () => {
  const f = driver({ onWait: f => f.set(changes) });
  await assert.rejects(f.run(100), e => e.reason === 'navigation-failed');
  assert.equal(f.now(), 100);
  assert.equal(f.events.filter(e => ['down', 'press'].includes(e.type)).length, 0);
});
test('gliding observed during settlement resumes existing glide without Space', async () => {
  const f = driver({ onWait: f => f.set({ state: 'gliding', vy: -2.2 }) });
  await assert.rejects(f.run(320), e => e.reason === 'navigation-failed');
  assert.equal(f.events.find(e => e.type === 'down').t, 100);
  assert.equal(f.events.filter(e => e.type === 'press').length, 0);
});
for (const budget of [1000, 250, 50]) test(`no-ground explicit first failure, deadline caps budget=${budget}`, async () => {
  const f = driver({ clockOffset: 1700000000000 });
  await assert.rejects(f.run(budget), e => e.reason === 'descent-landing-not-observed');
  assert.equal(f.now(), Math.min(300, budget));
  assert.ok(f.waits.every(n => n <= 100));
  assert.equal(f.events.filter(e => ['down', 'press'].includes(e.type)).length, 0);
  const failure = f.orch.scope.navigationFailure;
  assert.equal(failure.nav.safeDescent.observations.length, f.waits.length + 1);
  assert.equal(f.evidence().decisions.at(-1).settlement, 'descent-landing-not-observed');
  assert.equal(f.evidence().final.stage, 'settling');
  assert.equal(f.evidence().final.deadline, budget);
  await assert.rejects(f.orch.follow([{ x: 6, z: 8 }], 1000), e => e.reason === 'descent-landing-not-observed');
  assert.equal(f.orch.getNavigationEvidence().completed.length, 1);
});
test('unscoped opted-in unresolved settlement returns failure without throwing', async () => {
  const f = driver();
  const result = await f.nav.goTo(24, -40, 1000, { arrive: 5, safeDescent: true });
  assert.equal(result.nav.status, 'descent-landing-not-observed'); assert.equal(f.now(), 300);
  assert.equal(f.held.size, 0);
});
for (const inconsistent of [{ state: 'grounded', grounded: false }, { state: 'airborne', grounded: true }]) test(`settlement requires both grounding fields ${JSON.stringify(inconsistent)}`, async () => {
  const f = driver({ onWait: f => f.set(inconsistent) });
  await assert.rejects(f.run(), e => e.reason === 'descent-landing-not-observed');
  assert.equal(f.now(), 300);
});
test('fresh natural landing on the last allowed slice may arrive', async () => {
  const f = driver({ onWait: f => { if (f.now() === 250) f.set({ state: 'grounded', grounded: true }); } });
  assert.equal((await f.run(250)).nav.arrived, true); assert.deepEqual(f.waits, [100, 100, 50]);
});
test('settlement accepts the first actual checked landing read without discarding it for another read', async () => {
  const f = driver({ initialApproach: true, onRead: (f, n) => {
    if (n === 2) f.set({ state: 'grounded', grounded: true });
    if (n === 3) f.set({ state: 'airborne', grounded: false });
  } });
  assert.equal((await f.run()).nav.arrived, true);
  assert.equal(f.now(), 100); assert.equal(f.observations.length, 2);
  assert.equal(f.evidence().decisions.at(-1).settlement, 'landed');
});
test('settlement first checked fastfall read reaches Space before a later gliding read', async () => {
  const f = driver({ initialApproach: true, onRead: (f, n) => {
    if (n === 2) f.set({ vy: -3 });
    if (n === 3) f.set({ state: 'gliding', vy: -2.2 });
  } });
  await assert.rejects(f.run(320), e => e.reason === 'navigation-failed');
  assert.deepEqual(f.events.filter(e => ['down', 'press'].includes(e.type))[0], { t: 100, type: 'press', k: 'Space' });
  assert.equal(f.events.filter(e => e.type === 'press').length, 1);
});
for (const budget of [150, 1000]) test(`a landing first read after the settlement cutoff cannot extend it, goTo budget=${budget}`, async () => {
  const f = driver({ initialApproach: true, onRead: (f, n) => {
    if (n === 2) { f.elapse(budget === 150 ? 60 : 210); f.set({ state: 'grounded', grounded: true }); }
  } });
  await assert.rejects(f.run(budget), e => e.reason === 'descent-landing-not-observed');
  assert.deepEqual(f.waits, [100]);
  assert.equal(f.events.filter(e => ['down', 'press'].includes(e.type)).length, 0);
  assert.equal(f.evidence().decisions.at(-1).arrived, false);
  assert.equal(f.orch.scope.navigationFailure.nav.safeDescent.observations.at(-1).snapshot.grounded, true);
});
test('settlement drift checks the requested radius even when the original climbing outcome permits a wider one', async () => {
  const f = driver({ onWait: f => f.set({ x: 30, z: -40, state: 'climbing', grounded: false }) });
  const result = await f.run();
  assert.equal(result.nav.status, 'arrived-climbing'); // Existing navigation resumes unchanged.
  assert.equal(f.now(), 100);
  assert.equal(f.evidence().decisions.find(d => d.settlement === 'drifted').navigationOutcome.arrived, true);
});
test('settlement uses only time remaining after earlier navigation within the same goTo', async () => {
  const f = driver({ initial: { x: 30 }, onWait: f => f.set({ x: 26 }) });
  await assert.rejects(f.run(250), e => e.reason === 'descent-landing-not-observed');
  assert.equal(f.now(), 250); assert.deepEqual(f.waits, [100, 100, 20, 30]);
  assert.equal(f.evidence().decisions.find(d => d.stage === 'settling').t, 220);
});
for (const initialApproach of [false, true]) for (const kind of (initialApproach ? ['death', 'abort', 'read-error', 'CombatReady'] : ['death', 'abort', 'read-error'])) test(`settlement ${kind} wins, releases, and unwinds caller, initialApproach=${initialApproach}`, async () => {
  const f = driver({ initialApproach,
    onWait: f => {
      if (kind === 'death') f.set({ hp: 0, state: 'dead' });
      if (kind === 'abort') f.orch.abort.abort('original-stop');
      if (kind === 'CombatReady') f.set({ sealOpen: true, bossDead: false, bossMeleeBlocked: false,
        boss: { x: 26, y: 11.8, z: -44, hp: 20, alive: true } });
    },
    onRead: (_f, n) => { if (kind === 'read-error' && n > 1) throw Error('settle-read'); },
  });
  f.held.add('ShiftLeft');
  let next = false;
  await assert.rejects((async () => { await f.run(); next = true; await f.orch.follow([{ x: 6, z: 8 }], 1000); })(),
    e => kind === 'CombatReady' ? e instanceof CombatReady : e.reason === (kind === 'abort' ? 'original-stop' : kind === 'read-error' ? 'read-error:settle-read' : 'death'));
  assert.equal(next, false); assert.equal(f.held.size, 0); assert.equal(f.now(), 100);
  assert.equal(f.events.filter(e => ['down', 'press'].includes(e.type)).length, 0);
  assert.equal(f.evidence().final.stage, 'settling');
  assert.equal(f.evidence().outcome, kind === 'CombatReady' ? 'combat-ready' : 'failure');
  assert.equal(f.orch.getNavigationEvidence().active, null);
  // Reads which throw the higher-priority signal must not fabricate an arrival.
  assert.equal(f.evidence().decisions.some(d => d.arrived), false);
});
test('abort during final key release wins over observed landed return', async () => {
  const f = driver({ onWait: f => f.set({ state: 'grounded', grounded: true }),
    onRelease: f => { if (f.now() === 100) f.orch.abort.abort('release-stop'); } });
  await assert.rejects(f.nav.goTo(24, -40, 1000, { arrive: 5, safeDescent: true }, f.orch.scope), e => e.reason === 'release-stop');
  assert.equal(f.evidence().outcome, 'failure'); assert.equal(f.held.size, 0);
});
test('settlement decisions carry only actual read timestamps; monitor observation is not a decision', async () => {
  const samples = [];
  const f = driver({ initialApproach: true, onWait: f => {
    const active = f.orch.scope.navigationEvidence.active;
    samples.push(structuredClone(active));
    f.orch.monitor.observe({ mode: 'playing', hp: 2, state: 'grounded', grounded: true, x: 24, z: -40 }, { navigation: active });
    if (f.now() === 200) f.set({ state: 'grounded', grounded: true });
  } });
  await f.run();
  assert.ok(samples.every(s => s.stage === 'settling'));
  assert.equal(samples[0].lastDecision.settlement, 'observe');
  const decisions = f.evidence().decisions;
  assert.deepEqual(decisions.filter(d => d.stage === 'settling').map(d => [d.t, d.settlement]), [[0, 'observe'], [100, 'observe'], [200, 'landed']]);
  assert.ok(decisions.every(d => f.observations.some(r => r.t === d.t && r.s.state === d.state && r.s.grounded === d.grounded)));
  assert.equal(decisions.filter(d => d.arrived).length, 1);
  assert.equal(f.orch.monitor.ring[0].activeNavigation.lastDecision.arrived, false);
});
