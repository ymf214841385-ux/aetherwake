import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Sim } from "./sim.ts";
import { memoryStorage } from "./persistence.ts";
import { enqueueCommand, pressKeyForTest, releaseKeyForTest, resetInput, takeSimActions } from "./input.ts";
import { CLIMB_SHIMMY, CLIMB_SPEED, FIXED_DT, MANTLE_REACH_Y, MANTLE_STEP_XZ, MANTLE_STEP_Y, PLAYER_HEIGHT, PLAYER_RADIUS } from "./params.ts";
import { SHRINES, TOWERS, TOWER_RADIUS, shrineWorldOrigin } from "./world.ts";
import { playerBodyClear, sweepPlayerBody } from "./physics.ts";

afterEach(resetInput);
const consume = () => takeSimActions({ consumeCommands: true, consumeLook: true });
function fixture(id: string, kind: string) {
  resetInput();
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  const tw = TOWERS.find(t => t.id === id)!;
  const shaft = sim.solids.find(s => s.id === `${id}-shaft`)!;
  const top = shaft.y + shaft.h;
  // A controlled initial grip on the original tower, not a browser/full-route
  // replay. After this setup only production keyboard commands and steps run.
  Object.assign(sim.player, { x: tw.x + TOWER_RADIUS + 0.5, z: tw.z, y: top - 1.72,
    vx: 0, vy: 0, vz: 0, stamina: 100, hp: 3, invuln: 0, dodgeCd: 0, dodgeT: 0 });
  sim.setMove("climbing");
  sim.cam.yaw = sim.player.yaw = Math.PI / 2;
  const roof = { id: "controlled-mantle-roof", kind: "box" as const,
    x: tw.x, z: tw.z, y: top + 0.8, h: 0.2, w: 8, d: 8, standable: true };
  if (kind === "roof") sim.solids.push(roof);
  if (kind === "legal-top") {
    const ledge = sim.solids.find(s => s.id === `${id}-ledge-8`)!;
    sim.player.y = ledge.y + ledge.h + 0.02;
  }
  if (kind === "under-ledge") {
    const ledge = sim.solids.find(s => s.id === `${id}-ledge-4`)!;
    sim.player.y = ledge.y - PLAYER_HEIGHT - 0.1;
  }
  if (kind.startsWith("rest")) {
    const ledge = sim.solids.find(s => s.id === `${id}-ledge-4`)!;
    Object.assign(sim.player, { x: ledge.x, z: ledge.z, y: ledge.y + ledge.h,
      stamina: kind === "rest-exhaust" ? 1 : 100 });
  }
  return { sim, tw, roof };
}

function activeFixture() {
  const { sim } = fixture("dawn", "legal-top");
  pressKeyForTest("KeyW");
  advance(sim, 1);
  releaseKeyForTest("KeyW");
  assert.ok(sim.mantle, "ordinary W starts the validated process");
  return sim;
}

test("C cancels an overhang preparation before another outside step", () => {
  const { sim } = fixture("dawn", "under-ledge");
  pressKeyForTest("KeyW");
  advance(sim, 2);
  assert.ok(sim.mantle && sim.mantle.phase < sim.mantle.reachPhase);
  const before = { ...sim.player };
  pressKeyForTest("KeyC");
  enqueueCommand("dodge");
  advance(sim, 1);
  assert.equal(sim.mantle, null);
  assert.equal(sim.player.state, "airborne");
  assert.equal(sim.player.y, before.y);
  assert.equal(sim.player.stamina, before.stamina);
  assert.ok(playerBodyClear(sim.player, sim.solids, sim.heightFn));
});

test("overhang preparation naturally exhausts low initial stamina and cancels", () => {
  const { sim } = fixture("dawn", "under-ledge");
  // Low-resource controlled initial grip; never refill resources after stepping.
  sim.player.stamina = 3;
  pressKeyForTest("KeyW");
  let sawPreparation = false;
  for (let n = 0; n < 60 && sim.player.state === "climbing"; n++) {
    advance(sim, 1);
    sawPreparation ||= !!sim.mantle;
    assert.ok(playerBodyClear(sim.player, sim.solids, sim.heightFn));
  }
  assert.ok(sawPreparation);
  assert.equal(sim.mantle, null);
  assert.equal(sim.player.state, "airborne");
  assert.ok(sim.player.stamina <= 0);
  assert.equal(sim.player.hp, 3);
});

test("C cancels an active mantle before any further automatic movement", () => {
  const sim = activeFixture(), before = { ...sim.player };
  pressKeyForTest("KeyS");
  pressKeyForTest("KeyC");
  enqueueCommand("dodge");
  advance(sim, 1);
  assert.equal(sim.mantle, null);
  assert.equal(sim.player.state, "airborne");
  assert.equal(sim.player.y, before.y);
  assert.equal(sim.player.vy, 0.6);
  assert.equal(sim.player.hp, before.hp);
  assert.equal(sim.player.stamina, before.stamina);
});

