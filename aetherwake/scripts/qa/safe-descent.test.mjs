import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../../src/game/sim.ts';
import { memoryStorage } from '../../src/game/persistence.ts';
import { FIXED_DT } from '../../src/game/params.ts';
import { resetInput, pressKeyForTest, releaseKeyForTest, takeSimActions } from '../../src/game/input.ts';
import { createRouteNavigation } from './route-navigation.mjs';
import { createAbortLatch, createFightOrchestrator } from './combat-progress-monitor.mjs';
const evidence = JSON.parse(readFileSync(new URL('../../../docs/rebuild-evidence/runs/e23-first-hp-drop-Ksh35m/player-hp-drop.json', import.meta.url)));
const recorded = evidence.pre.snap;
const early = evidence.ring.find(s => s.state === 'airborne' && s.vy <= -3);
function simFixture(earlyDescent = false) {
  resetInput();
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  for (const k of ['x', 'y', 'z', 'vy', 'hp', 'stamina', 'staminaMax', 'yaw', 'coldAcc']) sim.player[k] = recorded[k];
  Object.assign(sim.player, { state: 'airborne', grounded: false, gliding: false, climbing: false, vx: 0, vz: 0, coyote: 0, jumpBuf: 0, invuln: 0 });
  // Controlled vertical column: recorded impact x/z, earlier recorded y/vy.
  if (earlyDescent) Object.assign(sim.player, { y: early.y, vy: early.vy });
  sim.damageEvidence = [];
  const hurt = sim.hurt.bind(sim);
  sim.hurt = (amount, source) => { sim.damageEvidence.push({ amount, source }); return hurt(amount, source); };
  sim.cam.yaw = recorded.camYaw;
  return sim;
}
function frame(sim) { sim.step(FIXED_DT, takeSimActions({ consumeCommands: true, consumeLook: true })); }
function snapshot(sim) { return { ...sim.player, mode: sim.mode, camYaw: sim.cam.yaw }; }
test('controlled production Sim/input: recorded fast fall and early queued glide', t => {
  function run(glide, earlyDescent = false) {
    const sim = simFixture(earlyDescent), frames = [];
    if (glide) { pressKeyForTest('Space'); releaseKeyForTest('Space'); }
    for (let i = 0; i < 600; i++) {
      frame(sim); frames.push(snapshot(sim));
      if (sim.player.grounded) { frames.damage = sim.damageEvidence; return frames; }
    }
    assert.fail('no natural landing');
  }
  const late = run(false), tooLate = run(true);
  assert.equal(late.at(-1).hp, 1);
  assert.deepEqual(late.damage, [{ amount: 1.5, source: '坠落' }]);
  assert.equal(tooLate.at(-1).hp, 1);
  const baseline = run(false, true), glide = run(true, true);
  assert.equal(baseline.at(-1).hp, 1);
  assert.equal(glide[0].state, 'gliding');
  assert.equal(glide.damage.filter(d => d.source === '坠落').length, 0);
  assert.equal(glide.at(-1).hp, 2);
  const first = baseline.findIndex((s, i) => s.state !== glide[i]?.state || s.vy !== glide[i]?.vy);
  assert.equal(first, 0);
  t.diagnostic(JSON.stringify({ controlledUnitOnly: true, firstDifferingFrame: first + 1, baselineFirst: baseline[0], glideFirst: glide[0], baselineLandingFrame: baseline.length, glideLandingFrame: glide.length, glideDamage: glide.damage }));
});
function harness({ observations, stamina = 108, accept = true, onWait, real = false } = {}) {
  let ms = 0, reads = 0;
  const sim = real ? simFixture(true) : null;
  let s = { mode: 'playing', hp: 2.5, x: 0, z: 0, camYaw: 0, state: 'airborne', vy: -3, stamina, grounded: false };
  const events = [], waits = [], seen = [], held = new Set();
  const scope = { abort: createAbortLatch(), markInput() {} };
  const nav = createRouteNavigation({
    page: { keyboard: {
      press: async k => { events.push(['press', k]); if (real) { pressKeyForTest(k); releaseKeyForTest(k); } else if (accept) s = { ...s, state: 'gliding' }; },
      down: async k => { events.push(['down', k]); held.add(k); if (real) pressKeyForTest(k); },
      up: async k => { held.delete(k); if (real) releaseKeyForTest(k); },
    } },
    read: async () => { const value = real ? snapshot(sim) : { ...s, ...observations?.(reads++) }; seen.push(value); return value; },
    wait: async n => { ms += n; waits.push(n); if (real) for (let i = 0; i < Math.round(n / (FIXED_DT * 1000)); i++) frame(sim); onWait?.(scope); },
    now: () => ms, ensureOpen() {}, MOVE_CODES: ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'],
    releaseAll: async () => { for (const k of held) if (real) releaseKeyForTest(k); held.clear(); },
    note: m => events.push(['note', m]), state: {},
  });
  return { nav, scope, events, waits, seen, held, sim, now: () => ms };
}
test('E26 controlled production Sim natural landing retains actual deferred and accepted decisions', async () => {
  const f = harness({ real: true });
  const orch = createFightOrchestrator({ ...f.nav, now: f.now });
  await orch.goTo(recorded.x, recorded.z, 20000, { safeDescent: true, arrive: 100,
    label: 'controlled-Sim-natural-landing' });
  const e = orch.getNavigationEvidence();
  assert.equal(e.active, null);
  const event = e.completed[0];
  assert.equal(event.outcome, 'arrived');
  assert.equal(event.final.stage, 'read');
  assert.equal(event.finalSnapshot.grounded, true);
  assert.ok(event.decisions.slice(0, -1).every(d => d.deferredArrival === 'gliding' && !d.arrived));
  assert.ok(event.decisions.length > 1);
  const accepted = event.decisions.at(-1);
  assert.equal(accepted.deferredArrival, null);
  assert.equal(accepted.arrived, true);
  assert.equal(accepted.grounded, true);
  assert.equal(accepted.t, f.now());
  assert.equal(event.final.lastDecisionAt, f.now());
  assert.equal(event.final.deadline, 20000);
});
test('actual factory with production Sim queue observes glide, presses once and lands without fall damage', async () => {
  const f = harness({ real: true });
  const orch = createFightOrchestrator({ ...f.nav, now: () => 0 });
  await orch.goTo(recorded.x, recorded.z, 20000, { safeDescent: true, arrive: 100 });
  assert.ok(f.seen.some(s => s.state === 'gliding'));
  assert.equal(f.sim.player.grounded, true);
  assert.equal(f.sim.damageEvidence.filter(d => d.source === '坠落').length, 0);
  assert.equal(f.sim.player.hp, 2);
  assert.equal(f.events.filter(e => e[0] === 'press').length, 1);
});
test('factory accepts glide before direction; never toggles again while gliding', async () => {
  const f = harness();
  await f.nav.goTo(20, 0, 500, { safeDescent: true });
  assert.deepEqual(f.events.filter(e => e[0] === 'press'), [['press', 'Space']]);
  assert.equal(f.events[0][0], 'press');
  assert.ok(f.seen.some(s => s.state === 'gliding'));
});
for (const scoped of [false, true]) test(`no opt-in unchanged, scoped=${scoped}`, async () => {
  const f = harness();
  try { await f.nav.goTo(20, 0, 220, {}, scoped ? f.scope : undefined); } catch (e) { assert.equal(e.reason, 'navigation-failed'); }
  assert.equal(f.events.filter(e => e[0] === 'press').length, 0);
  assert.ok(f.events.some(e => e[0] === 'down'));
});
for (const low of [true, false]) test(`explicit descent stop: ${low ? 'stamina' : 'no transition'}`, async () => {
  const f = harness({ stamina: low ? 8 : 108, accept: false });
  await assert.rejects(f.nav.goTo(20, 0, 2000, { safeDescent: true }, f.scope), e => e.reason === (low ? 'glide-unavailable' : 'glide-not-started'));
  assert.equal(f.scope.navigationFailure.nav.status, low ? 'glide-unavailable' : 'glide-not-started');
  assert.deepEqual(f.waits, low ? [] : [100, 100, 100]);
  assert.equal(f.events.filter(e => e[0] === 'press').length, low ? 0 : 1);
  assert.equal(f.events.filter(e => e[0] === 'down').length, 0);
});
test('transition observation waits retain shared abort', async () => {
  const f = harness({ accept: false, onWait: scope => scope.abort.abort('player-hp-drop') });
  await assert.rejects(f.nav.goTo(20, 0, 2000, { safeDescent: true }, f.scope), e => e.reason === 'player-hp-drop');
  assert.deepEqual(f.waits, [100]);
  assert.equal(f.held.size, 0);
});
test('landing rearms a later separate descent, including across goTo calls', async () => {
  const f = harness({ observations: n => n === 2 ? { state: 'grounded', grounded: true } : n === 3 ? { state: 'airborne', grounded: false, vy: -3 } : {} });
  await f.nav.goTo(20, 0, 220, { safeDescent: true });
  await f.nav.goTo(20, 0, 220, { safeDescent: true });
  assert.equal(f.events.filter(e => e[0] === 'press').length, 2);
});
test('accepted glide lost before landing stops without another Space across calls', async () => {
  const f = harness({ observations: n => n >= 3 ? { state: 'airborne', grounded: false, vy: -4 } : {} });
  await f.nav.goTo(20, 0, 220, { safeDescent: true });
  const result = await f.nav.goTo(20, 0, 500, { safeDescent: true });
  assert.equal(result.nav.status, 'glide-not-started');
  assert.equal(f.events.filter(e => e[0] === 'press').length, 1);
});
for (const vy of [NaN, Infinity, -2.9]) test(`no descent trigger at vy=${vy}`, async () => {
  const f = harness({ observations: () => ({ vy }) });
  await f.nav.goTo(20, 0, 220, { safeDescent: true });
  assert.equal(f.events.filter(e => e[0] === 'press').length, 0);
});
test('already gliding never receives Space and midair proximity is not landing success', async () => {
  const f = harness({ observations: () => ({ state: 'gliding' }) });
  const s = await f.nav.goTo(0, 0, 220, { safeDescent: true });
  assert.equal(s.nav.arrived, false);
  assert.equal(f.events.filter(e => e[0] === 'press').length, 0);
});
test('only two labelled crown legs opt in at both production call sites', () => {
  const source = readFileSync(new URL('../play-routes.mjs', import.meta.url), 'utf8') +
    readFileSync(new URL('./citadel-handoff.mjs', import.meta.url), 'utf8');
  const lines = source.split('\n').filter(l => l.includes('safeDescent: true'));
  assert.equal(lines.length, 4);
  for (const line of lines) assert.match(line, /await fightGoTo\(.*label: "citadel-(?:off|from)-crown", safeDescent: true/);
});
