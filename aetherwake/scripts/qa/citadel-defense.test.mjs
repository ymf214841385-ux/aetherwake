import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../../src/game/sim.ts';
import { memoryStorage } from '../../src/game/persistence.ts';
import { FIXED_DT } from '../../src/game/params.ts';
import { TOWERS, SHRINES } from '../../src/game/world.ts';
import { queryWall } from '../../src/game/physics.ts';
import { resetInput, pressKeyForTest, releaseKeyForTest, takeSimActions, enqueueCommand } from '../../src/game/input.ts';
import { citadelDodgeAim, insideCourtyard } from './citadel-steer.mjs';
import { keysToward, createRouteNavigation } from './route-navigation.mjs';
import { createAbortLatch, createFightOrchestrator } from './combat-progress-monitor.mjs';
import { prepareCitadelCombatDecision } from './citadel-handoff.mjs';
import { executeCitadelDefense } from './citadel-defense.mjs';

const archive = JSON.parse(readFileSync(new URL('../../../docs/rebuild-evidence/runs/e26-controller-navigation/citadel-stop.json', import.meta.url)));
const recorded = archive.ring.find(s => Math.abs(s.t - 56280.17675) < .01);
const recordedBoss = recorded.nearbyEnemies.find(e => e.kind === 'boss');
// Controlled fixture only: ring lacks camera yaw, horizontal velocity, mode,
// seal and attack state. Infer camera facing Boss, zero residual velocity, open
// seal and idle attack. HP/stamina/cd/iframe/pose/remaining windup are recorded.
function fixture({ x = recorded.x, z = recorded.z, bossX = recordedBoss.x,
  bossZ = recordedBoss.z, yaw, cd = 0, stamina = 108, state = 'grounded' } = {}) {
  resetInput();
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  for (const t of TOWERS) sim.towersOn.add(t.id);
  for (const s of SHRINES) sim.shrinesOn.add(s.id);
  // Production invariant: each shrine claim increments orbs. Keep fixture consistent.
  sim.orbs = sim.shrinesOn.size;
  Object.assign(sim.player, { x, z, y: sim.surfaceY(x, z, recorded.y + 1),
    hp: recorded.hp, stamina, staminaMax: 108, dodgeCd: cd, dodgeT: 0,
    invuln: 0, vx: 0, vy: 0, vz: 0, state, grounded: state === 'grounded',
    gliding: false, climbing: false, coldAcc: 0 });
  const boss = sim.enemies.find(e => e.kind === 'boss');
  Object.assign(boss, structuredClone(recordedBoss), { x: bossX, z: bossZ });
  boss.y = sim.surfaceY(bossX, bossZ, recordedBoss.y + 1);
  sim.cam.yaw = yaw ?? Math.atan2(x - bossX, z - bossZ);
  const frames = [], damage = [];
  const hurt = sim.hurt.bind(sim);
  sim.hurt = (amount, source) => { damage.push({ amount, source }); return hurt(amount, source); };
  const snap = () => ({ ...sim.player, mode: sim.mode, camYaw: sim.cam.yaw,
    sealOpen: true, bossDead: false, attackPhase: sim.attack.phase,
    canDodge: sim.canAcceptDodge(sim.player), bossMeleeBlocked: sim.targetVisibility(boss.x, boss.z).blocked,
    boss: { x: boss.x, y: boss.y, z: boss.z, hp: boss.hp, alive: boss.alive, phase: boss.brain.phase, t: boss.brain.t } });
  const frame = () => {
    sim.step(FIXED_DT, takeSimActions({ consumeCommands: true, consumeLook: true }));
    const s = snap();
    s.dist = Math.hypot(s.x - boss.x, s.z - boss.z);
    s.wall = queryWall(s.x, s.z, s.y, sim.solids);
    frames.push(s);
  };
  return { sim, boss, frames, damage, snap, frame };
}

