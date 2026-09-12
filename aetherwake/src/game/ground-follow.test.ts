import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pendingCommandCount, pressKeyForTest, releaseKeyForTest, resetInput, takeSimActions } from "./input.ts";
import { FIXED_DT, FOOT_SNAP, GRAVITY, JUMP_VELOCITY } from "./params.ts";
import { createDefaultSave, memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";

// Run 49416, monitor t38830.121042: the real player is grounded here.
// The preceding t38728.789083 sample determines mean (not instantaneous)
// horizontal velocity. The recording omits vx/vz, yaw, coyote and jumpBuf;
// use this inferred velocity, yaw 0 and zero input timers at initialization.
// Core fixtures retain the full production terrain, solids, enemies and AI.
// Boundary fixtures choose a different initial height/state before stepping.
// No fixture refills HP/stamina/cooldowns or injects state after its first step.
// These fixed-step/input-queue regressions do not model browser transport delay.
const RECORDED = {
  x: 25.475882349291272, y: 11.644768768058388, z: -43.86454607159167,
  vx: -1.5569215937855856, vz: 1.5639315017455053,
};
const close = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
const consume = () => takeSimActions({ consumeCommands: true, consumeLook: true });
afterEach(resetInput);

function fixture() {
  resetInput();
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  // Inline the recorded legitimate crown-save progress so this regression does
  // not depend on a local browser archive. Default blade/bow match that save.
  const save = createDefaultSave();
  Object.assign(save.player, { hp: 2, heartsMax: 4, staminaMax: 108, amber: 8, art: 4 });
  save.inventory.mats.pepper = 0;
  Object.assign(save.progress, {
    towers: ["dawn", "mere", "crown"], shrines: ["pull", "rime", "burst", "still"],
    wisps: ["w5"], orbs: 4, ruinSolved: true,
  });
  sim.applySave(save);
  sim.mode = "playing";
  Object.assign(sim.player, {
    ...RECORDED, vy: 0, yaw: 0, hp: 2, stamina: 108,
    dodgeCd: 0, dodgeT: 0, invuln: 0, spicy: 0, coyote: 0, jumpBuf: 0,
  });
  sim.setMove("grounded");
  sim.cam.yaw = 0;
  // This is the nearby sentinel's recorded state; all other enemies retain
  // their ordinary world initialization, rather than being removed/disabled.
  const sentinel = sim.enemies.find(e => e.id === "s-0");
  assert.ok(sentinel, "recorded sentinel must exist in the real world");
  Object.assign(sentinel, {
    x: 23.690353267208064, y: 10.239428298389008, z: -39.065888806493426,
    yaw: -0.43043916847962366, hp: 8, alive: true, frozen: 0,
    timer: 1.9500000000000015, hurt: 0, telegraph: 0,
    brain: { phase: "recover", t: 0.28333333333333277 },
  });
  close(sim.surfaceY(RECORDED.x, RECORDED.z, RECORDED.y + FOOT_SNAP), RECORDED.y,
    "recorded feet stand on original terrain");
  return sim;
}

function snapshot(sim: Sim) {
  const p = sim.player, ground = sim.surfaceY(p.x, p.z, p.y + FOOT_SNAP);
  return { t: sim.t, x: p.x, y: p.y, z: p.z, ground, gap: p.y - ground,
    vx: p.vx, vy: p.vy, vz: p.vz, hp: p.hp, stamina: p.stamina,
    state: p.state, grounded: p.grounded, canDodge: sim.canAcceptDodge(p) };
}

function stepFrames(sim: Sim, count: number) {
  const frames: ReturnType<typeof snapshot>[] = [];
  for (let i = 0; i < count; i++) {
    sim.step(FIXED_DT, consume());
    frames.push(snapshot(sim));
  }
  return frames;
}

test("recorded downhill release follows the 0.96 cm lower ground on frame one and stays grounded for one second", t => {
  const sim = fixture();
  const frames = stepFrames(sim, 60), first = frames[0]!;
  t.diagnostic(JSON.stringify({ first, last: frames.at(-1),
    airborneFrames: frames.filter(s => s.state === "airborne").length }));
  close(first.x, 25.45284599401773, "same ordinary braking X");
  close(first.z, -43.84140599707443, "same ordinary braking Z");
  close(RECORDED.y - first.ground, 0.009606457263865664, "actual small downhill gap");
  assert.equal(first.state, "grounded");
  assert.equal(first.canDodge, true, "ordinary ground movement must not revoke legal dodge");
  for (const s of frames) {
    assert.equal(s.state, "grounded", `state at t=${s.t}`);
    assert.equal(s.grounded, true);
    close(s.gap, 0, `ground contact at t=${s.t}`);
    assert.equal(s.hp, 2);
  }
  close(frames.at(-1)!.t, 1, "full one-second simulation");
});

test("normal W movement down the same real slope stays grounded for 60 frames", t => {
  const sim = fixture();
  // Controlled camera yaw makes ordinary W point down this real slope.
  // No sprint, dodge or synthesized movement action is used.
  sim.cam.yaw = 3 * Math.PI / 4;
  pressKeyForTest("KeyW");
  const held = consume();
  assert.equal(held.moveY, 1);
  assert.equal(held.moveX, 0);
  assert.equal(held.sprint, false);
  const frames = stepFrames(sim, 60), first = frames[0]!;
  t.diagnostic(JSON.stringify({ first, last: frames.at(-1),
    airborneFrames: frames.filter(s => s.state === "airborne").length }));
  assert.ok(first.ground < RECORDED.y - 0.01, "the real route descends from its first step");
  assert.ok(frames.at(-1)!.ground < first.ground - 0.5, "W actually traverses the slope");
  for (const s of frames) {
    assert.equal(s.state, "grounded", `state at t=${s.t}`);
    assert.equal(s.grounded, true);
    close(s.gap, 0, `ground contact at t=${s.t}`);
    assert.equal(s.hp, 2);
  }
});

test("a real Space command leaves the ground and follows the original upward jump", () => {
  const sim = fixture();
  pressKeyForTest("Space");
  assert.equal(pendingCommandCount(), 1, "Space enters the production command queue");
  const first = stepFrames(sim, 1)[0]!;
  assert.equal(pendingCommandCount(), 0);
  releaseKeyForTest("Space");
  assert.equal(first.state, "airborne");
  assert.equal(first.grounded, false);
  close(first.vy, JUMP_VELOCITY, "accepted jump velocity");
  close(first.y, RECORDED.y + JUMP_VELOCITY * FIXED_DT, "unclipped first jump step");
  const frames = stepFrames(sim, 29);
  assert.ok(frames.every(s => !s.grounded && s.hp === 2));
  close(frames.at(-1)!.vy, JUMP_VELOCITY - GRAVITY * FIXED_DT * 29, "natural jump gravity");
});

test("already airborne 0.3 m above real terrain falls naturally instead of snapping early", () => {
  const sim = fixture();
  Object.assign(sim.player, { y: RECORDED.y + 0.3, vx: 0, vy: 0, vz: 0 });
  sim.setMove("airborne");
  const frames = stepFrames(sim, 30), first = frames[0]!;
  assert.equal(first.state, "airborne");
  assert.equal(first.grounded, false);
  close(first.vy, -GRAVITY * FIXED_DT, "airborne gravity");
  close(first.gap, 0.3 - GRAVITY * FIXED_DT ** 2, "positive gap remains after first fall step");
  const landed = frames.find(s => s.grounded);
  assert.ok(landed && landed.t > FIXED_DT, "landing occurs later through real integration");
  assert.ok(frames.every(s => s.hp === 2));
});

for (const initialState of ["grounded", "airborne"] as const) {
  test(`positive vy is not ground-snapped even when initially ${initialState}`, () => {
    const sim = fixture();
    const height = initialState === "airborne" ? 0.1 : 0;
    Object.assign(sim.player, { y: RECORDED.y + height, vx: 0, vz: 0, vy: 3 });
    sim.setMove(initialState);
    const first = stepFrames(sim, 1)[0]!;
    const expectedVy = initialState === "airborne" ? 3 - GRAVITY * FIXED_DT : 3;
    assert.equal(first.state, "airborne");
    assert.equal(first.grounded, false);
    close(first.vy, expectedVy, "upward velocity preserved");
    close(first.gap, height + expectedVy * FIXED_DT, "rising feet remain above terrain");
    assert.equal(first.hp, 2);
  });
}

test("a grounded fixture 0.63 m above actual support exceeds FOOT_SNAP and becomes airborne", () => {
  const sim = fixture();
  Object.assign(sim.player, { y: RECORDED.y + FOOT_SNAP + 0.01, vx: 0, vz: 0, vy: 0 });
  const first = stepFrames(sim, 1)[0]!;
  assert.equal(first.state, "airborne");
  assert.equal(first.grounded, false);
  close(first.gap, FOOT_SNAP + 0.01, "support beyond allowed snap is not pulled upward");
  assert.equal(first.hp, 2);
});

test("walking off the real crown cap into a 35 m drop does not stick to the ground", t => {
  const sim = fixture(), cap = sim.solids.find(s => s.id === "crown-cap");
  assert.ok(cap && cap.kind === "cyl" && cap.r !== undefined, "original crown cap exists");
  // Initial feet overlap the cap's real support margin; ordinary D crosses it.
  // No synthetic slab, terrain function or collision data is substituted.
  Object.assign(sim.player, { x: cap.x + cap.r + 0.04, z: cap.z, y: cap.y + cap.h,
    vx: 4.4, vz: 0, vy: 0 });
  close(snapshot(sim).gap, 0, "initial feet are supported on the cap");
  pressKeyForTest("KeyD");
  const first = stepFrames(sim, 1)[0]!;
  t.diagnostic(JSON.stringify(first));
  assert.ok(first.gap > 35, "normal input crosses a real cliff");
  assert.equal(first.state, "airborne");
  assert.equal(first.grounded, false);
  close(first.y, cap.y + cap.h, "no 35 m snap in the departure frame");
  assert.equal(first.hp, 2);
});

for (const [velocity, damage] of [[-20, 0.75], [-25, 1.5]]) {
  test(`real fall from vy=${velocity} retains its ${damage} landing damage`, t => {
    const sim = fixture();
    Object.assign(sim.player, { y: RECORDED.y + 1, vx: 0, vz: 0, vy: velocity });
    sim.setMove("airborne");
    const frames = stepFrames(sim, 30), landed = frames.find(s => s.grounded);
    assert.ok(landed, "normal gravity reaches the unchanged terrain");
    t.diagnostic(JSON.stringify({ first: frames[0], landed, last: frames.at(-1) }));
    close(landed.t, 0.05, "original natural landing time");
    close(landed.gap, 0, "landed on the real terrain");
    assert.equal(landed.hp, 2 - damage);
    assert.ok(frames.filter(s => s.t < landed.t).every(s => s.hp === 2), "no early damage");
    assert.ok(frames.filter(s => s.t >= landed.t).every(s => s.hp === 2 - damage), "damage applies once");
  });
}
