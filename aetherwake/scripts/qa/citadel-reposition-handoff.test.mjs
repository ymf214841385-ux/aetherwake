import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatReady, createRouteNavigation } from './route-navigation.mjs';
import { createFightOrchestrator } from './combat-progress-monitor.mjs';
import { prepareCitadelCombatDecision, runCitadelLosReposition } from './citadel-handoff.mjs';

// Controlled read-only observations, not a replay of browser physics. Actual
// navigation, pause, checkedRead, abort and key-release paths remain in use.
function snapshot(overrides = {}) {
  return {
    mode: 'playing', state: 'grounded', grounded: true, hp: 1, stamina: 108,
    x: 6, y: 10, z: 3, camYaw: 0, vy: 0, shrine: null,
    sealOpen: true, bossDead: false, bossMeleeBlocked: false,
    boss: { x: 6, y: 10, z: 0, hp: 20, alive: true, phase: 'windup' },
    ...overrides,
  };
}

function fixture({ first = snapshot({ bossMeleeBlocked: true }),
  next = snapshot(), enabled = true, onWait, onUp, readError } = {}) {
  let time = 0;
  const events = [], held = new Set();
  const read = async () => {
    if (time > 0 && readError) throw new Error(readError);
    const s = time === 0 ? first : next;
    events.push({ kind: 'read', at: time, snapshot: s });
    return s;
  };
  const wait = async ms => {
    events.push({ kind: 'wait', at: time, ms });
    time += ms;
    await onWait?.(f);
  };
  const releaseAll = async () => {
    for (const key of [...held]) {
      held.delete(key);
      events.push({ kind: 'up', at: time, key });
    }
  };
  const nav = createRouteNavigation({
    page: { keyboard: {
      down: async key => { held.add(key); events.push({ kind: 'down', at: time, key }); },
      up: async key => {
        held.delete(key);
        events.push({ kind: 'up', at: time, key });
        await onUp?.(f, key);
      },
    } },
    read, wait, now: () => time, ensureOpen() {}, releaseAll,
    MOVE_CODES: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'],
    note: message => events.push({ kind: 'note', at: time, message }), state: {},
  });
  const orch = createFightOrchestrator({ ...nav, read, wait, now: () => time, releaseAll });
  orch.scope.initialApproach = false;
  orch.scope.combatReposition = enabled;
  const f = { nav, orch, read, wait, releaseAll, held, events, first, next,
    get time() { return time; } };
  return f;
}

function assertReleasedAtFirstClearRead(f) {
  assert.equal(f.time, 100);
  assert.equal(f.held.size, 0);
  const index = f.events.findIndex(e => e.kind === 'read' && e.snapshot === f.next);
  assert.ok(index >= 0, 'must observe the actual clear-LOS snapshot');
  assert.equal(f.events[index].at, 100);
  assert.equal(f.events.slice(index + 1).some(e => e.kind === 'down'), false);
  assert.deepEqual(f.events.filter(e => e.kind === 'up').map(e => e.key),
    f.events.filter(e => e.kind === 'down').map(e => e.key).reverse());
  assert.equal(f.orch.abort.aborted, false);
  assert.equal(f.next.nav, undefined, 'handoff must not fabricate waypoint arrival');
}

test('combat reposition holds while blocked, then yields on the actual 100ms clear-LOS read', async () => {
  const f = fixture();
  assert.equal(await f.nav.checkedRead(f.orch.scope), f.first);
  await assert.rejects(f.nav.hold(['KeyW', 'ShiftLeft'], 400, f.orch.scope), err => {
    assert.ok(err instanceof CombatReady);
    assert.equal(err.snapshot, f.next);
    return true;
  });
  assertReleasedAtFirstClearRead(f);
});