// Real route hold/checkedRead/abort code, backed by Sim and the input queue.
// Only the browser transport and clock are adapted; no cooperating fake hold.
function driver(options) {
  const f = fixture(options), held = new Set(), events = [], notes = [];
  let ms = 0, simulatedMs = 0, readError = null;
  const down = async k => {
    held.add(k); events.push(['down', k]); pressKeyForTest(k);
    if (k === 'KeyC') enqueueCommand('dodge');
  };
  const up = async k => { held.delete(k); events.push(['up', k]); releaseKeyForTest(k); };
  const releaseAll = async () => { for (const k of [...held]) await up(k); };
  const wait = async n => {
    ms += n;
    while (simulatedMs + FIXED_DT * 1000 <= ms + 1e-6) {
      f.frame(); simulatedMs += FIXED_DT * 1000;
    }
  };
  const nav = createRouteNavigation({ page: { keyboard: { down, up } },
    read: async () => { if (readError) throw Error(readError); return f.snap(); },
    wait, now: () => ms, ensureOpen() {},
    MOVE_CODES: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'ShiftLeft'],
    releaseAll, note: m => notes.push(m), state: {} });
  const orch = createFightOrchestrator({ ...nav, releaseAll, wait, now: () => ms });
  const prepare = (snapshot = f.snap(), preserveSnapshot = false) => prepareCitadelCombatDecision({
    snapshot, preserveSnapshot, scope: orch.scope,
    lookToward: nav.lookToward, fightRead: () => nav.checkedRead(orch.scope) });
  const execute = turn => executeCitadelDefense({ snapshot: turn.snapshot, step: turn.step,
    scope: orch.scope, fightHold: orch.hold, fightRead: () => nav.checkedRead(orch.scope),
    releaseAll, note: m => notes.push(m) });
  return { ...f, held, events, notes, nav, orch, wait, prepare, execute, down,
    failRead: error => { readError = error; } };
}

test('actual executor and route hold: accepted dodge, then cd>0 defense without camera or swing', async () => {
  const f = driver();
  const before = f.snap();
  const first = await f.execute(await f.prepare(before, true));
  assert.equal(first.handled, true);
  assert.ok(first.snapshot.dodgeCd > 0);
  assert.equal(first.snapshot.stamina, 90);
  assert.deepEqual(f.events.filter(e => e[0] === 'down'), [['down', 'KeyC'], ['down', 'KeyS']]);
  assert.equal(f.held.size, 0);
  const next = await f.prepare(first.snapshot);
  assert.equal(next.step.act, 'hold-attack');
  assert.equal(next.step.swing, false);
  assert.equal((await f.execute(next)).handled, true);
  assert.equal(f.events.filter(e => e[0] === 'down').length, 2);
  assert.equal(f.notes.length, 2);
  const record = JSON.parse(f.notes[0].slice('citadel defense '.length));
  assert.deepEqual(record.pre, before);
  assert.deepEqual(record.post, first.snapshot);
  assert.equal(record.target.reason, 'gate-apron-away');
});

for (const options of [{ cd: .02 }, { cd: .43 }, { stamina: 18 }, { stamina: 0 },
  { state: 'airborne', z: recordedBoss.z + 1, x: recordedBoss.x }]) {
  test(`actual executor unavailable gate uses ordinary outward keys only: ${JSON.stringify(options)}`, async () => {
    const f = driver({ ...options, yaw: 1.7 });
    const before = f.snap(), copy = structuredClone(before);
    const turn = await f.prepare(before);
    assert.ok(['back-off', 'back-off-too-close'].includes(turn.step.act));
    const target = citadelDodgeAim(before, before.boss);
    const wanted = keysToward(before, target.x, target.z, false);
    const result = await f.execute(turn);
    assert.equal(result.handled, true);
    assert.equal(turn.step.swing, false);
    assert.deepEqual(f.events.filter(e => e[0] === 'down').map(e => e[1]), wanted);
    assert.ok(f.frames.every(s => s.dodgeT === 0));
    assert.ok(Math.hypot(result.snapshot.x - before.boss.x, result.snapshot.z - before.boss.z) >
      Math.hypot(before.x - before.boss.x, before.z - before.boss.z));
    assert.equal(f.held.size, 0);
    assert.deepEqual(before, copy, 'executor must not mutate supplied state');
  });
}

