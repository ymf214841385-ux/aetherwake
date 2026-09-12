import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouteNavigation } from './route-navigation.mjs';
import { createFightOrchestrator } from './combat-progress-monitor.mjs';
import { runCitadelInitialApproach, prepareCitadelCombatDecision } from './citadel-handoff.mjs';
import { canAcceptDodge } from './boss-fight-policy.mjs';

const evidence = JSON.parse(readFileSync(new URL('../../../docs/rebuild-evidence/runs/e24-normal-descent/citadel-stop-e24-normal-descent.json', import.meta.url)));
const recorded = t => evidence.ring.find(s => Math.abs(s.t - t) < 1);
// Controlled unit replay of recorded ring fields, NOT a browser replay. The ring
// omits mode/seal/camera/attack fields; these explicit fixture defaults are not
// claimed to be recorded living snapshots. Eligibility uses recorded locomotion.
function ringSnapshot(t) {
  const r = recorded(t);
  return { ...r, mode: r.state === 'dead' ? 'dead' : 'playing', sealOpen: true,
    bossDead: false, camYaw: 0, attackPhase: 'idle', prompt: '挑战空王',
    boss: { x: r.bossX, y: r.bossY, z: r.bossZ, hp: r.bossHp, phase: r.bossPhase, alive: true } };
}
const near = ringSnapshot(55268);
const far = { ...near, x: 30, z: 30 };
const dead = ringSnapshot(55981);

function fixture({ next = near, first = far, dieAfter = true, stopFirstHpDrop = false, onUp } = {}) {
  let t = 0, reads = 0;
  let override;
  const events = [], held = new Set();
  const read = async () => {
    reads++;
    const s = override ?? (t === 0 ? first : t < 400 || !dieAfter ? next : dead);
    events.push(['read', s]);
    return s;
  };
  const wait = async ms => { t += ms; await f.onWait?.(); };
  const releaseAll = async () => { held.clear(); events.push(['release-all']); };
  const nav = createRouteNavigation({
    page: { keyboard: {
      down: async k => { held.add(k); events.push(['down', k]); },
      up: async k => { held.delete(k); events.push(['up', k]); await onUp?.(orch, k); },
      press: async k => events.push(['press', k]),
    }, getByRole: () => ({ count: async () => 0 }) },
    read, wait, now: () => t, ensureOpen() {}, releaseAll,
    MOVE_CODES: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyC', 'Space', 'KeyE', 'Escape', 'ArrowLeft', 'ArrowRight'],
    note: s => events.push(['note', s]), state: {},
    focusPlaySurface: async () => events.push(['focus']),
    clickCanvas: async () => {},
  });
  const orch = createFightOrchestrator({ ...nav, read, wait, now: () => t, releaseAll, stopFirstHpDrop });
  const f = { nav, orch, events, held, read, wait,
    setSnapshot(s) { override = s; }, get reads() { return reads; } };
  return f;
}

function initialApproach(f, { waypoints = [{ x: 0, z: -20 }, { x: 100, z: 100 }], citadel = { x: 6, z: -8 } } = {}) {
  return runCitadelInitialApproach({
    scope: f.orch.scope, fightRead: () => f.nav.checkedRead(f.orch.scope),
    fightGoTo: f.orch.goTo, fightFollow: f.orch.follow,
    tap: f.nav.tap, wait: f.wait, note: s => f.events.push(['note', s]),
    WAYPOINTS: { citadel: waypoints }, POI: { citadel },
  });
}

test('actual follow yields CombatReady on recorded windup before more Shift or next target', async () => {
  const f = fixture();
  f.orch.scope.initialApproach = true;
  await assert.rejects(f.orch.follow([{ x: 0, z: -20 }, { x: 100, z: 100 }], 1000, 1), e => {
    assert.equal(e.name, 'CombatReady');
    assert.equal(e.snapshot, near);
    return true;
  });
  assert.equal(f.orch.abort.aborted, false);
  assert.equal(f.held.size, 0);
  const i = f.events.findIndex(e => e[0] === 'read' && e[1] === near);
  assert.ok(i >= 0);
  assert.equal(f.events.slice(i + 1).filter(e => e[0] === 'down').length, 0);
  assert.equal(near.nav, undefined);
});

