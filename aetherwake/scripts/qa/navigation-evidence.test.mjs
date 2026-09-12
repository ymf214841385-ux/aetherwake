import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouteNavigation, CombatReady } from './route-navigation.mjs';
import { createFightOrchestrator, createCombatProgressMonitor } from './combat-progress-monitor.mjs';

// Labelled controlled fixture, NOT a browser replay or an inferred active route.
// Root run40262 t39814: s-0 nearby, HP2->1. Only the recorded pose is reused.
const rootPose = { x: 24.259, y: 10.495, z: -40.324, vy: -.367 };
// Same run's final HP1->0 pose; fixture timing remains controlled.
const rootDeathPose = { x: 24.007, y: 10.142, z: -38.277 };
function fixture({ onWait, onRead, onUp, initial = {}, controlClockOffset = 0 } = {}) {
  let t = 39814, reads = 0, sampling = false, sampleWait;
  let s = { ...rootPose, mode: 'playing', hp: 1, state: 'airborne', grounded: false,
    stamina: 30, camYaw: 0, sealOpen: true, bossMeleeBlocked: false,
    boss: { x: 6, y: 10, z: 0, hp: 20, alive: true, phase: 'patrol' }, ...initial };
  const held = new Set(), inputs = [], decisionReads = [];
  let orch;
  const read = async () => {
    reads++;
    onRead?.(f, reads);
    if (!sampling) decisionReads.push({ t, s: structuredClone(s) });
    return structuredClone(s);
  };
  const releaseAll = async () => { held.clear(); };
  const nav = createRouteNavigation({
    now: () => t + controlClockOffset, read, releaseAll, state: {}, ensureOpen() {}, note() {},
    MOVE_CODES: ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'Space'],
    page: { keyboard: {
      down: async k => { inputs.push(['down', k]); held.add(k); },
      up: async k => { inputs.push(['up', k]); held.delete(k); onUp?.(f); },
      press: async k => inputs.push(['press', k]),
    } },
    wait: async ms => { t += ms; await onWait?.(f, ms); },
    shrineWorldOrigin: () => ({ x: 100, z: 100 }),
  });
  orch = createFightOrchestrator({ ...nav, read, releaseAll, now: () => t,
    // Drive the EXISTING serial sampler explicitly; no real timer/browser.
    wait: () => new Promise(resolve => { sampleWait = resolve; }),
  });
  const f = { nav, orch, held, inputs, decisionReads, now: () => t,
    set: changes => { s = { ...s, ...changes }; },
    sample: async () => {
      sampling = true;
      if (!sampleWait) orch.startSampling();
      else { const resume = sampleWait; sampleWait = null; resume(); }
      for (let i = 0; i < 10; i++) await Promise.resolve();
      sampling = false;
    },
    stop: async () => { const p = orch.stopSampling(); sampleWait?.(); await p; },
  };
  return f;
}

test('controlled root pose: settlement yields to actual glide; hold/monitor grounding waits for next decision', async () => {
  let holds = 0;
  const f = fixture({ onWait: async f => {
    holds++;
    f.set(holds <= 3 ? { state: 'gliding', grounded: false } : { state: 'grounded', grounded: true });
    await f.sample();
  } });
  f.orch.scope.initialApproach = true;
  const result = await f.orch.goTo(24, -40, 2000, { label: 'controlled-root-pose', arrive: 5, safeDescent: true });
  assert.equal(result.nav.arrived, true);
  const evidence = f.orch.getNavigationEvidence();
  assert.equal(evidence.active, null);
  const event = evidence.completed.at(-1);
  assert.equal(event.outcome, 'arrived');
  assert.equal(event.final.label, 'controlled-root-pose');
  assert.equal(event.final.startedAt, 39814);
  assert.equal(event.final.deadline, 41814);
  assert.equal(event.final.stage, 'read');
  assert.equal(event.finalSnapshot.grounded, true);
  assert.deepEqual(event.decisions.map(d => d.deferredArrival), ['airborne', 'airborne', 'gliding', 'gliding', null]);
  assert.deepEqual(event.decisions.map(d => d.arrived), [false, false, false, false, true]);
  assert.deepEqual(event.decisions.map(d => d.t), [39814, 39814, 39914, 39914, 40134]);
  assert.deepEqual(event.decisions.filter(d => d.stage === 'settling').map(d => d.settlement), ['observe', 'gliding']);
  assert.ok(event.decisions.every(d => d.navigationOutcome.arrived));
  assert.ok(event.decisions.every(d => f.decisionReads.some(r => r.t === d.t)));
  const groundedHold = f.orch.monitor.ring.find(r => r.grounded);
  assert.equal(groundedHold.activeNavigation.stage, 'hold');
  assert.equal(groundedHold.lastNavigationDecisionAt, 39914);
  assert.equal(groundedHold.activeNavigation.lastDecision.deferredArrival, 'gliding');
  const frozen = structuredClone(groundedHold.activeNavigation);
  await f.sample();
  assert.equal(f.orch.monitor.ring.at(-1).activeNavigation, null);
  assert.deepEqual(groundedHold.activeNavigation, frozen);
  await f.orch.goTo(24, -40, 1000, { label: 'next-label', arrive: 5 });
  const next = f.orch.getNavigationEvidence().completed.at(-1);
  assert.notEqual(next.final.id, event.final.id);
  assert.equal(next.final.label, 'next-label');
  assert.equal(next.decisions.length, 1);
  assert.equal(next.final.safeDescent, false);
  assert.equal(f.held.size, 0);
  await f.stop();
});