test('actual reposition goTo records combat-ready instead of walking to or inventing arrival', async () => {
  const f = fixture();
  await assert.rejects(f.orch.goTo(6, -4, 600, {
    arrive: 0.5, sprint: true, label: 'los-reposition',
  }), err => {
    assert.ok(err instanceof CombatReady);
    assert.equal(err.snapshot, f.next);
    return true;
  });
  assertReleasedAtFirstClearRead(f);
  assert.equal(f.orch.scope.navigationEvidence.active, null);
  const completed = f.orch.scope.navigationEvidence.completed;
  assert.equal(completed.length, 1);
  assert.equal(completed[0].outcome, 'combat-ready');
  assert.equal(completed[0].reason, 'CombatReady');
  assert.equal(completed[0].endedAt, 100);
  assert.equal(completed[0].final.label, 'los-reposition');
  assert.equal(completed[0].final.stage, 'hold');
  assert.deepEqual(completed[0].finalSnapshot, f.next);
  assert.ok(completed[0].decisions.every(d => d.arrived === false));
  assert.equal(f.orch.scope.navigationFailure, undefined);
});

for (const [label, changes] of [
  ['mode', { mode: 'dead' }], ['state', { state: 'dead' }], ['HP', { hp: 0 }],
]) test(`reposition's actual 100ms ${label} death wins over otherwise-ready geometry`, async () => {
  const f = fixture({ next: snapshot(changes) });
  await assert.rejects(f.nav.hold(['KeyW', 'ShiftLeft'], 400, f.orch.scope),
    err => err.name === 'FightStopError' && err.reason === 'death');
  assert.equal(f.time, 100);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.scope.lastSnapshot, f.next);
});

test('a latched failure before the next observation outranks reposition readiness', async () => {
  const f = fixture({ onWait: current => current.orch.abort.abort('combat-no-damage') });
  await assert.rejects(f.nav.hold(['KeyW', 'ShiftLeft'], 400, f.orch.scope),
    err => err.name === 'FightStopError' && err.reason === 'combat-no-damage');
  assert.equal(f.time, 100);
  assert.equal(f.held.size, 0);
  assert.equal(f.events.some(e => e.kind === 'read'), false);
});

test('a scoped read error during reposition fails and releases every key', async () => {
  const f = fixture({ readError: 'reposition-read-failed' });
  await assert.rejects(f.nav.hold(['KeyW', 'ShiftLeft'], 400, f.orch.scope),
    err => err.name === 'FightStopError' && err.reason === 'read-error:reposition-read-failed');
  assert.equal(f.time, 100);
  assert.equal(f.held.size, 0);
});

test('ordinary combat reads and holds without the reposition flag do not hand off', async () => {
  const clear = snapshot();
  const f = fixture({ first: clear, next: clear, enabled: false });
  assert.equal(await f.nav.checkedRead(f.orch.scope), clear);
  await f.nav.hold(['KeyW'], 200, f.orch.scope);
  assert.equal(f.time, 200);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.abort.aborted, false);
});

test('the existing initial-approach hold still hands off with reposition disabled', async () => {
  const f = fixture({ enabled: false });
  f.orch.scope.initialApproach = true;
  await assert.rejects(f.nav.hold(['KeyW'], 400, f.orch.scope),
    err => err instanceof CombatReady && err.snapshot === f.next);
  assertReleasedAtFirstClearRead(f);
});