test('actual entry/follow and policy/dispatcher preserve recorded windup, skip gate/E and select legal dodge', async () => {
  const f = fixture();
  const entry = await initialApproach(f);
  assert.equal(entry.combatReady, true);
  assert.equal(entry.snapshot, near);
  assert.equal(entry.snapshot.nav, undefined);
  assert.equal(f.orch.scope.initialApproach, false);
  assert.equal(f.orch.abort.reason, null);
  assert.equal(f.orch.scope.navigationFailure, undefined);
  assert.equal(f.orch.monitor.latched, null);
  assert.equal(f.held.size, 0);
  const readIndex = f.events.findIndex(e => e[0] === 'read' && e[1] === near);
  assert.ok(f.events.slice(0, readIndex).some(e => e[0] === 'down' && e[1] === 'ShiftLeft'));
  assert.ok(f.events.slice(readIndex).some(e => e[0] === 'up' && e[1] === 'ShiftLeft'));
  assert.equal(f.events.slice(readIndex).filter(e => e[0] === 'down' || e[0] === 'press').length, 0);
  const before = f.reads;
  // If the entry turn rereads or rotates first, it would lose the windup.
  f.setSnapshot(dead);
  const turn = await prepareCitadelCombatDecision({
    snapshot: entry.snapshot, preserveSnapshot: entry.combatReady, scope: f.orch.scope,
    lookToward: f.nav.lookToward, fightRead: () => f.nav.checkedRead(f.orch.scope),
  });
  assert.equal(f.reads, before);
  assert.equal(f.events.some(e => e[0] === 'focus'), false);
  assert.equal(turn.snapshot, near);
  assert.equal(turn.snapshot.boss.phase, 'windup');
  assert.equal(canAcceptDodge(turn.snapshot), true);
  assert.equal(turn.step.decision.action, 'dodge');
  assert.equal(turn.step.act, 'dodge');
  assert.equal(turn.step.swing, false);
});

test('recorded first combat-band observation hands off at t54762; t55981 stays lethal', async () => {
  const band = ringSnapshot(54762);
  assert.ok(Math.abs(Math.hypot(band.x - band.boss.x, band.z - band.boss.z) - 7.947) < .01);
  const entry = await initialApproach(fixture({ next: band }));
  assert.equal(entry.snapshot, band);
  assert.equal(entry.combatReady, true);
  const f = fixture({ next: dead });
  await assert.rejects(initialApproach(f), e => e.name === 'FightStopError' && e.reason === 'death');
  assert.equal(f.orch.scope.initialApproach, false);
  assert.equal(f.held.size, 0);
});

for (const [name, changes] of [
  ['wall blocked', { bossMeleeBlocked: true }],
  ['LOS missing', { bossMeleeBlocked: undefined }],
  ['outside eight', { x: near.boss.x + 8.001, z: near.boss.z }],
  ['high difference', { y: near.boss.y + 3.001 }],
  ['missing height', { y: undefined }],
  ['invalid coordinate', { x: NaN }],
  ['not playing', { mode: 'paused' }],
  ['closed seal', { sealOpen: false }],
  ['missing seal', { sealOpen: undefined }],
  ['boss dead flag', { bossDead: true }],
  ['boss not alive', { boss: { ...near.boss, alive: false } }],
  ['boss alive missing', { boss: { ...near.boss, alive: undefined } }],
  ['boss zero HP', { boss: { ...near.boss, hp: 0 } }],
  ['missing boss', { boss: null }],
  ['missing player HP', { hp: undefined }],
]) test(`actual scoped read refuses handoff: ${name}`, async () => {
  const s = { ...near, ...changes };
  const f = fixture({ first: s });
  f.orch.scope.initialApproach = true;
  assert.equal(await f.nav.checkedRead(f.orch.scope), s);
  assert.equal(f.orch.abort.aborted, false);
});

