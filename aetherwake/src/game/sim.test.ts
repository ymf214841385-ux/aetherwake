import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttack, meleeHit, startAttack, tickAttack } from "./combat.ts";
import { enqueueCommand, resetInput, takeSimActions } from "./input.ts";
import { CLIMB_SPEED, MANTLE_STEP_XZ, MANTLE_STEP_Y, SAVE_KEY_V1, SAVE_KEY_V2, WALK_SPEED } from "./params.ts";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import { WATER_LEVEL } from "./height.ts";
import { CITADEL_POI, isTowerRest, SHRINES, TOWER_HEIGHT, TOWERS, shrineWorldOrigin } from "./world.ts";
import { assertLegacyTowerStartBlocked, placeClearLowLedge, placeClearTowerGround } from "./mantle-fixtures.ts";

function hold(partial: Partial<ReturnType<typeof takeSimActions>>) {
  return {
    moveX: 0,
    moveY: 0,
    jump: false,
    jumpHeld: false,
    sprint: false,
    attack: false,
    bow: false,
    interact: false,
    art: false,
    pause: false,
    map: false,
    bag: false,
    dodge: false,
    climb: false,
    artSlot: -1,
    lookX: 0,
    lookY: 0,
    ...partial,
  };
}

describe("M1 locomotion and save", () => {
  it("W walk does not drain sprint stamina and matches walk speed", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const y0 = s.player.z;
    const stam = s.player.stamina;
    for (let i = 0; i < 60; i++) s.step(1 / 60, hold({ moveY: 1 }));
    assert.ok(s.player.stamina >= stam - 1, `stamina ${s.player.stamina}`);
    const dist = Math.abs(s.player.z - y0);
    assert.ok(dist > WALK_SPEED * 0.55 && dist < WALK_SPEED * 1.35, `dist ${dist}`);
  });

  it("continueSave does not write a new game over v1", () => {
    const raw = JSON.stringify({ x: 0, y: 8, z: 0, arrows: 0, hp: 2, towers: ["dawn"], orbs: 1 });
    const store = memoryStorage({ [SAVE_KEY_V1]: raw });
    const s = new Sim(store);
    s.continueSave();
    assert.equal(store.getItem(SAVE_KEY_V1), raw);
    assert.equal(s.player.x, 0);
    assert.equal(s.arrows, 0);
    assert.equal(s.player.hp, 2);
    assert.equal(store.getItem(SAVE_KEY_V2), null);
  });

  it("metal support excludes self so plates do not levitate", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const m = s.metals[0]!;
    m.held = false;
    m.vx = 0;
    m.vy = 0;
    m.vz = 0;
    const start = m.y;
    for (let i = 0; i < 3600; i++) s.step(1 / 60, hold({}));
    assert.ok(m.y < start + 1.2, `rose from ${start} to ${m.y}`);
  });

  it("jumping into a tower shaft does not snap to the cap", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS[0]!;
    s.player.x = tw.x + 5.2;
    s.player.z = tw.z;
    s.player.y = tw.y + 1;
    s.player.vy = 8;
    s.setMove("airborne");
    for (let i = 0; i < 90; i++) {
      s.player.vx = -6;
      s.step(1 / 60, hold({ moveX: -1 }));
    }
    assert.ok(s.player.y < tw.y + TOWER_HEIGHT - 8, `y=${s.player.y} tower=${tw.y + TOWER_HEIGHT}`);
  });
});

describe("combat and seal", () => {
  it("melee hits only in the active window and once per swing", () => {
    const atk = createAttack();
    startAttack(atk, false);
    tickAttack(atk, 0.05);
    assert.equal(atk.phase, "windup");
    tickAttack(atk, 0.08);
    assert.equal(atk.phase, "active");
    assert.equal(meleeHit(0, 0, 0, 0, 0, 0.8, -1.2), true);
  });

  it("new save needs three towers and four shrines", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    s.orbs = 4;
    s.shrinesOn = new Set(["rime", "burst", "pull", "still"]);
    assert.equal(s.sealIsOpen(), false);
    s.towersOn = new Set(["dawn", "mere", "crown"]);
    assert.equal(s.sealIsOpen(), true);
  });
});