test('actual executor no-safe-direction latches first stop, releases held input, never moves or swings', async () => {
  const f = driver({ x: 16, z: 8, bossX: 14, bossZ: 6 });
  const before = f.snap();
  await f.down('KeyW'); // existing input must be released even before any new hold
  const turn = await f.prepare(before);
  assert.equal(turn.step.act, 'dodge');
  await assert.rejects(f.execute(turn), e => e.reason === 'no-safe-direction');
  assert.equal(f.orch.abort.reason, 'no-safe-direction');
  assert.equal(f.held.size, 0);
  assert.deepEqual(f.snap(), before);
  assert.deepEqual(f.events, [['down', 'KeyW'], ['up', 'KeyW']]);
  assert.equal(f.orch.scope.defensiveFailure.target.safe, false);
  assert.equal(f.orch.scope.defensiveFailure.target.reason, 'no-safe-direction');
  f.orch.abort.abort('later-failure');
  await assert.rejects(f.execute(turn), e => e.reason === 'no-safe-direction');
  assert.equal(f.notes.length, 1);
});

test('executor rechecks production gate even if passed a stale dodge policy', async () => {
  const f = driver({ cd: .02 });
  const result = await f.execute({ snapshot: f.snap(), step: { act: 'dodge', swing: false } });
  assert.equal(result.handled, true);
  assert.deepEqual(f.events.filter(e => e[0] === 'down'), [['down', 'KeyS']]);
  assert.ok(f.frames.every(s => s.dodgeT === 0));
  const denied = driver();
  const snapshot = { ...denied.snap(), canDodge: false };
  await denied.execute({ snapshot, step: { act: 'dodge', swing: false } });
  assert.deepEqual(denied.events.filter(e => e[0] === 'down'), [['down', 'KeyS']]);
});

test('executor preexisting abort/death and actual checkedRead error retain stop priority', async () => {
  for (const reason of ['earlier-failure', 'death', 'read-error:fixture-read']) {
    const f = driver();
    const turn = await f.prepare();
    if (reason === 'death') turn.snapshot.hp = 0;
    else if (reason.startsWith('read-error')) {
      f.orch.scope.lastSnapshot = { ...f.snap(), x: -999 }; // older observation, never a post
      f.failRead('fixture-read');
    }
    else f.orch.abort.abort(reason);
    await assert.rejects(f.execute(turn), e => e.reason === reason);
    assert.equal(f.orch.abort.reason, reason);
    assert.equal(f.held.size, 0);
    if (reason.startsWith('read-error')) assert.equal(f.orch.scope.defensiveFailure.post, null);
    if (!reason.startsWith('read-error')) assert.equal(f.events.length, 0);
  }
});

test('non-defensive actions pass through the shared executor without input or mutation', async () => {
  for (const act of ['swing', 'approach', 'wait-facing', 'reposition', 'hold-attack']) {
    const f = driver();
    f.boss.brain.phase = 'recover';
    const snapshot = f.snap(), before = structuredClone(snapshot);
    const result = await f.execute({ snapshot, step: { act } });
    assert.equal(result.handled, false);
    assert.equal(f.events.length, 0);
    assert.deepEqual(snapshot, before);
  }
});