test('eight horizontal and three vertical boundary is inclusive', async () => {
  const s = { ...near, x: near.boss.x + 8, z: near.boss.z, y: near.boss.y + 3 };
  const entry = await initialApproach(fixture({ first: s }));
  assert.equal(entry.snapshot, s);
  assert.equal(entry.combatReady, true);
});

for (const [name, changes] of [
  ['mode', { mode: 'dead' }], ['state', { state: 'dead' }], ['HP', { hp: 0 }],
]) test(`death ${name} remains failure at otherwise ready pose`, async () => {
  const f = fixture({ next: { ...near, ...changes } });
  await assert.rejects(initialApproach(f), e => e.name === 'FightStopError' && e.reason === 'death');
  assert.equal(f.orch.scope.initialApproach, false);
  assert.equal(f.held.size, 0);
});

test('E23 first HP drop outranks ready signal and preserves its evidence', async () => {
  const f = fixture({ first: { ...far, hp: 2.5 }, stopFirstHpDrop: true });
  await assert.rejects(initialApproach(f), e => e.name === 'FightStopError' && e.reason === 'player-hp-drop');
  assert.equal(f.orch.monitor.latched.post.snap.boss.phase, 'windup');
  assert.equal(f.orch.monitor.latched.to, 1);
  assert.equal(f.orch.scope.initialApproach, false);
  assert.equal(f.held.size, 0);
});

for (const reason of ['navigation-failed', 'read-error:fixture', 'combat-no-damage']) {
  test(`preexisting ${reason} outranks initial handoff`, async () => {
    const f = fixture({ first: near });
    f.orch.abort.abort(reason);
    await assert.rejects(initialApproach(f), e => e.name === 'FightStopError' && e.reason === reason);
    assert.equal(f.reads, 0);
    assert.equal(f.orch.scope.initialApproach, false);
  });
}

test('death while CombatReady unwinds key-up wins at approach catch; all keys released', async () => {
  const f = fixture({ onUp: orch => orch.abort.abort('death') });
  await assert.rejects(initialApproach(f), e => e.name === 'FightStopError' && e.reason === 'death');
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.scope.initialApproach, false);
});

test('failure after handoff but before policy retains priority over captured state', async () => {
  const f = fixture();
  const entry = await initialApproach(f);
  f.orch.abort.abort('death');
  await assert.rejects(prepareCitadelCombatDecision({ snapshot: entry.snapshot,
    preserveSnapshot: true, scope: f.orch.scope }),
    e => e.name === 'FightStopError' && e.reason === 'death');
});

test('key-up error does not consume CombatReady or prevent remaining key releases', async () => {
  const f = fixture({ onUp: (_orch, k) => { if (k === 'ShiftLeft') throw new Error('fixture key-up'); } });
  const entry = await initialApproach(f);
  assert.equal(entry.combatReady, true);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.abort.reason, null);
  assert.deepEqual(f.events.filter(e => e[0] === 'up').map(e => e[1]),
    f.events.filter(e => e[0] === 'down').map(e => e[1]).reverse());
});

test('handoff inside crown descent skips second leg and follow', async () => {
  const f = fixture({ first: { ...far, y: 53 } });
  const entry = await initialApproach(f);
  assert.equal(entry.snapshot, near);
  assert.equal(f.events.filter(e => e[0] === 'down' && e[1] === 'ShiftLeft').length, 0);
  assert.equal(f.events.filter(e => e[0] === 'note').length, 1);
  assert.equal(f.held.size, 0);
});

test('handoff inside gate skips E and clears guard', async () => {
  const f = fixture({ first: { ...far } });
  const entry = await initialApproach(f, { waypoints: [{ x: far.x, z: far.z }] });
  assert.equal(entry.combatReady, true);
  assert.equal(entry.snapshot, near);
  assert.equal(f.events.some(e => e[0] === 'press'), false);
  assert.equal(f.orch.scope.initialApproach, false);
});