function faceToward(s: Sim, x: number, z: number) {
  s.player.yaw = Math.atan2(s.player.x - x, s.player.z - z);
  s.cam.yaw = s.player.yaw;
}

function nearestRest(s: Sim, tw: (typeof TOWERS)[number], yWindow: number) {
  let best: { d: number; x: number; z: number; top: number } | null = null;
  for (const solid of s.solids) {
    if (!isTowerRest(solid.id) || !solid.id.startsWith(`${tw.id}-`) || solid.id.includes("-cap")) continue;
    const top = solid.y + solid.h;
    if (Math.abs(top - s.player.y) > yWindow) continue;
    const d = Math.hypot(s.player.x - solid.x, s.player.z - solid.z);
    if (!best || d < best.d) best = { d, x: solid.x, z: solid.z, top };
  }
  return best;
}

function climbTowardCap(s: Sim, tw: (typeof TOWERS)[number], seconds: number) {
  assertLegacyTowerStartBlocked(s, { x: tw.x + 4.7, z: tw.z, y: tw.y + 0.2 });
  placeClearTowerGround(s, tw);
  faceToward(s, tw.x, tw.z);
  s.setMove("grounded");
  const steps = Math.floor(seconds * 60);
  for (let i = 0; i < steps; i++) {
    if (s.towersOn.has(tw.id) || s.player.state === "dead") break;
    faceToward(s, tw.x, tw.z);
    const onTop = Math.hypot(s.player.x - tw.x, s.player.z - tw.z) < 5.2 && s.player.y > tw.y + TOWER_HEIGHT - 1.8;
    if (onTop) {
      s.step(1 / 60, hold({ interact: true }));
      continue;
    }
    if (s.player.state === "grounded") {
      if (s.player.y > tw.y + 1.8 && s.player.stamina < 72) {
        s.step(1 / 60, hold({}));
        continue;
      }
      s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
      continue;
    }
    if (s.player.state === "climbing") {
      const n = nearestRest(s, tw, 2.2);
      if (s.player.stamina < 28 && n) {
        if (n.top > s.player.y + 0.85) s.step(1 / 60, hold({ moveY: 1 }));
        else if (n.d > 2.4) {
          const side =
            Math.sign((n.x - tw.x) * (s.player.z - tw.z) - (n.z - tw.z) * (s.player.x - tw.x)) || 1;
          s.step(1 / 60, hold({ moveX: side, moveY: 0.2 }));
        } else s.step(1 / 60, hold({ moveY: -1 }));
        continue;
      }
      s.step(1 / 60, hold({ moveY: 1 }));
      continue;
    }
    s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
  }
}

