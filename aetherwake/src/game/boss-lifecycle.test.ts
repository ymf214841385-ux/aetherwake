/**
 * P0-1: Boss attack state machine — recover must not be stolen by distance.
 * Failure sample: player backs out of meleeR during recover; old code set
 * phase="approach" every tick while dist>3.4, wiping the counter window.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import { CITADEL_POI, SHRINES, TOWERS } from "./world.ts";

type Act = Parameters<Sim["step"]>[1];

function hold(partial: Partial<Act> = {}): Act {
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

function openSeal(s: Sim) {
  for (const t of TOWERS) s.towersOn.add(t.id);
  for (const sh of SHRINES) {
    s.shrinesOn.add(sh.id);
    s.orbs += 1;
  }
}

function bossOf(s: Sim) {
  const boss = s.enemies.find((e) => e.kind === "boss");
  assert.ok(boss, "missing boss");
  return boss;
}

function placePlayer(s: Sim, x: number, z: number) {
  s.player.x = x;
  s.player.z = z;
  s.player.y = s.heightFn(x, z) + 0.2;
  s.player.vx = 0;
  s.player.vy = 0;
  s.player.vz = 0;
  s.player.hp = s.player.heartsMax;
  s.player.invuln = 1.0;
  s.setMove("grounded");
}

describe("P0-1 boss attack state machine", () => {
  it("recover is not rewritten to approach when player leaves meleeR", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    const cz = CITADEL_POI.z + 7.2;
    placePlayer(s, CITADEL_POI.x + 2.0, cz);
    boss.x = CITADEL_POI.x;
    boss.z = cz;
    boss.y = s.heightFn(boss.x, boss.z);
    boss.alive = true;
    boss.brain.phase = "recover";
    boss.brain.t = 0.9;
    // Player just outside boss meleeR (3.4) — dodge-out after a strike.
    placePlayer(s, CITADEL_POI.x + 5.0, cz);
    const t0 = boss.brain.t;
    for (let i = 0; i < 12; i++) {
      s.step(1 / 60, hold({}));
    }
    assert.equal(
      boss.brain.phase,
      "recover",
      `recover stolen by distance: phase=${boss.brain.phase} t=${boss.brain.t.toFixed(3)} dist=${Math.hypot(s.player.x - boss.x, s.player.z - boss.z).toFixed(2)}`,
    );
    assert.ok(
      boss.brain.t < t0,
      `recover timer must tick t ${t0.toFixed(3)}→${boss.brain.t.toFixed(3)}`,
    );
  });

  it("recover completes to approach only after its own timer", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    const cz = CITADEL_POI.z + 7.2;
    boss.x = CITADEL_POI.x;
    boss.z = cz;
    boss.y = s.heightFn(boss.x, cz);
    boss.alive = true;
    boss.brain.phase = "recover";
    boss.brain.t = 0.2;
    placePlayer(s, CITADEL_POI.x + 5.0, cz);
    for (let i = 0; i < 30; i++) s.step(1 / 60, hold({}));
    assert.equal(boss.brain.phase, "approach", `phase=${boss.brain.phase} t=${boss.brain.t}`);
  });

  it("windup is not cancelled when player steps outside meleeR mid-telegraph", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    const cz = CITADEL_POI.z + 7.2;
    boss.x = CITADEL_POI.x;
    boss.z = cz;
    boss.y = s.heightFn(boss.x, cz);
    boss.alive = true;
    boss.brain.phase = "windup";
    boss.brain.t = 0.5;
    boss.telegraph = 0.5;
    placePlayer(s, CITADEL_POI.x + 2.5, cz);
    // One step into telegraph, then leave meleeR.
    s.step(1 / 60, hold({}));
    placePlayer(s, CITADEL_POI.x + 5.5, cz);
    for (let i = 0; i < 8; i++) s.step(1 / 60, hold({}));
    assert.ok(
      boss.brain.phase === "windup" || boss.brain.phase === "strike" || boss.brain.phase === "recover",
      `telegraph chain broken by distance: phase=${boss.brain.phase}`,
    );
  });

  it("hurt ends into approach (not mid-chain recover) while player in aggro", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    const cz = CITADEL_POI.z + 7.2;
    boss.x = CITADEL_POI.x;
    boss.z = cz;
    boss.y = s.heightFn(boss.x, cz);
    boss.alive = true;
    boss.brain.phase = "hurt";
    boss.hurt = 0.05;
    placePlayer(s, CITADEL_POI.x + 4, cz);
    for (let i = 0; i < 10; i++) s.step(1 / 60, hold({}));
    const phase: string = boss.brain.phase;
    assert.ok(
      phase === "approach" || phase === "windup" || phase === "detect",
      `hurt exit phase=${phase}`,
    );
  });

  it("controlled sim: each recover window allows one landed counter", () => {
    // Controlled unit test of the counter window — NOT browser ordinary-input
    // acceptance. Forces brain.phase=recover (game state, not Boss HP/pos
    // cheat). Real 3-round acceptance must be browser key/mouse without
    // writing recover phase or resources.
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    const cz = CITADEL_POI.z + 7.2;
    boss.x = CITADEL_POI.x;
    boss.z = cz;
    boss.y = s.heightFn(boss.x, cz);
    boss.alive = true;
    let hits = 0;
    let hp = boss.hp;
    for (let n = 0; n < 3 && boss.alive; n++) {
      placePlayer(s, boss.x, boss.z + 2.2);
      s.player.invuln = 2;
      boss.brain.phase = "recover";
      boss.brain.t = 1.0;
      // Same facing convention as sim.test.ts faceToward.
      s.player.yaw = Math.atan2(s.player.x - boss.x, s.player.z - boss.z);
      s.cam.yaw = s.player.yaw;
      for (let k = 0; k < 24; k++) {
        s.player.yaw = Math.atan2(s.player.x - boss.x, s.player.z - boss.z);
        s.cam.yaw = s.player.yaw;
        const dist = Math.hypot(s.player.x - boss.x, s.player.z - boss.z);
        const attack = s.attack.phase === "idle" && dist <= 2.7;
        s.step(1 / 60, hold({ attack, moveY: dist > 2.55 ? 1 : dist < 1.65 ? -1 : 0 }));
      }
      if (boss.hp < hp - 0.01) {
        hits += 1;
        hp = boss.hp;
      }
      for (let k = 0; k < 40; k++) s.step(1 / 60, hold({}));
    }
    assert.ok(
      hits >= 3,
      `each recover window must allow a counter, hits=${hits} bossHp=${hp}`,
    );
  });

  it("recover still ticks when player is blocked / tall dy / beyond aggro", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    const cz = CITADEL_POI.z + 7.2;
    boss.x = CITADEL_POI.x;
    boss.z = cz;
    boss.y = s.heightFn(boss.x, cz);
    boss.alive = true;
    boss.brain.phase = "recover";
    boss.brain.t = 0.8;
    // Far + high: outside aggro gate (dist>28 or dy) — chain must still run.
    placePlayer(s, CITADEL_POI.x, cz + 40);
    s.player.y = boss.y + 8;
    const t0 = boss.brain.t;
    for (let i = 0; i < 20; i++) s.step(1 / 60, hold({}));
    assert.equal(boss.brain.phase, "recover", `phase=${boss.brain.phase}`);
    assert.ok(boss.brain.t < t0, `t must tick when leave-field t=${boss.brain.t}`);
  });

  it("off-arena walk-home does not steal recover", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    const cz = CITADEL_POI.z + 7.2;
    boss.x = CITADEL_POI.x - 14;
    boss.z = cz;
    boss.y = s.heightFn(boss.x, cz);
    boss.alive = true;
    boss.brain.phase = "recover";
    boss.brain.t = 0.75;
    placePlayer(s, CITADEL_POI.x + 4, cz);
    for (let i = 0; i < 15; i++) s.step(1 / 60, hold({}));
    assert.equal(
      boss.brain.phase,
      "recover",
      `off-arena stole recover phase=${boss.brain.phase} x=${boss.x.toFixed(2)}`,
    );
  });
});

describe("P0-2 bossDead save reload", () => {
  it("applySave with bossDead does not respawn a live boss", () => {
    const store = memoryStorage();
    const s = new Sim(store);
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    // Legitimate kill path.
    boss.hp = 0;
    s.damageEnemy(boss, 0.1, 0, 0);
    assert.equal(s.bossDead, true);
    assert.equal(s.mode, "ending");
    s.save();
    const raw = store.getItem("aetherwake-save-v2");
    assert.ok(raw, "save v2 missing");
    // Simulate refresh: new Sim, continue from same storage.
    const s2 = new Sim(store);
    s2.continueSave();
    assert.equal(s2.bossDead, true, "bossDead must restore");
    const boss2 = s2.enemies.find((e) => e.kind === "boss");
    assert.ok(boss2, "boss entity may exist");
    assert.equal(boss2.alive, false, `boss must stay dead alive=${boss2.alive} hp=${boss2.hp}`);
    assert.equal(boss2.brain.phase, "dead");
    assert.equal(boss2.brain.rewarded, true, "reward must not re-grant");
  });

  it("reload after ending keeps bossDead and does not re-open a fight", () => {
    const store = memoryStorage();
    const s = new Sim(store);
    s.freshRuntime(false);
    openSeal(s);
    const boss = bossOf(s);
    placePlayer(s, boss.x, boss.z + 2.2);
    s.player.yaw = Math.atan2(s.player.x - boss.x, s.player.z - boss.z);
    s.cam.yaw = s.player.yaw;
    // Ordinary swings until dead (existing unit path).
    for (let i = 0; i < 2000 && boss.alive; i++) {
      s.player.yaw = Math.atan2(s.player.x - boss.x, s.player.z - boss.z);
      s.cam.yaw = s.player.yaw;
      const dist = Math.hypot(s.player.x - boss.x, s.player.z - boss.z);
      const dodge = boss.brain.phase === "windup" || boss.brain.phase === "strike";
      const attack = s.attack.phase === "idle" && dist <= 2.7 && !dodge;
      s.step(1 / 60, hold({ moveY: dist > 2.55 ? 1 : dist < 1.65 ? -1 : 0, attack, dodge }));
      if (s.mode === "dead") {
        s.respawn();
        placePlayer(s, boss.x, boss.z + 2.2);
      }
    }
    assert.equal(s.bossDead, true);
    s.save();
    const s2 = new Sim(store);
    s2.continueSave();
    assert.equal(s2.bossDead, true);
    assert.notEqual(s2.mode, "ending", "continue should leave ending into play/post-game");
    const boss2 = s2.enemies.find((e) => e.kind === "boss");
    assert.equal(boss2?.alive, false);
  });
});