test('normal approach still arrives and interacts; actual navigation timeout still fails', async () => {
  const s = { ...near, bossMeleeBlocked: true };
  const f = fixture({ first: s, next: s, dieAfter: false });
  const entry = await initialApproach(f, { waypoints: [{ x: s.x, z: s.z }], citadel: { x: s.x, z: s.z - 8 } });
  assert.equal(entry.combatReady, false);
  assert.equal(entry.snapshot.nav.arrived, true);
  assert.deepEqual(f.events.filter(e => e[0] === 'press'), [['press', 'KeyE']]);
  assert.equal(f.orch.scope.initialApproach, false);
  const blocked = fixture({ first: far, next: far, dieAfter: false });
  await assert.rejects(initialApproach(blocked), e => e.name === 'FightStopError' && e.reason === 'navigation-failed');
  assert.equal(blocked.orch.scope.navigationFailure.nav.tx, 0);
  assert.equal(blocked.orch.scope.initialApproach, false);
});

test('later combat reposition and ordinary policy preparation do not hand off again', async () => {
  const f = fixture({ dieAfter: false });
  await initialApproach(f);
  const start = { ...near };
  const target = { ...near, x: near.x + 2 };
  f.setSnapshot(start);
  f.onWait = () => f.setSnapshot(target);
  const moved = await f.orch.goTo(target.x, target.z, 1000, { arrive: .5, sprint: false, label: 'combat-reposition' });
  assert.equal(moved.nav.arrived, true);
  assert.equal(f.orch.abort.reason, null);
  assert.equal(f.orch.scope.initialApproach, false);
  const before = f.reads;
  const aligned = { ...near, boss: { ...near.boss, phase: 'recover' },
    camYaw: Math.atan2(-(near.boss.x - near.x), -(near.boss.z - near.z)) };
  f.setSnapshot(aligned);
  const turn = await prepareCitadelCombatDecision({ snapshot: aligned, scope: f.orch.scope,
    lookToward: f.nav.lookToward, fightRead: () => f.nav.checkedRead(f.orch.scope) });
  assert.ok(f.reads > before);
  assert.equal(turn.snapshot, aligned);
  assert.equal(turn.step.act, 'approach');
});

test('captured melee pose keeps wait-facing policy and its diagnostic alignment value', async () => {
  const s = { ...near, x: near.boss.x, z: near.boss.z + 2.2,
    camYaw: Math.PI, boss: { ...near.boss, phase: 'recover' } };
  const f = fixture({ first: s });
  const entry = await initialApproach(f);
  const turn = await prepareCitadelCombatDecision({ snapshot: entry.snapshot,
    preserveSnapshot: true, scope: f.orch.scope });
  assert.equal(turn.step.act, 'wait-facing');
  assert.equal(turn.step.swing, false);
  assert.equal(turn.faceDot.toFixed(2), '-1.00');
});

test('play-routes wires tested entry and consumes its snapshot only on the first policy turn', () => {
  const source = readFileSync(new URL('../play-routes.mjs', import.meta.url), 'utf8');
  const fight = source.slice(source.indexOf('async function fightBoss()'), source.indexOf('async function readSaveEnvelope()'));
  assert.match(source, /import \{ runCitadelInitialApproach, runCitadelLosReposition, prepareCitadelCombatDecision \} from "\.\/qa\/citadel-handoff.mjs"/);
  assert.match(fight, /await runCitadelInitialApproach\(\{\s*scope: orch.scope, fightRead, fightGoTo, fightFollow, tap, wait, note, WAYPOINTS, POI/);
  assert.match(fight, /let s = entry.snapshot;\s*let pendingCombatSnapshot = entry.combatReady \? s : null/);
  assert.match(fight, /const handoffSnapshot = pendingCombatSnapshot;\s*pendingCombatSnapshot = null;\s*s = handoffSnapshot \?\? await fightResume\(\);\s*checkFightScope\(orch.scope, s\)/);
  assert.match(fight, /await prepareCitadelCombatDecision\(\{\s*snapshot: s, preserveSnapshot: handoffSnapshot !== null,\s*scope: orch.scope, lookToward, fightRead/);
  assert.match(fight, /const faceDot = prepared.faceDot/);
  assert.ok(fight.indexOf('orch.startSampling()') < fight.indexOf('await runCitadelInitialApproach('));
  assert.doesNotMatch(fight, /instanceof CombatReady|citadelFightStep\(/);
});