describe("mainline reachability", () => {
  it("rest ledges let a full-stamina climb activate dawn tower", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    climbTowardCap(s, tw, 80);
    assert.equal(s.player.state === "dead", false, `died at y=${s.player.y}`);
    assert.ok(
      s.towersOn.has("dawn"),
      `towers=${[...s.towersOn]} y=${s.player.y.toFixed(2)} cap=${(tw.y + TOWER_HEIGHT).toFixed(2)} state=${s.player.state} stam=${s.player.stamina.toFixed(1)} xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`,
    );
  });

  it("gust near the ruin docks wind planks and solves the bridge", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    s.player.x = 28;
    s.player.z = 82;
    s.player.y = s.heightFn(28, 82) + 0.2;
    s.cam.yaw = 0;
    s.player.yaw = 0;
    s.art = 0;
    for (let burst = 0; burst < 4 && !s.ruinSolved; burst++) {
      s.step(1 / 60, hold({ art: true }));
      for (let i = 0; i < 90; i++) s.step(1 / 60, hold({}));
    }
    assert.equal(s.ruinSolved, true, `planks=${s.planks.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(";")}`);
  });

  it("rime/pull orbs via side walkway; still requires the freeze bridge", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    for (const sh of SHRINES) {
      s.worldKind = "overworld";
      s.shrine = null;
      s.interactLock = 0;
      s.rebuildSolids();
      s.player.x = sh.x;
      s.player.z = sh.z;
      s.player.y = sh.y + 0.2;
      s.step(1 / 60, hold({ interact: true }));
      assert.ok(s.shrine !== null, `did not enter ${sh.id}`);
      const o = shrineWorldOrigin(s.shrine!);
      if (sh.puzzle === "burst") {
        s.player.x = o.x;
        s.player.z = o.z + 11.2;
        s.player.y = o.y + 0.2;
        s.explode(o.x, o.y + 1.2, o.z + 12.4);
        assert.equal(s.crackedBroken[s.shrine!], true, "burst wall must break before the side path");
      }
      if (sh.puzzle === "still") {
        // Intended: wait for lane alignment, freeze, walk the slab.
        s.cam.yaw = Math.PI;
        s.player.yaw = Math.PI;
        for (let i = 0; i < 240; i++) {
          s.step(1 / 60, hold({ moveY: 1 }));
          if (s.player.z > o.z + 9.2) break;
        }
        for (let i = 0; i < 480 && Math.abs(s.moveBlock.x - o.x) >= 1.4; i++) s.step(1 / 60, hold({}));
        s.step(1 / 60, hold({ artSlot: 4 }));
        s.step(1 / 60, hold({ art: true }));
        assert.ok(s.moveBlock.frozen > 1, "still freeze must fire on the aligned slab");
        let reached = false;
        for (let i = 0; i < 480; i++) {
          s.cam.yaw = Math.PI;
          s.player.yaw = Math.PI;
          s.step(1 / 60, hold({ moveY: 1 }));
          if (Math.hypot(s.player.x - o.x, s.player.z - (o.z + 23)) < 2.05) {
            reached = true;
            break;
          }
          if (s.player.y < o.y - 1.2) break;
        }
        assert.ok(reached, `still bridge never reached altar y=${s.player.y.toFixed(2)} z=${s.player.z.toFixed(1)}`);
        s.step(1 / 60, hold({ interact: true }));
        assert.ok(s.shrinesOn.has("still"), `still not claimed prompt=${s.prompt}`);
        continue;
      }
      s.player.x = o.x + 7.1;
      s.player.z = o.z + 4.8;
      s.player.y = o.y + 0.2;
      s.cam.yaw = Math.PI;
      s.player.yaw = Math.PI;
      for (let i = 0; i < 360; i++) {
        s.step(1 / 60, hold({ moveY: 1 }));
        if (s.player.z > o.z + 21.5) break;
      }
      s.cam.yaw = Math.PI / 2;
      s.player.yaw = Math.PI / 2;
      for (let i = 0; i < 240; i++) {
        s.step(1 / 60, hold({ moveY: 1 }));
        if (Math.hypot(s.player.x - o.x, s.player.z - (o.z + 23)) < 1.8) break;
      }
      s.step(1 / 60, hold({ interact: true }));
      assert.ok(s.shrinesOn.has(sh.id), `missing orb for ${sh.id} pos=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)} shrines=${[...s.shrinesOn]} prompt=${s.prompt} shrine=${s.shrine}`);
    }
    assert.equal(s.orbs, 4);
  });

  it("S or empty stamina does not teleport 12m onto a far ledge", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    s.player.x = tw.x + 4.7;
    s.player.z = tw.z;
    s.player.y = tw.y + 10.4;
    s.player.stamina = 1;
    faceToward(s, tw.x, tw.z);
    s.setMove("climbing");
    const start = { x: s.player.x, y: s.player.y, z: s.player.z };
    let maxStep = 0;
    for (let i = 0; i < 12; i++) {
      const px = s.player.x;
      const py = s.player.y;
      const pz = s.player.z;
      s.step(1 / 60, hold({ moveY: -1 }));
      const step = Math.hypot(s.player.x - px, s.player.z - pz);
      const dy = Math.abs(s.player.y - py);
      if (step > maxStep) maxStep = step;
      assert.ok(step <= 0.45, `step ${i} xz=${step.toFixed(3)} looks like a teleport`);
      assert.ok(dy <= MANTLE_STEP_Y + CLIMB_SPEED / 60 + 0.35, `step ${i} dy=${dy.toFixed(3)}`);
    }
    const travel = Math.hypot(s.player.x - start.x, s.player.z - start.z);
    assert.ok(travel < 3.2, `teleport travel xz=${travel.toFixed(2)} from ${start.x.toFixed(1)},${start.z.toFixed(1)} to ${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`);
    assert.ok(maxStep < MANTLE_STEP_XZ + 0.35, `max step ${maxStep}`);
  });

  it("idle hang on a wall drains stamina instead of regenerating a full bar", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    s.player.x = tw.x + 4.7;
    s.player.z = tw.z;
    s.player.y = tw.y + 6;
    faceToward(s, tw.x, tw.z);
    s.setMove("climbing");
    s.player.stamina = 40;
    for (let i = 0; i < 120; i++) s.step(1 / 60, hold({}));
    assert.ok(s.player.stamina < 40, `hang regenerated stamina to ${s.player.stamina}`);
  });

  it("after a ledge rest, holding forward re-grabs the shaft instead of walking off", t => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    assertLegacyTowerStartBlocked(s, { x: tw.x + 4.7, z: tw.z, y: tw.y + 0.2 });
    placeClearLowLedge(s, tw, 0);
    faceToward(s, tw.x, tw.z);
    s.setMove("grounded");
    for (let i = 0; i < 90; i++) {
      faceToward(s, tw.x, tw.z);
      s.step(1 / 60, hold({ moveY: 1, interact: s.player.state !== "climbing", climb: s.player.state !== "climbing" }));
    }
    assert.ok(s.player.state === "climbing", `state=${s.player.state} y=${s.player.y}`);
    t.diagnostic(JSON.stringify({ beforeRest: { x: s.player.x, y: s.player.y, z: s.player.z, state: s.player.state },
      nearestRestWithinOriginalWindow: nearestRest(s, tw, 2.2) }));
    s.player.stamina = 4;
    for (let i = 0; i < 90 && s.player.state === "climbing"; i++) s.step(1 / 60, hold({ moveY: -1 }));
    assert.equal(s.player.state, "grounded", `S did not land a rest state=${s.player.state} y=${s.player.y}`);
    assert.ok(s.player.y > tw.y + 1.5, `rest y=${s.player.y} is not a ledge`);
    const restY = s.player.y;
    const restXz = Math.hypot(s.player.x - tw.x, s.player.z - tw.z);
    s.player.stamina = 90;
    faceToward(s, tw.x, tw.z);
    for (let i = 0; i < 45; i++) {
      faceToward(s, tw.x, tw.z);
      s.step(1 / 60, hold({ moveY: 1 }));
    }
    assert.notEqual(s.player.state, "airborne", `walked off rest y=${s.player.y} was ${restY}`);
    assert.ok(Math.hypot(s.player.x - tw.x, s.player.z - tw.z) < restXz + 1.2, "walked away from the shaft");
    assert.ok(
      s.player.state === "climbing" || s.player.y >= restY - 0.4,
      `regrab failed state=${s.player.state} y=${s.player.y} restY=${restY} xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`,
    );
  });

  it("swimming up to mere starts a climb on the shaft or dock", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS.find((t) => t.id === "mere")!;
    s.player.x = tw.x + 11;
    s.player.z = tw.z;
    s.player.y = WATER_LEVEL - 0.6;
    s.setMove("swimming");
    faceToward(s, tw.x, tw.z);
    for (let i = 0; i < 240; i++) {
      faceToward(s, tw.x, tw.z);
      const grab = s.player.state === "swimming" || s.player.state === "grounded";
      s.step(1 / 60, hold({ moveY: 1, interact: grab, climb: grab }));
      if (s.player.state === "climbing" || (s.player.state === "grounded" && s.player.y > WATER_LEVEL + 0.2)) break;
    }
    assert.notEqual(s.player.state, "dead");
    assert.ok(
      s.player.state === "climbing" || s.player.y >= WATER_LEVEL - 0.05,
      `swim-approach state=${s.player.state} y=${s.player.y.toFixed(2)} xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`,
    );
  });

  it("mere can be climbed from the waterline dock and activated", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS.find((t) => t.id === "mere")!;
    climbTowardCap(s, tw, 90);
    assert.equal(s.player.state === "dead", false, `died at y=${s.player.y}`);
    assert.ok(
      s.towersOn.has("mere"),
      `towers=${[...s.towersOn]} y=${s.player.y.toFixed(2)} cap=${(tw.y + TOWER_HEIGHT).toFixed(2)} state=${s.player.state} stam=${s.player.stamina.toFixed(1)} xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`,
    );
  });

  it("crown climb is sheltered from frost on the tower", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const tw = TOWERS.find((t) => t.id === "crown")!;
    s.player.spicy = 0;
    s.player.hp = s.player.heartsMax;
    climbTowardCap(s, tw, 90);
    assert.equal(s.player.state === "dead", false, `frost death y=${s.player.y} hp=${s.player.hp} cold=${s.player.cold}`);
    assert.ok(
      s.towersOn.has("crown"),
      `towers=${[...s.towersOn]} y=${s.player.y.toFixed(2)} hp=${s.player.hp} cold=${s.player.cold} state=${s.player.state}`,
    );
  });
});