for (const [label, changes] of [
  ['blocked LOS', { bossMeleeBlocked: true }],
  ['unknown LOS', { bossMeleeBlocked: undefined }],
  ['null LOS', { bossMeleeBlocked: null }],
  ['missing Boss', { boss: null }],
  ['Boss not alive', { boss: { ...snapshot().boss, alive: false } }],
  ['Boss alive unknown', { boss: { ...snapshot().boss, alive: undefined } }],
  ['Boss zero HP', { boss: { ...snapshot().boss, hp: 0 } }],
  ['outside horizontal range', { x: 14.001, z: 0 }],
  ['outside vertical range', { y: 13.001 }],
  ['invalid player coordinate', { x: NaN }],
  ['missing height', { y: undefined }],
  ['invalid Boss coordinate', { boss: { ...snapshot().boss, z: Infinity } }],
  ['missing player HP', { hp: undefined }],
  ['paused mode', { mode: 'paused' }],
  ['closed seal', { sealOpen: false }],
  ['unknown seal', { sealOpen: undefined }],
  ['Boss dead flag', { bossDead: true }],
]) test(`reposition does not yield for ${label}`, async () => {
  const candidate = snapshot(changes);
  const f = fixture({ first: candidate, next: candidate });
  assert.equal(await f.nav.checkedRead(f.orch.scope), candidate);
  await f.nav.hold(['KeyW'], 100, f.orch.scope);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.abort.aborted, false);
});

test('reposition includes the exact eight-metre horizontal and three-metre vertical limits', async () => {
  const edge = snapshot({ x: 14, y: 13, z: 0 });
  const f = fixture({ first: edge });
  await assert.rejects(f.nav.checkedRead(f.orch.scope),
    err => err instanceof CombatReady && err.snapshot === edge);
  assert.equal(f.orch.abort.aborted, false);
});

function reposition(f, start = f.first) {
  return runCitadelLosReposition({
    scope: f.orch.scope, goTo: f.orch.goTo,
    read: () => f.nav.checkedRead(f.orch.scope), start,
    note: message => f.events.push({ kind: 'note', at: f.time, message }),
  });
}

for (const previous of ['absent', false, undefined, true]) {
  test(`wrapper restores previous ${String(previous)} flag after real goTo hands off`, async () => {
    const f = fixture({ onWait: current => {
      assert.equal(current.orch.scope.combatReposition, true);
      assert.equal(current.orch.scope.initialApproach, false);
    } });
    if (previous === 'absent') delete f.orch.scope.combatReposition;
    else f.orch.scope.combatReposition = previous;
    const result = await reposition(f);
    assert.equal(result.ok, true);
    assert.equal(result.combatReady, true);
    assert.equal(result.s, f.next);
    assert.equal(result.rec.arrived, false);
    assert.equal(result.rec.reason, 'combat-ready');
    assert.equal(result.s.nav, undefined);
    assertReleasedAtFirstClearRead(f);
    assert.equal(Object.hasOwn(f.orch.scope, 'combatReposition'), previous !== 'absent');
    assert.equal(f.orch.scope.combatReposition, previous === 'absent' ? undefined : previous);
    assert.equal(f.orch.scope.initialApproach, false);
    const completed = f.orch.scope.navigationEvidence.completed;
    assert.equal(completed.length, 1, 'handoff must not continue to another LOS segment');
    assert.equal(completed[0].outcome, 'combat-ready');
  });
}

test('the wrapper guard ends before an ordinary combat hold after handoff', async () => {
  const f = fixture({ enabled: false });
  const result = await reposition(f);
  assert.equal(result.combatReady, true);
  assert.equal(f.orch.scope.combatReposition, false);
  await f.nav.hold(['KeyW'], 200, f.orch.scope);
  assert.equal(f.time, 300);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.abort.aborted, false);
});

test('wrapper handoff snapshot reaches the real combat preparer without a stale reread or look', async () => {
  const f = fixture({ enabled: false });
  const result = await reposition(f);
  const prepared = await prepareCitadelCombatDecision({
    snapshot: result.s, preserveSnapshot: result.combatReady, scope: f.orch.scope,
    fightRead: async () => assert.fail('handoff must consume its actual snapshot first'),
    lookToward: async () => assert.fail('handoff must not aim before its first decision'),
  });
  assert.equal(prepared.snapshot, f.next);
  assert.equal(prepared.snapshot.boss.phase, 'windup');
  assert.equal(prepared.step.swing, false);
});

