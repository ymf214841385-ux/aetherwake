/**
 * Review13: player stuck at (7,-16) inside keep — goTo(boss) never reaches.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "../../src/game/persistence.ts";
import { Sim } from "../../src/game/sim.ts";
import { CITADEL_POI, TOWERS } from "../../src/game/world.ts";

function hold(partial = {}) {
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

function openSeal() {
  const s = new Sim(memoryStorage());
  s.freshRuntime(false);
  for (const t of TOWERS) s.towersOn.add(t.id);
  for (const id of ["rime", "burst", "pull", "still"]) s.shrinesOn.add(id);
  s.orbs = 4;
  s.rebuildSolids();
  return s;
}

describe("citadel keep interior approach (36458 pose)", () => {
  it("keep interior (7,-16) bee-line must NOT reach melee (36458)", () => {
    const s = openSeal();
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss, "boss must exist");
    assert.ok(s.sealIsOpen());
    s.player.x = 7.0;
    s.player.z = -16.5;
    s.player.y = 10.8;
    s.player.stamina = 80;
    s.setMove("grounded");
    for (let i = 0; i < 20; i++) s.step(1 / 60, hold({}));

    const d0 = Math.hypot(boss.x - s.player.x, boss.z - s.player.z);
    const wantYaw = Math.atan2(-(boss.x - s.player.x), -(boss.z - s.player.z));
    s.player.yaw = wantYaw;
    s.cam.yaw = wantYaw;
    let minD = d0;
    for (let i = 0; i < 400; i++) {
      s.step(1 / 60, hold({ moveY: 1, sprint: true }));
      const d = Math.hypot(boss.x - s.player.x, boss.z - s.player.z);
      if (d < minD) minD = d;
      if (d < 2.2) break;
    }
    assert.ok(
      minD > 3.5,
      `bee-line from keep interior must fail (minD=${minD}) at ${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`,
    );
  });

  it("south door (6,0.8) reaches courtyard boss without keep interior", () => {
    const s = openSeal();
    const boss = s.enemies.find((e) => e.kind === "boss")!;
    s.player.x = 6;
    s.player.z = 8;
    s.player.y = 10.5;
    s.player.stamina = 80;
    s.setMove("grounded");
    for (let i = 0; i < 20; i++) s.step(1 / 60, hold({}));
    const wantYaw = Math.atan2(-(boss.x - s.player.x), -(boss.z - s.player.z));
    s.player.yaw = wantYaw;
    s.cam.yaw = wantYaw;
    let minD = Infinity;
    for (let i = 0; i < 900; i++) {
      s.step(1 / 60, hold({ moveY: 1, sprint: true }));
      const d = Math.hypot(boss.x - s.player.x, boss.z - s.player.z);
      if (d < minD) minD = d;
      if (d < 2.2) break;
    }
    assert.ok(minD < 3.5, `gate approach minD=${minD} at ${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`);
  });
});