describe("dodge faces the camera, not a stale body yaw", () => {
  it("C with no WASD dashes along cam.yaw", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    s.player.x = 16;
    s.player.z = 96;
    s.player.y = s.heightFn(16, 96);
    s.setMove("grounded");
    s.player.stamina = 100;
    s.player.yaw = Math.PI;
    s.cam.yaw = 0;
    const z0 = s.player.z;
    s.step(1 / 60, hold({ dodge: true }));
    for (let i = 0; i < 8; i++) s.step(1 / 60, hold({}));
    assert.ok(
      s.player.z < z0 - 0.05,
      `dodge along stale body yaw went the wrong way dz=${(s.player.z - z0).toFixed(3)} camYaw=${s.cam.yaw} bodyYaw=${s.player.yaw}`,
    );
  });
});

describe("melee faces the camera, not a stale body yaw", () => {
  it("look-then-click hits the enemy in front of the camera", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    s.player.x = 16;
    s.player.z = 96;
    s.player.y = s.heightFn(16, 96);
    s.setMove("grounded");
    s.cam.yaw = 0;
    s.player.yaw = Math.PI;
    const foe = s.makeEnemy("cam-dummy", "bramble", 16, 94.6, 8);
    foe.y = s.player.y;
    s.enemies.push(foe);
    const hp0 = foe.hp;
    s.step(1 / 60, hold({ attack: true }));
    for (let i = 0; i < 18; i++) s.step(1 / 60, hold({}));
    assert.ok(
      foe.hp < hp0,
      `camera-facing swing missed hp ${hp0}->${foe.hp} phase=${s.attack.phase} bodyYaw=${s.player.yaw.toFixed(2)} camYaw=${s.cam.yaw.toFixed(2)} — melee must use look yaw`,
    );
  });
});