test("ordinary Escape pauses mantle progress and resumes from the same fixed-step pose", () => {
  const sim = activeFixture(), before = { ...sim.player }, elapsed = sim.mantle!.elapsed;
  pressKeyForTest("Escape");
  advance(sim, 1);
  releaseKeyForTest("Escape");
  assert.equal(sim.mode, "paused");
  advance(sim, 60);
  assert.deepEqual(sim.player, before);
  assert.equal(sim.mantle!.elapsed, elapsed);
  pressKeyForTest("Escape");
  advance(sim, 1);
  releaseKeyForTest("Escape");
  assert.equal(sim.mode, "playing");
  advance(sim, 60);
  assert.equal(sim.mantle, null);
  assert.equal(sim.player.state, "grounded");
});

for (const cancel of ["death", "reset", "continue"] as const) {
  test(`production ${cancel} lifecycle clears a transient mantle`, () => {
    const sim = activeFixture();
    // Lifecycle-unit coverage calls real production entry points. This does
    // not claim a browser death, nor replenish resources during a climb test.
    if (cancel === "death") sim.die("test lifecycle");
    else if (cancel === "reset") sim.freshRuntime(false);
    else sim.applySave(sim.captureSave());
    assert.equal(sim.mantle, null);
  });
}
function advance(sim: Sim, count: number) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    sim.step(FIXED_DT, consume());
    frames.push({ ...sim.player, t: sim.t });
  }
  return frames;
}
for (const id of ["dawn", "mere", "crown"]) {
  test(`${id}: a clear terrain start enters climbing normally and reaches the cap without body overlap`, t => {
    resetInput();
    const sim = new Sim(memoryStorage());
    sim.freshRuntime(false);
    const tw = TOWERS.find(q => q.id === id)!;
    // Real terrain gaps between the authored low ledges. Legacy route fixtures
    // at x+4.7/y=base+.2 start inside a ledge (and sometimes below terrain).
    const angle = id === "dawn" ? 11 * Math.PI / 32 : id === "mere" ? Math.PI / 32 : 0;
    sim.player.x = tw.x + Math.cos(angle) * 4.6;
    sim.player.z = tw.z + Math.sin(angle) * 4.6;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    sim.player.yaw = sim.cam.yaw = Math.atan2(sim.player.x - tw.x, sim.player.z - tw.z);
    sim.setMove("grounded");
    assert.ok(playerBodyClear(sim.player, sim.solids, sim.heightFn));
    const initial = { ...sim.player }, cap = sim.solids.find(q => q.id === `${id}-cap`)!;
    pressKeyForTest("KeyE");
    let climbed = false, n = 0;
    for (; n < 4800; n++) {
      if (sim.player.grounded && Math.abs(sim.player.y - cap.y - cap.h) < 1e-6) break;
      const resting = sim.player.grounded && sim.player.y > initial.y + 0.5 && sim.player.stamina < 88;
      // Match the pre-existing route's rest decision, now through normal keys.
      const rest = sim.solids.filter(q => q.id.startsWith(`${id}-`) && (q.id.includes("-ledge-") || q.id.includes("-spiral-")) &&
        Math.abs(q.y + q.h - sim.player.y) < 2.2)
        .sort((a, b) => Math.hypot(sim.player.x - a.x, sim.player.z - a.z) - Math.hypot(sim.player.x - b.x, sim.player.z - b.z))[0];
      const ontoRest = sim.player.state === "climbing" && sim.player.stamina < 28 && rest && rest.y + rest.h <= sim.player.y + 0.85;
      if (resting || ontoRest) releaseKeyForTest("KeyW"); else pressKeyForTest("KeyW");
      if (ontoRest) pressKeyForTest("KeyS"); else releaseKeyForTest("KeyS");
      const before = { ...sim.player }, mantleBefore = sim.mantle ? structuredClone(sim.mantle) : null;
      advance(sim, 1);
      releaseKeyForTest("KeyE");
      climbed ||= sim.player.state === "climbing";
      const clear = playerBodyClear(sim.player, sim.solids, sim.heightFn);
      if (!clear || sim.player.hp !== 3) t.diagnostic(JSON.stringify({ frame: n + 1, input: resting ? [] : ontoRest ? ["KeyS"] : ["KeyW"], before, after: sim.player,
        mantleBefore, mantleAfter: sim.mantle, overlap: sim.solids.filter(q => !sweepPlayerBody(sim.player, sim.player, [q])).map(q => q.id) }));
      assert.ok(clear, `body clear at frame ${n + 1}`);
      assert.equal(sim.player.hp, 3);
    }
    t.diagnostic(JSON.stringify({ initial, frames: n, final: sim.player }));
    assert.ok(climbed, "normal E/W entered climbing");
    assert.ok(n < 4800, "the unchanged stamina budget reaches the real cap");
    assert.ok(Math.hypot(sim.player.x - cap.x, sim.player.z - cap.z) < cap.r! - PLAYER_RADIUS);
    releaseKeyForTest("KeyW");
    pressKeyForTest("KeyE");
    advance(sim, 1);
    assert.ok(sim.towersOn.has(id));
  });
  test(`${id}: normal W cannot climb through the underside of an authored thin ledge`, t => {
    const { sim } = fixture(id, "under-ledge");
    const ledge = sim.solids.find(s => s.id === `${id}-ledge-4`)!;
    assert.ok(playerBodyClear(sim.player, sim.solids, sim.heightFn), "initial real grip is clear");
    pressKeyForTest("KeyW");
    let sawPreparation = false, sawReach = false, count = 0;
    for (; count < 200 && sim.player.state !== "grounded"; count++) {
      const before = { ...sim.player };
      const phase = sim.mantle?.phase, reachPhase = sim.mantle?.reachPhase;
      if (phase !== undefined && reachPhase !== undefined && phase < reachPhase) sawPreparation = true;
      if (phase === reachPhase && sim.mantle) {
        sawReach = true;
        assert.ok(ledge.y + ledge.h - before.y <= MANTLE_REACH_Y + 1e-8);
      }
      advance(sim, 1);
      const clear = playerBodyClear(sim.player, sim.solids, sim.heightFn);
      if (!clear) t.diagnostic(JSON.stringify({ before, after: sim.player, t: sim.t }));
      assert.ok(clear, "climb movement must validate the whole body before committing");
      assert.equal(sim.player.hp, 3);
      const preparing = phase !== undefined && reachPhase !== undefined && phase < reachPhase;
      assert.ok(Math.hypot(sim.player.x - before.x, sim.player.z - before.z) <=
        (preparing ? CLIMB_SHIMMY * FIXED_DT : MANTLE_STEP_XZ) + 1e-8);
      assert.ok(Math.abs(sim.player.y - before.y) <=
        (preparing ? CLIMB_SPEED * FIXED_DT : MANTLE_STEP_Y) + 1e-8);
    }
    assert.ok(sawPreparation && sawReach, "round the edge before entering unchanged mantle reach");
    assert.ok(count < 200, "bounded normal-input route lands on the real ledge");
    assert.equal(sim.player.state, "grounded");
    assert.ok(Math.abs(sim.player.y - ledge.y - ledge.h) < 1e-8);
    assert.ok(sim.player.stamina < 100 && sim.player.stamina > 0, "preparation spends ordinary climbing stamina");
    t.diagnostic(JSON.stringify({ count, landed: sim.player }));
  });
  test(`${id}: legacy overlapping top grip recovers without the old top teleport`, t => {
    const { sim } = fixture(id, "top"), initial = { ...sim.player };
    assert.equal(playerBodyClear(initial, sim.solids, sim.heightFn), false,
      "legacy initial body overlaps its authored thin top ledge; not a clean route fixture");
    pressKeyForTest("KeyW");
    const frames = advance(sim, 100);
    releaseKeyForTest("KeyW");
    t.diagnostic(JSON.stringify({ initial, first: frames[0], final: frames.at(-1) }));
    let before = initial;
    for (const p of frames) {
      assert.ok(Math.hypot(p.x - before.x, p.z - before.z) <= MANTLE_STEP_XZ + 1e-6,
        `horizontal jump at t=${p.t}`);
      assert.ok(Math.abs(p.y - before.y) <= MANTLE_STEP_Y + 1e-6, `vertical jump at t=${p.t}`);
      before = p;
    }
    assert.equal(sim.player.y, initial.y, "an already overlapping fixture must not climb deeper");
    assert.equal(sim.mantle, null, "invalid starting geometry cannot start a mantle");
    assert.ok(frames.every(p => p.hp === 3 && p.stamina <= 100));
    pressKeyForTest("KeyC");
    enqueueCommand("dodge");
    advance(sim, 1);
    assert.equal(sim.player.state, "airborne", "explicit cancel remains available");
    assert.equal(sim.player.y, initial.y);
  });
  test(`${id}: clear legal grip reaches the real cap with a clear continuous body path`, () => {
    const { sim } = fixture(id, "legal-top");
    assert.equal(playerBodyClear(sim.player, sim.solids, sim.heightFn), true);
    pressKeyForTest("KeyW");
    let before = { ...sim.player }, frames = 0;
    while (sim.player.state !== "grounded" && frames++ < 100) {
      advance(sim, 1);
      assert.ok(Math.hypot(sim.player.x - before.x, sim.player.z - before.z) <= MANTLE_STEP_XZ + 1e-6);
      assert.ok(Math.abs(sim.player.y - before.y) <= MANTLE_STEP_Y + 1e-6);
      assert.equal(playerBodyClear(sim.player, sim.solids, sim.heightFn), true, `clear body at frame ${frames}`);
      assert.equal(sim.player.hp, 3);
      before = { ...sim.player };
    }
    releaseKeyForTest("KeyW");
    assert.ok(frames > 2 && frames < 100, "a bounded multi-step transition completed");
    const cap = sim.solids.find(s => s.id === `${id}-cap`)!;
    assert.equal(sim.player.state, "grounded");
    assert.ok(Math.abs(sim.player.y - cap.y - cap.h) < 1e-6);
    assert.ok(Math.hypot(sim.player.x - cap.x, sim.player.z - cap.z) < cap.r! - PLAYER_RADIUS);
    pressKeyForTest("KeyE");
    advance(sim, 1);
    assert.ok(sim.towersOn.has(id));
  });
  test(`${id}: a thin low ceiling blocks the mantle without head penetration`, () => {
    const { sim, roof } = fixture(id, "roof");
    const intersects = (p: typeof sim.player) => Math.abs(p.x - roof.x) < roof.w / 2 + PLAYER_RADIUS &&
      Math.abs(p.z - roof.z) < roof.d / 2 + PLAYER_RADIUS && p.y < roof.y + roof.h && p.y + PLAYER_HEIGHT > roof.y;
    assert.equal(intersects(sim.player), false, "initial body is clear");
    pressKeyForTest("KeyW");
    const frames = advance(sim, 80);
    assert.ok(frames.every(p => !intersects(p)), "no frame intersects the thin ceiling");
    assert.ok(frames.every(p => p.hp === 3));
    assert.ok(!sim.towersOn.has(id));
  });
  for (const kind of ["rest-back", "rest-exhaust", "rest-control"]) {
    test(`${id}: C dismount has priority for ${kind}`, () => {
      const { sim } = fixture(id, kind), start = { ...sim.player };
      if (kind === "rest-back") pressKeyForTest("KeyS");
      pressKeyForTest("KeyC");
      // Test transport mirrors production nonrepeat C; helper only holds C.
      enqueueCommand("dodge");
      const a = consume();
      assert.equal(a.dodge, true);
      sim.step(FIXED_DT, a);
      assert.equal(sim.player.state, "airborne");
      assert.equal(sim.player.vy, 0.6);
      assert.ok(Math.hypot(sim.player.x - start.x, sim.player.z - start.z) <= 0.35 + 1e-6);
      assert.equal(sim.player.hp, start.hp);
      assert.equal(sim.player.stamina, start.stamina);
    });
  }
}