for (const kind of ['abort', 'death', 'CombatReady', 'release-death', 'read-error']) {
  test(`actual held navigation ${kind}: original first cause, release, completion and cleared active metadata`, async () => {
    const f = fixture({ initial: { x: 30, state: 'grounded', grounded: true },
      onWait: f => {
        if (kind === 'abort') f.orch.abort.abort('root-stop', f.now());
        if (kind === 'death') f.set({ ...rootDeathPose, hp: 0 });
        if (kind === 'CombatReady' || kind === 'release-death') f.set({ x: 6, z: 1 });
      },
      onRead: (_f, n) => { if (kind === 'read-error' && n > 1) throw new Error('controlled-read'); },
      onUp: f => { if (kind === 'release-death') f.orch.abort.abort('death', f.now()); },
    });
    f.orch.scope.initialApproach = true;
    let original;
    await assert.rejects(f.orch.goTo(24, -40, 2000, { label: kind, arrive: 1 }), err => {
      original = err;
      return kind.includes('CombatReady') || kind === 'release-death' ? err instanceof CombatReady
        : err.reason === (kind === 'abort' ? 'root-stop' : kind === 'read-error' ? 'read-error:controlled-read' : 'death');
    });
    assert.ok(original);
    assert.equal(f.held.size, 0);
    const e = f.orch.getNavigationEvidence();
    assert.equal(e.active, null);
    assert.equal(e.completed.length, 1);
    const event = e.completed[0];
    assert.equal(event.outcome, kind === 'CombatReady' ? 'combat-ready' : 'failure');
    assert.equal(event.reason, kind === 'CombatReady' ? 'CombatReady' : kind === 'abort' ? 'root-stop'
      : kind === 'read-error' ? 'read-error:controlled-read' : 'death');
    assert.equal(event.final.stage, 'hold');
    assert.equal(event.decisions.length, 1); // in-hold checkedRead never runs navigationOutcome
    if (kind === 'death') {
      assert.equal(event.finalSnapshot.hp, 0);
      for (const k of ['x', 'y', 'z']) assert.equal(event.finalSnapshot[k], rootDeathPose[k]);
    }
    if (kind === 'CombatReady') assert.equal(f.orch.abort.reason, null);
    assert.deepEqual(f.inputs.filter(i => i[0] === 'up').map(i => i[1]),
      f.inputs.filter(i => i[0] === 'down').map(i => i[1]).reverse());
  });
}

test('settlement deadline retains actual final decision and failure snapshot; unscoped returns failure', async () => {
  for (const scoped of [true, false]) {
    const f = fixture();
    const run = () => scoped ? f.orch.goTo(24, -40, 220, { safeDescent: true })
      : f.nav.goTo(24, -40, 220, { safeDescent: true });
    if (scoped) await assert.rejects(run(), e => e.reason === 'descent-landing-not-observed');
    else assert.equal((await run()).nav.status, 'descent-landing-not-observed');
    const e = scoped ? f.orch.getNavigationEvidence() : f.nav.getNavigationEvidence();
    assert.equal(e.active, null);
    assert.equal(e.completed[0].outcome, 'failure');
    const d = e.completed[0].decisions.at(-1);
    assert.equal(d.timedOut, true);
    assert.equal(d.navigationOutcome.arrived, true);
    assert.equal(d.arrived, false);
    assert.equal(d.deferredArrival, 'airborne');
    assert.equal(d.stage, 'settling');
    assert.equal(d.settlement, 'descent-landing-not-observed');
  }
});

test('completed calls bounded to latest16, returned evidence is cloned', async () => {
  const f = fixture({ initial: { state: 'grounded', grounded: true } });
  for (let i = 0; i < 20; i++) await f.orch.goTo(24, -40, 100, { label: `call-${i}` });
  const e = f.orch.getNavigationEvidence();
  assert.equal(e.completed.length, 16);
  assert.equal(e.completed[0].final.label, 'call-4');
  e.completed[0].final.label = 'mutated';
  assert.equal(f.orch.getNavigationEvidence().completed[0].final.label, 'call-4');
});