describe("ruinSolved save schema", () => {
  it("true before reload stays true after continueSave (missing persist was the 78945 drop)", () => {
    const store = memoryStorage();
    const s = new Sim(store);
    s.freshRuntime(false);
    s.ruinSolved = true;
    s.save();
    const s2 = new Sim(store);
    s2.continueSave();
    assert.equal(s2.ruinSolved, true, "wind-bridge solved flag must survive 继续旅途");
    assert.equal(s2.planksBridge(), true, "docked planks must still form the bridge after load");
  });
});

describe("boss live target vs static citadel POI", () => {
  function openSeal(s: Sim) {
    for (const t of TOWERS) s.towersOn.add(t.id);
    for (const sh of SHRINES) {
      s.shrinesOn.add(sh.id);
      s.orbs += 1;
    }
  }

  function swingAt(s: Sim) {
    s.step(1 / 60, hold({ attack: true }));
    for (let i = 0; i < 20; i++) s.step(1 / 60, hold({}));
  }

  it("swinging at the static spawn point misses a boss that has walked off it", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    assert.equal(s.sealIsOpen(), true);
    const boss = s.enemies.find((e) => e.kind === "boss")!;
    const spawnZ = CITADEL_POI.z + 7.2;
    s.player.x = CITADEL_POI.x;
    s.player.z = spawnZ;
    s.player.y = s.heightFn(s.player.x, s.player.z);
    s.setMove("grounded");
    boss.x = CITADEL_POI.x + 8;
    boss.z = spawnZ;
    boss.y = s.player.y;
    boss.alive = true;
    faceToward(s, CITADEL_POI.x, spawnZ);
    const hp0 = boss.hp;
    swingAt(s);
    assert.equal(boss.hp, hp0, `static-POI swing should miss a moved boss hp=${boss.hp} dist=${Math.hypot(s.player.x - boss.x, s.player.z - boss.z).toFixed(2)}`);
    faceToward(s, boss.x, boss.z);
    for (let i = 0; i < 90 && Math.hypot(s.player.x - boss.x, s.player.z - boss.z) > 1.8; i++) {
      faceToward(s, boss.x, boss.z);
      s.step(1 / 60, hold({ moveY: 1 }));
    }
    faceToward(s, boss.x, boss.z);
    swingAt(s);
    assert.ok(
      boss.hp < hp0,
      `live-target swing missed hp ${hp0}->${boss.hp} dist=${Math.hypot(s.player.x - boss.x, s.player.z - boss.z).toFixed(2)} yaw=${s.player.yaw.toFixed(2)}`,
    );
  });

  it("ordinary melee + dodge can kill the live boss (no invuln cheat)", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    const boss = s.enemies.find((e) => e.kind === "boss")!;
    s.player.x = boss.x;
    s.player.z = boss.z + 2.2;
    s.player.y = s.heightFn(s.player.x, s.player.z);
    s.setMove("grounded");
    let attacks = 0;
    let last = { dist: 0, phase: "", bphase: "", los: false, hit: false };
    for (let i = 0; i < 1800 && boss.alive && s.mode !== "ending"; i++) {
      faceToward(s, boss.x, boss.z);
      const dist = Math.hypot(s.player.x - boss.x, s.player.z - boss.z);
      const dodge = boss.brain.phase === "windup" || boss.brain.phase === "strike" || s.player.hp < 1.6;
      const attack = s.attack.phase === "idle" && dist <= 2.7 && !dodge;
      if (attack) attacks += 1;
      const moveY = dist > 2.55 ? 1 : dist < 1.65 ? -1 : 0;
      const moveX = dist < 1.7 ? 1 : 0;
      const hp0 = boss.hp;
      s.step(1 / 60, hold({ moveX, moveY, attack, dodge }));
      last = {
        dist,
        phase: s.attack.phase,
        bphase: boss.brain.phase,
        los: false,
        hit: boss.hp < hp0,
      };
      if (s.mode === "dead") {
        s.respawn();
        s.player.x = boss.x;
        s.player.z = boss.z + 2.2;
        s.player.y = s.heightFn(s.player.x, s.player.z);
        s.setMove("grounded");
      }
    }
    assert.equal(
      boss.alive,
      false,
      `boss still up hp=${boss.hp} playerHp=${s.player.hp} mode=${s.mode} attacks=${attacks} dist=${last.dist.toFixed(2)} atk=${last.phase} brain=${last.bphase} xy=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)} boss=${boss.x.toFixed(1)},${boss.z.toFixed(1)} — knockback must not bury the boss in the keep`,
    );
    assert.equal(s.bossDead, true);
    assert.equal(s.mode, "ending");
  });
});

describe("input queue with sim", () => {
  it("queued jump is consumed on the next step only", () => {
    resetInput();
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    enqueueCommand("jump");
    const a = takeSimActions({ consumeCommands: true, consumeLook: false });
    s.step(1 / 60, a);
    assert.ok(s.player.vy > 0 || s.player.state === "airborne" || s.player.state === "gliding" || s.player.state === "grounded");
  });
});