test("rime pit normal E then W completes onto the actual pad without collecting the shrine", t => {
  resetInput();
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  // Controlled room-start fixture; original room solids and terrain remain.
  sim.shrine = SHRINES.findIndex(q => q.id === "rime");
  sim.rebuildSolids();
  const o = shrineWorldOrigin(sim.shrine);
  Object.assign(sim.player, { x: o.x, z: o.z + 18.870817271970786, y: sim.heightFn(o.x, o.z + 12), vx: 0, vy: 0, vz: 0 });
  sim.player.yaw = sim.cam.yaw = Math.PI;
  sim.setMove("grounded");
  assert.ok(playerBodyClear(sim.player, sim.solids, sim.heightFn));
  pressKeyForTest("KeyW");
  pressKeyForTest("KeyE");
  let n = 0, sawMantle = false;
  for (; n < 480; n++) {
    advance(sim, 1);
    releaseKeyForTest("KeyE");
    sawMantle ||= !!sim.mantle;
    assert.ok(playerBodyClear(sim.player, sim.solids, sim.heightFn), `clear body at frame ${n}`);
    assert.equal(sim.player.hp, 3);
    if (sim.player.grounded && sim.player.z - o.z > 20.4 && sim.player.y > o.y - 1) break;
  }
  t.diagnostic(JSON.stringify({ n, final: sim.player }));
  assert.ok(sawMantle && n < 480);
  assert.equal(sim.mantle, null);
  assert.equal(sim.orbs, 0);
  assert.equal(sim.shrinesOn.size, 0);
  assert.equal(sim.solids.find(q => q.id === "pit-n")!.standable, false);
});
