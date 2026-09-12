import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteNavigation, keysToward } from './route-navigation.mjs';
import { Sim } from '../../src/game/sim.ts';
import { memoryStorage } from '../../src/game/persistence.ts';
import { resetInput, setKeys, takeSimActions } from '../../src/game/input.ts';
import { FIXED_DT } from '../../src/game/params.ts';

assert.equal(createRouteNavigation({}).keysToward, keysToward);
const snap = { x: 24, z: -40, camYaw: -0.827207346410207, stamina: 20, state: 'grounded' };
test('recorded yaw/target retains SD as the nearest legal direction', () => {
  assert.deepEqual(keysToward(snap, 6, 8, true), ['KeyS', 'KeyD', 'ShiftLeft']);
});
test('zero, nearzero and nonfinite inputs fail closed without sprint', () => {
  for (const sprint of [false, true]) {
    assert.deepEqual(keysToward(snap, 24, -40, sprint), []);
    assert.deepEqual(keysToward(snap, 24 + 1e-10, -40, sprint), []);
    for (const value of [NaN, Infinity, -Infinity]) {
      for (const field of ['x', 'z', 'camYaw']) assert.deepEqual(keysToward({ ...snap, [field]: value }, 6, 8, sprint), []);
      assert.deepEqual(keysToward(snap, value, 8, sprint), []);
      assert.deepEqual(keysToward(snap, 6, value, sprint), []);
    }
  }
});
test('fixed-dt Sim/input queue: all sector boundaries choose nearest legal world direction', () => {
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  sim.enemies = [];
  const legal = [['KeyW'], ['KeyW', 'KeyD'], ['KeyD'], ['KeyS', 'KeyD'], ['KeyS'], ['KeyS', 'KeyA'], ['KeyA'], ['KeyW', 'KeyA']];
  function direction(keys, yaw) {
    resetInput();
    Object.assign(sim.player, { x: 24, z: -40, y: sim.heightFn(24, -40), vx: 0, vy: 0, vz: 0, stamina: 100 });
    sim.setMove('grounded');
    sim.cam.yaw = yaw;
    setKeys(keys);
    sim.step(FIXED_DT, takeSimActions({ consumeCommands: true, consumeLook: true }));
    const dx = sim.player.x - 24, dz = sim.player.z + 40;
    const length = Math.hypot(dx, dz);
    assert.ok(length > 0);
    return [dx / length, dz / length];
  }
  try {
    for (const yaw of [0, snap.camYaw, 1.7]) {
      const candidates = legal.map(keys => direction(keys, yaw));
      for (let sector = 0; sector < 8; sector++) for (const offset of [-1e-6, 0, 1e-6]) {
        const angle = yaw + (sector + 0.5) * Math.PI / 4 + offset;
        const desired = [Math.sin(angle), Math.cos(angle)];
        const keys = keysToward({ ...snap, camYaw: yaw }, 24 + desired[0] * 50, -40 + desired[1] * 50, false);
        assert.ok(legal.some(k => JSON.stringify(k) === JSON.stringify(keys)));
        const actual = direction(keys, yaw);
        const dot = actual[0] * desired[0] + actual[1] * desired[1];
        const best = Math.max(...candidates.map(c => c[0] * desired[0] + c[1] * desired[1]));
        assert.ok(dot >= best - 1e-10, `yaw=${yaw} angle=${angle} keys=${keys} dot=${dot} best=${best}`);
        assert.ok(dot >= Math.cos(Math.PI / 8) - 1e-10);
      }
    }
  } finally { resetInput(); }
});
test('sprint retains stamina/state gate only with movement', () => {
  for (const [state, stamina, sprint, expected] of [['grounded', 9, true, true], ['grounded', 8, true, false], ['climbing', 20, true, false], ['grounded', 20, false, false]]) {
    assert.equal(keysToward({ ...snap, state, stamina }, 6, 8, sprint).includes('ShiftLeft'), expected);
  }
});