test('production entry uses the tested executor and consumes handled defense before melee', () => {
  const source = readFileSync(new URL('../play-routes.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ executeCitadelDefense \} from "\.\/qa\/citadel-defense.mjs"/);
  const branch = source.slice(source.indexOf('const defense = await executeCitadelDefense('), source.indexOf('      const hpBefore = s?.boss?.hp;'));
  assert.match(branch, /snapshot: s, step, scope: orch.scope, fightHold, fightRead, releaseAll, note/);
  assert.match(branch, /if \(defense.handled\) \{\s*s = defense.snapshot;\s*if \(!s\?\.boss\) break;\s*continue;/);
  assert.doesNotMatch(branch, /fightClick/);
});

for (const phase of ['recover', 'approach']) test(`non-telegraph ${phase} still aims then rereads`, async () => {
  const f = fixture();
  f.boss.brain.phase = phase;
  const snapshot = f.snap(), aligned = { ...snapshot, camYaw: snapshot.camYaw + .1 };
  const calls = [];
  const turn = await prepareCitadelCombatDecision({ snapshot, scope: { abort: createAbortLatch() },
    lookToward: async () => { calls.push('look'); }, fightRead: async () => { calls.push('read'); return aligned; } });
  assert.deepEqual(calls, ['look', 'read']);
  assert.equal(turn.snapshot, aligned);
});

test('telegraph fast path requires valid live clear LOS; blocked still repositions', async () => {
  for (const override of [{ bossMeleeBlocked: true }, { bossMeleeBlocked: undefined },
    { camYaw: NaN }, { mode: 'inventory' }, { boss: { ...fixture().snap().boss, alive: false } }]) {
    const f = fixture(), snapshot = { ...f.snap(), ...override };
    let looks = 0;
    const turn = await prepareCitadelCombatDecision({ snapshot, scope: { abort: createAbortLatch() },
      lookToward: async () => { looks++; }, fightRead: async () => snapshot });
    assert.equal(looks, 1);
    if (override.bossMeleeBlocked === true) assert.equal(turn.step.act, 'reposition');
  }
});

test('courtyard and other navigation bounds remain unchanged', () => {
  assert.equal(insideCourtyard(6, 2), false);
  assert.equal(insideCourtyard(6, -2), true);
  assert.deepEqual(citadelDodgeAim({ x: 6, z: -3 }, { x: 6, z: -5 }), { x: 6, z: .10000000000000009, reason: 'away' });
  assert.deepEqual(citadelDodgeAim({ x: 6, z: 9 }, { x: 6, z: 6 }), { x: 6, z: -4.8, reason: 'center' });
});

test('gate corners, coincident and missing Boss explicitly diagnose no safe direction', () => {
  for (const [player, boss] of [
    [{ x: 16, z: 8 }, { x: 14, z: 6 }],
    [{ x: -4, z: 8 }, { x: -2, z: 6 }],
    [{ x: -4, z: .7 }, { x: -3, z: 1.7 }],
    [{ x: 6, z: 2 }, { x: 6, z: 2 }],
    [{ x: 6, z: 2 }, undefined],
  ]) {
    const aim = citadelDodgeAim(player, boss);
    assert.deepEqual(aim, { safe: false, reason: 'no-safe-direction', region: 'gate-apron' });
    assert.deepEqual(keysToward({ ...player, camYaw: 0 }, aim.x, aim.z, false), []);
  }
});

for (let i = 0; i < 8; i++) test(`recorded pose digital direction ${i + 1}/8 with offset inferred camera`, () => {
  const f = runDodge({ yaw: Math.atan2(recorded.x - recordedBoss.x, recorded.z - recordedBoss.z) + i * Math.PI / 4 + .38 });
  assert.equal(f.aim.reason, 'gate-apron-away');
  assert.ok(f.frames[0].dodgeT > 0);
  assert.equal(f.frames[0].stamina, 90);
  assert.ok(f.frames.every(s => s.wall === null));
  assert.ok(f.frames.find(s => s.boss.phase === 'strike').dist >= 3.8);
  assert.equal(f.frames.at(-1).hp, 1);
  assert.equal(f.boss.brain.phase, 'approach');
});

for (const pose of [
  { x: 4, z: 3.4, bossX: 3.6, bossZ: .6 },
  { x: 10, z: 3.4, bossX: 9.6, bossZ: .6 },
  { x: -4, z: 3.4, bossX: -2, bossZ: .6 },
  { x: 16, z: 3.4, bossX: 14, bossZ: .6 },
]) for (const yaw of [0, .4, 1.7, -2.6]) {
  test(`equivalent gate/near-sidewall Sim trajectory ${JSON.stringify(pose)} yaw=${yaw}`, () => {
    const f = runDodge({ ...pose, yaw });
    assert.notEqual(f.aim.reason, 'center');
    assert.ok(f.aim.x > -4.2 && f.aim.x < 16.2 && f.aim.z > .6 && f.aim.z <= 10);
    assert.ok((f.aim.x - f.start.x) * (f.start.x - f.boss.x) +
      (f.aim.z - f.start.z) * (f.start.z - f.boss.z) >= -1e-8);
    assert.ok(f.frames[0].dodgeT > 0);
    assert.equal(f.frames[0].stamina, 90);
    assert.ok(f.frames.every(s => s.wall === null), JSON.stringify(f.frames.find(s => s.wall)));
    assert.equal(f.frames.at(-1).hp, 1);
    assert.equal(f.boss.brain.phase, 'approach');
    assert.ok(f.frames.find(s => s.boss.phase === 'strike').dist >= 3.8);
  });
}
function runDodge(options, oldCenter = false) {
  const f = fixture(options), start = f.snap();
  const aim = oldCenter ? { x: 6, z: -4.8, reason: 'archived-pre-E27-center' } : citadelDodgeAim(start, start.boss);
  const keys = keysToward(start, aim.x, aim.z, false);
  for (const key of ['KeyC', ...keys]) pressKeyForTest(key);
  // pressKeyForTest omits C's edge; production onKeyDown enqueues it once.
  enqueueCommand('dodge');
  for (let i = 0; i < 17; i++) f.frame(); // existing 280 ms hold rounded to fixed frames
  for (const key of ['KeyC', ...keys]) releaseKeyForTest(key);
  // Residual physics and Boss chain run naturally, with no further controls.
  for (let i = 0; i < 100 && f.sim.mode !== 'dead'; i++) {
    f.frame();
    if (f.boss.brain.phase === 'approach') break;
  }
  return { ...f, start, aim, keys };
}
function brief(f) {
  return { aim: f.aim, keys: f.keys, inferredCamYaw: f.start.camYaw,
    first: f.frames[0], afterIframe: f.frames.find(s => s.invuln === 0),
    strike: f.frames.find(s => s.boss.phase === 'strike'), last: f.frames.at(-1), damage: f.damage };
}
test('recorded gate pose: production aim/digital input survives natural first strike and complete recovery', t => {
  const f = runDodge();
  t.diagnostic(JSON.stringify(brief(f)));
  assert.ok(f.frames[0].dodgeT > 0);
  assert.ok(f.frames[0].dodgeCd > 0);
  assert.equal(f.frames[0].stamina, 90);
  assert.ok(f.frames.some(s => s.dodgeT <= 0 && s.invuln === 0));
  assert.equal(f.frames.at(-1).hp, 1);
  assert.equal(f.boss.brain.phase, 'approach');
  assert.ok(f.frames.find(s => s.boss.phase === 'strike').dist >= 3.8);
  assert.equal(f.damage.length, 0);
  assert.ok(f.frames.every(s => s.wall === null));
  assert.equal(f.aim.reason, 'gate-apron-away');
});
test('historical center target witness: same Sim/input reaches danger after iframe and naturally dies', t => {
  const f = runDodge(undefined, true);
  t.diagnostic(JSON.stringify(brief(f)));
  assert.ok(f.frames[0].dodgeT > 0);
  assert.ok(f.frames.find(s => s.invuln === 0).dist < 3.8);
  assert.equal(f.frames.at(-1).hp, 0);
  assert.deepEqual(f.damage, [{ amount: 1.25, source: '空王' }]);
});
for (const phase of ['windup', 'strike']) for (const distance of [2.8, 5]) {
  test(`production prepare: ${phase}, cooldown>0, d=${distance} has zero camera/read waits`, async () => {
    const f = fixture({ z: recordedBoss.z + distance, x: recordedBoss.x, cd: .43, yaw: Math.PI });
    f.boss.brain.phase = phase;
    const snapshot = f.snap(), before = structuredClone(snapshot);
    let looks = 0, reads = 0;
    const turn = await prepareCitadelCombatDecision({ snapshot,
      scope: { abort: createAbortLatch() },
      lookToward: async () => { looks++; }, fightRead: async () => { reads++; return snapshot; } });
    assert.equal(looks, 0);
    assert.equal(reads, 0);
    assert.equal(turn.snapshot, snapshot);
    assert.equal(turn.step.act, distance < 3.55 ? 'back-off' : 'hold-attack');
    assert.equal(turn.step.swing, false);
    assert.deepEqual(snapshot, before);
  });
}