test('nested actual leaveShrine goTo restores the parent target, stage and lifetime', async () => {
  const f = fixture({ initial: { x: 100, z: 100, shrine: 0, state: 'grounded', grounded: true },
    onWait: async f => {
      const a = f.orch.getNavigationEvidence().active;
      f.set({ x: a.tx, z: a.tz, shrine: null });
      await f.sample();
    },
  });
  const result = await f.orch.goTo(24, -40, 5000, { label: 'outer', arrive: 1 });
  assert.equal(result.nav.arrived, true);
  const e = f.orch.getNavigationEvidence();
  const [child, parent] = e.completed;
  assert.equal(child.final.label, 'leave-door');
  assert.equal(child.final.parentId, parent.final.id);
  assert.equal(child.final.tx, 100);
  assert.equal(parent.final.label, 'outer');
  assert.equal(parent.final.tx, 24);
  assert.equal(parent.final.tz, -40);
  assert.equal(e.active, null);
  const samples = f.orch.monitor.ring;
  assert.equal(samples[0].activeNavigation.id, child.final.id);
  assert.equal(samples.at(-1).activeNavigation.id, parent.final.id);
  assert.equal(samples.at(-1).activeNavigation.stage, 'read');
  assert.equal(samples.at(-1).lastNavigationDecisionAt, null);
  assert.equal(f.held.size, 0);
  await f.stop();
});

test('monitor clones nested navigation decisions and adds neither decisions nor inputs', () => {
  const monitor = createCombatProgressMonitor({ now: () => 40000 });
  const navigation = { id: 1, tx: 24, tz: -40, stage: 'hold', lastDecisionAt: 39814,
    lastDecision: { t: 39814, navigationOutcome: { arrived: true }, deferredArrival: 'airborne' } };
  const before = structuredClone(navigation);
  monitor.observe({ ...rootPose, state: 'grounded', grounded: true }, { navigation });
  assert.deepEqual(navigation, before);
  navigation.lastDecision.navigationOutcome.arrived = false;
  navigation.lastDecisionAt = 40001;
  const sample = monitor.ring[0];
  assert.equal(sample.activeNavigation.lastDecision.navigationOutcome.arrived, true);
  assert.equal(sample.lastNavigationDecisionAt, 39814);
  assert.equal(sample.lastInput, null);
  assert.ok(Math.abs(sample.navigationDistance - Math.hypot(.259, -.324)) < 1e-12);
});

test('pre-aborted orchestrator does not fabricate a call or a decision', async () => {
  const f = fixture();
  f.orch.abort.abort('original-first-cause', f.now());
  await assert.rejects(f.orch.goTo(24, -40, 100), e => e.reason === 'original-first-cause');
  assert.deepEqual(f.orch.getNavigationEvidence(), { active: null, completed: [] });
  assert.equal(f.inputs.length, 0);
  assert.equal(f.decisionReads.length, 0);
});

test('navigation evidence uses monitor now even when the navigation control clock is epoch based', async () => {
  const f = fixture({ controlClockOffset: 1700000000000,
    onWait: async f => { f.set({ state: 'grounded', grounded: true }); await f.sample(); },
  });
  await f.orch.goTo(24, -40, 1000, { arrive: 5, safeDescent: true });
  const event = f.orch.getNavigationEvidence().completed[0];
  assert.equal(event.final.startedAt, 39814);
  assert.equal(event.final.deadline, 40814);
  assert.equal(event.final.lastDecisionAt, f.now());
  assert.equal(event.endedAt, f.now());
  assert.equal(f.orch.monitor.ring[0].lastNavigationDecisionAt, 39814);
  await f.stop();
});

test('play-routes imports actual factory/orchestrator and persists same evidence for stop and both result paths', () => {
  const source = readFileSync(new URL('../play-routes.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ createRouteNavigation,.*from "\.\/qa\/route-navigation.mjs"/);
  assert.match(source, /createFightOrchestrator,[\s\S]*?from "\.\/qa\/combat-progress-monitor.mjs"/);
  assert.match(source, /getNavigationEvidence\(\)/);
  const stop = source.slice(source.indexOf('`citadel-stop-'), source.indexOf('async function readSaveEnvelope'));
  assert.match(stop, /navigationEvidence: orch.getNavigationEvidence\(\)/);
  assert.match(stop, /finally[\s\S]*citadelNavigationEvidence = orch.getNavigationEvidence\(\)/);
  assert.match(stop, /citadelNavigationEvidence.ring = structuredClone\(fightMonitor.ring\)/);
  const report = source.slice(source.indexOf('  const report = {', source.indexOf('function writeReport')),
    source.indexOf('async function teardownBrowser'));
  assert.match(report, /navigationEvidence: citadelNavigationEvidence/);
  assert.match(report, /writeFileSync\(json, JSON.stringify\(report/);
  assert.match(source.slice(source.indexOf('"citadel-resume.json"')), /navigationEvidence: citadelNavigationEvidence/);
});
