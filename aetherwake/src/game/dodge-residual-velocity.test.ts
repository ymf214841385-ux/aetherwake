import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  enqueueCommand, pendingCommandCount, pressKeyForTest, releaseKeyForTest,
  resetInput, takeSimActions,
} from "./input.ts";
import {
  BRAKE_TIME, DODGE_COOLDOWN, DODGE_IFRAMES, DODGE_SPEED, DODGE_STAMINA,
  DODGE_TIME, FIXED_DT, GRAVITY,
} from "./params.ts";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";

const directions = [
  { name: "+X", x: 1, z: 0, keys: ["KeyD"] },
  { name: "-X", x: -1, z: 0, keys: ["KeyA"] },
  { name: "+Z", x: 0, z: 1, keys: ["KeyS"] },
  { name: "-Z", x: 0, z: -1, keys: ["KeyW"] },
  { name: "+X+Z", x: Math.SQRT1_2, z: Math.SQRT1_2, keys: ["KeyD", "KeyS"] },
  { name: "+X-Z", x: Math.SQRT1_2, z: -Math.SQRT1_2, keys: ["KeyD", "KeyW"] },
  { name: "-X+Z", x: -Math.SQRT1_2, z: Math.SQRT1_2, keys: ["KeyA", "KeyS"] },
  { name: "-X-Z", x: -Math.SQRT1_2, z: -Math.SQRT1_2, keys: ["KeyA", "KeyW"] },
];
const consume = () => takeSimActions({ consumeCommands: true, consumeLook: true });
const close = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual} != ${expected}`);
afterEach(resetInput);

function fixture() {
  resetInput();
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  // Controlled starting environment only: a level, standable slab above the
  // existing terrain, away from towers/water, with no enemies. Keep real
  // supportY, resolveHorizontal, snapVertical, locomotion and Sim.step intact.
  sim.solids = [{ id: "dodge-test-support", kind: "box", x: 16, z: 96,
    y: 19, h: 1, w: 40, d: 40, standable: true }];
  sim.enemies = [];
  Object.assign(sim.player, { x: 16, y: 20, z: 96, vx: 0, vy: 0, vz: 0,
    dodgeT: 0, dodgeCd: 0, invuln: 0, stamina: 100, staminaMax: 100 });
  sim.setMove("grounded");
  sim.cam.yaw = 0;
  assert.equal(sim.surfaceY(16, 96, 20), 20);
  return sim;
}

for (const dir of directions) for (const remaining of [FIXED_DT, FIXED_DT / 2]) {
  test(`production boundary ${dir.name}: ${remaining === FIXED_DT ? "exact zero" : "cross below zero"}, no early/repeated damping`, t => {
    const sim = fixture(), p = sim.player;
    const vx = dir.x * DODGE_SPEED, vz = dir.z * DODGE_SPEED;
    // Direct boundary fixture supplements the naturally elapsed input tests.
    Object.assign(p, { vx, vz, dodgeT: remaining + FIXED_DT });
    const a = consume(), start = { x: p.x, z: p.z };
    sim.handleLocomotion(FIXED_DT, a, 0, 0, 0);
    assert.ok(p.dodgeT > 0);
    close(p.vx, vx, "before expiry vx unchanged");
    close(p.vz, vz, "before expiry vz unchanged");
    const before = { x: p.x, z: p.z };
    sim.handleLocomotion(FIXED_DT, a, 0, 0, 0);
    assert.ok(p.dodgeT <= 0);
    if (remaining === FIXED_DT) assert.equal(p.dodgeT, 0);
    else assert.ok(p.dodgeT < 0);
    // The terminal frame still moves at full speed before end damping.
    close(p.x - before.x, vx * FIXED_DT, "terminal dx");
    close(p.z - before.z, vz * FIXED_DT, "terminal dz");
    close(p.x - start.x, 2 * vx * FIXED_DT, "two-frame dx");
    close(p.z - start.z, 2 * vz * FIXED_DT, "two-frame dz");
    assert.equal(p.y, 20);
    assert.equal(p.vy, 0);
    assert.equal(p.state, "grounded");
    t.diagnostic(JSON.stringify({ direction: dir.name, remaining, predamp: { vx, vz },
      terminal: { vx: p.vx, vz: p.vz, dodgeT: p.dodgeT } }));
    close(p.vx, vx * 0.3, "terminal vx");
    close(p.vz, vz * 0.3, "terminal vz");
    const terminal = { x: p.x, z: p.z, vx: p.vx, vz: p.vz, dodgeT: p.dodgeT };
    sim.handleLocomotion(FIXED_DT, a, 0, 0, 0);
    const brake = Math.exp(-FIXED_DT / BRAKE_TIME);
    close(p.vx, terminal.vx * brake, "next-frame ordinary ground braking only, vx");
    close(p.vz, terminal.vz * brake, "next-frame ordinary ground braking only, vz");
    close(p.x - terminal.x, p.vx * FIXED_DT, "next-frame dx");
    close(p.z - terminal.z, p.vz * FIXED_DT, "next-frame dz");
    assert.equal(p.dodgeT, terminal.dodgeT);
  });
}

function acceptDodge(dir: typeof directions[number]) {
  const sim = fixture(), p = sim.player;
  for (const key of dir.keys) pressKeyForTest(key);
  pressKeyForTest("KeyC");
  // pressKeyForTest C does NOT enqueue commands. Adapt only the key-down
  // transport boundary: real onKeyDown enqueues one dodge on nonrepeat C.
  // No browser event dispatch is claimed and no input helper is changed.
  assert.equal(pendingCommandCount(), 0);
  enqueueCommand("dodge");
  assert.equal(pendingCommandCount(), 1);
  const a = consume();
  assert.equal(a.dodge, true);
  close(Math.hypot(a.moveX, a.moveY), 1, "normalized production keyboard input");
  sim.step(FIXED_DT, a);
  assert.equal(pendingCommandCount(), 0);
  for (const key of [...dir.keys, "KeyC"]) releaseKeyForTest(key);
  assert.equal(p.dodgeT, DODGE_TIME);
  assert.equal(p.dodgeCd, DODGE_COOLDOWN);
  assert.equal(p.invuln, DODGE_IFRAMES);
  assert.equal(p.stamina, 100 - DODGE_STAMINA);
  close(p.vx, dir.x * DODGE_SPEED, "accepted vx");
  close(p.vz, dir.z * DODGE_SPEED, "accepted vz");
  assert.equal(p.x, 16);
  assert.equal(p.z, 96);
  return sim;
}

function expireNaturally(sim: Sim) {
  const p = sim.player;
  let frames = 0;
  while (p.dodgeT > 0) {
    assert.ok(frames < Math.ceil(DODGE_TIME / FIXED_DT) + 1, "expiry must be bounded");
    const before = { ...p }, a = consume();
    assert.equal(a.dodge, false, "queued edge consumed once");
    sim.step(FIXED_DT, a);
    frames++;
    close(p.x - before.x, before.vx * FIXED_DT, "active dx including terminal frame");
    close(p.z - before.z, before.vz * FIXED_DT, "active dz including terminal frame");
    if (p.dodgeT > 0) {
      close(p.vx, before.vx, "unexpired vx");
      close(p.vz, before.vz, "unexpired vz");
    }
    assert.equal(p.y, 20);
    assert.equal(p.vy, 0);
    assert.equal(p.state, "grounded");
  }
  assert.equal(frames, Math.ceil(DODGE_TIME / FIXED_DT));
  return frames;
}

for (const dir of directions) test(`input queue -> real Sim.step: accepted ${dir.name} dodge expires naturally`, t => {
  const sim = acceptDodge(dir), p = sim.player;
  const predamp = { vx: p.vx, vz: p.vz };
  const frames = expireNaturally(sim), terminal = { ...p };
  // Record an equal, one-second no-input residual window even on the failing
  // baseline. Observations come from real steps; no expected state is injected.
  for (let i = 0; i < 60; i++) {
    sim.step(FIXED_DT, consume());
    if (i === 0) {
      close(p.vx, terminal.vx * Math.exp(-FIXED_DT / BRAKE_TIME), "next-frame vx brakes once");
      close(p.vz, terminal.vz * Math.exp(-FIXED_DT / BRAKE_TIME), "next-frame vz brakes once");
    }
  }
  t.diagnostic(JSON.stringify({ direction: dir.name, activeFrames: frames, predamp,
    terminal: { x: terminal.x, z: terminal.z, vx: terminal.vx, vz: terminal.vz },
    afterOneSecond: { x: p.x, z: p.z, vx: p.vx, vz: p.vz },
    residualDistance: Math.hypot(p.x - terminal.x, p.z - terminal.z) }));
  close(terminal.vx, predamp.vx * 0.3, "naturally expired vx");
  close(terminal.vz, predamp.vz * 0.3, "naturally expired vz");
  close(Math.hypot(terminal.vx, terminal.vz), DODGE_SPEED * 0.3, "residual speed");
  assert.equal(terminal.invuln, 0);
  close(terminal.dodgeCd, DODGE_COOLDOWN - frames * FIXED_DT, "cooldown elapses normally");
  assert.equal(terminal.stamina, 100 - DODGE_STAMINA);
  assert.equal(p.dodgeT, terminal.dodgeT);
});

test("natural input trajectories retain rotational symmetry through expiry and ground braking", () => {
  const outcomes = directions.map(dir => {
    const sim = acceptDodge(dir);
    expireNaturally(sim);
    const terminal = { ...sim.player };
    for (let i = 0; i < 60; i++) sim.step(FIXED_DT, consume());
    return { dir, terminal, last: { ...sim.player } };
  });
  const baseline = outcomes[0]!;
  for (const { dir, terminal, last } of outcomes) {
    close(terminal.vx, baseline.terminal.vx * dir.x, `${dir.name} rotated vx`);
    close(terminal.vz, baseline.terminal.vx * dir.z, `${dir.name} rotated vz`);
    close(last.x - 16, (baseline.last.x - 16) * dir.x, `${dir.name} rotated total dx`);
    close(last.z - 96, (baseline.last.x - 16) * dir.z, `${dir.name} rotated total dz`);
  }
});

test("airborne terminal snap keeps vertical velocity; next frame does not redamp either horizontal axis", () => {
  const sim = fixture(), p = sim.player, a = consume();
  Object.assign(p, { y: 22, vy: 1, vx: 7, vz: -7, dodgeT: FIXED_DT });
  sim.setMove("airborne");
  sim.handleLocomotion(FIXED_DT, a, 0, 0, 0);
  close(p.y, 22 + FIXED_DT, "real terminal snapVertical integration");
  assert.equal(p.vy, 1);
  close(p.vx, 2.1, "airborne terminal vx");
  close(p.vz, -2.1, "airborne terminal vz");
  sim.handleLocomotion(FIXED_DT, a, 0, 0, 0);
  close(p.vx, 2.1, "airborne next vx unchanged");
  close(p.vz, -2.1, "airborne next vz unchanged");
  close(p.vy, 1 - GRAVITY * FIXED_DT, "ordinary next-frame gravity");
});
