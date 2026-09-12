import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Sim } from '../../../../aetherwake/src/game/sim.ts';
import { memoryStorage } from '../../../../aetherwake/src/game/persistence.ts';
import { enqueueCommand, pressKeyForTest, resetInput, takeSimActions } from '../../../../aetherwake/src/game/input.ts';
import { BODY_SKIN, playerBodyClear, supportY } from '../../../../aetherwake/src/game/physics.ts';
import { FOOT_SNAP } from '../../../../aetherwake/src/game/params.ts';
import { TOWERS } from '../../../../aetherwake/src/game/world.ts';

const consume = () => takeSimActions({ consumeCommands: true, consumeLook: true });
afterEach(resetInput);
function fixture() {
  resetInput();
  const sim = new Sim(memoryStorage()); sim.freshRuntime(false);
  const tw = TOWERS.find(q => q.id === 'mere');
  // Exact XZ of real headed 63653's final sample. Initial grounded height is
  // the original authored support beneath that sample, not an invented slab.
  // The final recording omitted vx/vz; use an explicit stationary ledge start.
  const x = -108.37595046029948, z = 12.504338048082161;
  const hit = supportY(x, z, 44.98700019073487 + FOOT_SNAP, sim.solids, sim.heightFn, sim.extraSupports(), null);
  assert.match(hit.id, /^mere-(ledge|spiral)-/);
  Object.assign(sim.player, { x, y: hit.y, z, vx: 0, vy: 0, vz: 0, stamina: 100 });
  sim.setMove('grounded');
  sim.towersOn.add('mere'); // The headed sample has already legitimately activated it.
  assert.ok(playerBodyClear(sim.player, sim.solids, sim.heightFn));
  const dx = x - tw.x, dz = z - tw.z, radius = Math.hypot(dx, dz);
  return { sim, tw, support: hit, outward: { x: dx / radius, z: dz / radius }, radius };
}

for (const direction of ['away', 'toward', 'tangent']) {
  test(`normal W ${direction} the actual wall from a clear original upper ledge obeys re-grab intent`, t => {
    const { sim, support, outward } = fixture();
    const wish = direction === 'away' ? outward : direction === 'toward'
      ? { x: -outward.x, z: -outward.z } : { x: -outward.z, z: outward.x };
    sim.cam.yaw = Math.atan2(-wish.x, -wish.z);
    pressKeyForTest('KeyW');
    const a = consume(); assert.equal(a.moveY, 1); assert.equal(a.interact, false);
    const before = { ...sim.player };
    sim.step(1 / 60, a);
    t.diagnostic(JSON.stringify({ direction, support, outward,
      wishDotOutward: wish.x * outward.x + wish.z * outward.z,
      before: { x: before.x, y: before.y, z: before.z, state: before.state },
      after: { x: sim.player.x, y: sim.player.y, z: sim.player.z, state: sim.player.state } }));
    if (direction === 'toward') assert.equal(sim.player.state, 'climbing');
    else assert.notEqual(sim.player.state, 'climbing', 'resting W must not override outward/tangent movement intent');
  });
}

test('explicit E retains its original grab contract despite an outward camera', t => {
  const { sim, outward } = fixture();
  sim.cam.yaw = Math.atan2(-outward.x, -outward.z);
  pressKeyForTest('KeyE');
  sim.step(1 / 60, consume());
  t.diagnostic(JSON.stringify({ state: sim.player.state }));
  assert.equal(sim.player.state, 'climbing');
});

test('tower C is already outward with an outward camera; it is not camera-reversed', t => {
  const { sim, tw, outward, radius } = fixture();
  sim.cam.yaw = Math.atan2(-outward.x, -outward.z);
  sim.setMove('climbing');
  const before = { ...sim.player };
  enqueueCommand('dodge');
  sim.step(1 / 60, consume());
  const dx = sim.player.x - before.x, dz = sim.player.z - before.z;
  t.diagnostic(JSON.stringify({ radiusBefore: radius,
    radiusAfter: Math.hypot(sim.player.x - tw.x, sim.player.z - tw.z),
    displacementOutward: dx * outward.x + dz * outward.z,
    beforeYaw: before.yaw, bodyYaw: sim.player.yaw, camYaw: sim.cam.yaw,
    state: sim.player.state, bodyClear: playerBodyClear(sim.player, sim.solids, sim.heightFn) }));
  assert.equal(sim.player.state, 'airborne');
  assert.ok(dx * outward.x + dz * outward.z > 0.35 - BODY_SKIN);
  assert.ok(playerBodyClear(sim.player, sim.solids, sim.heightFn));
});
