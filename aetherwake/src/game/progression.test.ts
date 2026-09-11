import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import { SHRINES, TOWERS } from "./world.ts";

function hold(partial: Record<string, unknown> = {}) {
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

describe("M8 content systems", () => {
  it("collecting a wisp once raises stamina and does not repeat", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const w = { x: 28, z: 110 };
    s.player.x = w.x;
    s.player.z = w.z;
    s.player.y = s.heightFn(w.x, w.z);
    const max = s.player.staminaMax;
    s.step(1 / 60, hold({ interact: true }));
    assert.equal(s.wispsGot.size, 1);
    assert.equal(s.player.staminaMax, max + 8);
    s.step(1 / 60, hold({ interact: true }));
    assert.equal(s.wispsGot.size, 1);
  });

  it("shrine enter/exit does not leak shrine metals into the field", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const field = s.metals.filter((m) => m.id.startsWith("metal-field")).length;
    s.enterShrine(2);
    assert.equal(s.worldKind, "shrine");
    assert.ok(s.metals.some((m) => m.id.startsWith("metal-shrine")));
    s.exitShrine();
    assert.equal(s.worldKind, "overworld");
    assert.equal(s.metals.some((m) => m.id.startsWith("metal-shrine")), false);
    assert.equal(s.metals.filter((m) => m.id.startsWith("metal-field")).length, field);
  });

  it("claiming four shrines and three towers opens the seal; boss is then damageable", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    const boss = s.enemies.find((e) => e.kind === "boss")!;
    s.damageEnemy(boss, 99, 0, 1);
    assert.equal(boss.alive, true);
    for (const t of TOWERS) s.towersOn.add(t.id);
    for (const sh of SHRINES) {
      s.shrinesOn.add(sh.id);
      s.orbs += 1;
    }
    assert.equal(s.sealIsOpen(), true);
    s.damageEnemy(boss, 99, 0, 1);
    assert.equal(boss.alive, false);
    assert.equal(s.bossDead, true);
    assert.equal(s.mode, "ending");
  });

  it("graybox reset returns to the marked point", () => {
    const s = new Sim(memoryStorage());
    s.freshRuntime(false);
    s.enterGraybox();
    s.player.x = 12;
    s.player.z = -10;
    s.step(1 / 60, hold({ interact: true }));
    assert.ok(Math.abs(s.player.x) < 0.2);
    assert.ok(Math.abs(s.player.z - 6) < 0.2);
  });
});