test('normal blocked arrival returns an actual failed LOS result and restores an absent flag', async () => {
  const blockedAtTarget = snapshot({ z: -4, bossMeleeBlocked: true });
  const f = fixture({ first: blockedAtTarget });
  delete f.orch.scope.combatReposition;
  const result = await reposition(f);
  assert.equal(result.ok, false);
  assert.equal(result.combatReady, undefined);
  assert.equal(result.s, blockedAtTarget);
  assert.equal(result.rec.reason, 'seg1-still-blocked');
  assert.equal(result.rec.segments[0].arrived, true);
  assert.equal(result.s.nav.arrived, true);
  assert.equal(f.orch.scope.navigationEvidence.completed[0].outcome, 'arrived');
  assert.equal(Object.hasOwn(f.orch.scope, 'combatReposition'), false);
  assert.equal(f.held.size, 0);
});

for (const [label, blocked] of [['clear', false], ['unknown', undefined], ['null', null]]) {
  test(`a ${label} start never enables the wrapper guard, even when the prior flag was true`, async () => {
    const first = snapshot({ bossMeleeBlocked: blocked });
    const atTarget = snapshot({ z: -4 });
    const f = fixture({ first, next: atTarget, enabled: true,
      onWait: current => assert.equal(current.orch.scope.combatReposition, false) });
    const result = await reposition(f);
    assert.equal(result.ok, true);
    assert.equal(result.combatReady, undefined);
    assert.equal(result.s, atTarget);
    assert.equal(result.rec.reason, 'clear-at-gate-interior');
    assert.equal(result.rec.segments[0].arrived, true);
    assert.equal(f.time, 200, 'ordinary hold must not yield at its first 100ms slice');
    assert.equal(f.orch.scope.navigationEvidence.completed[0].outcome, 'arrived');
    assert.equal(f.orch.scope.combatReposition, true);
    assert.equal(f.held.size, 0);
  });
}

test('wrapper restores absence and keeps a scoped read error instead of returning success', async () => {
  const f = fixture({ readError: 'wrapper-read-failed' });
  delete f.orch.scope.combatReposition;
  await assert.rejects(reposition(f), err =>
    err.name === 'FightStopError' && err.reason === 'read-error:wrapper-read-failed');
  assert.equal(Object.hasOwn(f.orch.scope, 'combatReposition'), false);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.scope.navigationEvidence.completed[0].outcome, 'failure');
});

for (const [label, changes] of [
  ['mode', { mode: 'dead' }], ['state', { state: 'dead' }], ['HP', { hp: 0 }],
]) test(`wrapper preserves ${label} death and restores the previous false flag`, async () => {
  const f = fixture({ next: snapshot(changes), enabled: false });
  await assert.rejects(reposition(f), err => err.name === 'FightStopError' && err.reason === 'death');
  assert.equal(f.orch.scope.combatReposition, false);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.scope.navigationEvidence.completed[0].outcome, 'failure');
});

test('late abort during CombatReady key release wins at the wrapper catch and restores the flag', async () => {
  const f = fixture({ enabled: false, onUp: current => current.orch.abort.abort('combat-no-damage') });
  await assert.rejects(reposition(f), err =>
    err.name === 'FightStopError' && err.reason === 'combat-no-damage');
  assert.equal(f.time, 100);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.scope.combatReposition, false);
  assert.equal(f.orch.scope.navigationEvidence.completed[0].outcome, 'failure');
  assert.equal(f.events.some(e => e.kind === 'note' && e.message.includes('handed back')), false);
});

test('an unexpected I/O failure propagates unchanged and still restores the wrapper flag', async () => {
  const original = new Error('fixture wait failed');
  const f = fixture({ enabled: false, onWait: () => { throw original; } });
  await assert.rejects(reposition(f), err => err === original);
  assert.equal(f.orch.scope.combatReposition, false);
  assert.equal(f.held.size, 0);
  assert.equal(f.orch.scope.navigationEvidence.completed[0].outcome, 'failure');
});
