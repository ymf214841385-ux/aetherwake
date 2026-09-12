/**
 * Production climb behaviors (Review10/11).
 * Preconditions must be asserted — never skip via assert.ok(true).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "../../src/game/persistence.ts";
import { Sim } from "../../src/game/sim.ts";
import { TOWERS, TOWER_HEIGHT } from "../../src/game/world.ts";
import { assertLegacyTowerStartBlocked, placeClearLowLedge } from "./mantle-fixtures.ts";

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

function freshSim() {
  const s = new Sim(memoryStorage());
  s.freshRuntime(false);
  return s;
}

/** Must enter climbing or throw. */
function engageClimbing(s: Sim, opts: { maxFrames?: number } = {}) {
  const maxFrames = opts.maxFrames ?? 90;
  s.player.stamina = 100;
  s.setMove("grounded");
  for (let i = 0; i < maxFrames; i++) {
    s.step(1 / 60, hold({ climb: true, moveY: 1 }));
    if (s.player.state === "climbing") return;
  }
  for (let i = 0; i < maxFrames; i++) {
    s.step(1 / 60, hold({ interact: true, moveY: 1 }));
    if (s.player.state === "climbing") return;
  }
  assert.fail(
    `precondition: never entered climbing (state=${s.player.state} x=${s.player.x.toFixed(2)} y=${s.player.y.toFixed(2)} z=${s.player.z.toFixed(2)} stam=${s.player.stamina.toFixed(0)})`,
  );
}

describe("climb detach via dodge (production)", () => {
  it("dodge while climbing leaves climbing (near ledge/mantle height)", () => {
    const s = freshSim();
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    // Low on shaft where tryMantle can succeed — old impl stayed climbing on dodge.
    s.player.x = tw.x + 4.25;
    s.player.z = tw.z;
    s.player.y = tw.y + 1.2;
    engageClimbing(s);
    assert.equal(s.player.state, "climbing");
    s.step(1 / 60, hold({ dodge: true }));
    for (let i = 0; i < 10; i++) s.step(1 / 60, hold({}));
    assert.notEqual(
      s.player.state,
      "climbing",
      `dodge must dismount even where mantle is possible (old impl stayed climbing) y=${s.player.y.toFixed(2)}`,
    );
  });

  it("tower mantle still works without dodge (summit path)", t => {
    const s = freshSim();
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    assertLegacyTowerStartBlocked(s, { x: tw.x + 4.25, z: tw.z, y: tw.y + 2.2 });
    placeClearLowLedge(s, tw, 0);
    engageClimbing(s);
    const y0 = s.player.y;
    let maxY = y0;
    // Climb up — no dodge
    for (let i = 0; i < 600; i++) {
      s.step(1 / 60, hold({ climb: true, moveY: 1 }));
      maxY = Math.max(maxY, s.player.y);
      if (s.player.state !== "climbing" && s.player.y > tw.y + 30) break;
      if (s.towersOn.has(tw.id)) break;
    }
    t.diagnostic(JSON.stringify({ initialY: y0, maxY, final: { x: s.player.x, y: s.player.y, z: s.player.z,
      state: s.player.state, stamina: s.player.stamina, hp: s.player.hp } }));
    assert.ok(
      s.player.y > y0 + 5,
      `climbing without dodge must gain height y0=${y0.toFixed(1)} y=${s.player.y.toFixed(1)} state=${s.player.state}`,
    );
  });
});

describe("tower activation (production)", () => {
  it("reachable top + interact lights the tower", () => {
    const s = freshSim();
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    // Cap pad: interact requires xz<5.2 and y > tw.y+TOWER_HEIGHT-2.2
    const capY = tw.y + TOWER_HEIGHT - 1.5;
    s.player.x = tw.x;
    s.player.z = tw.z + 2.0;
    s.player.y = capY;
    s.player.vy = 0;
    s.player.stamina = 50;
    s.setMove("grounded");
    for (let i = 0; i < 15; i++) s.step(1 / 60, hold({}));
    const xz = Math.hypot(s.player.x - tw.x, s.player.z - tw.z);
    assert.ok(
      s.player.y > tw.y + TOWER_HEIGHT - 2.2,
      `must be in cap interact band y=${s.player.y.toFixed(2)} need>${(tw.y + TOWER_HEIGHT - 2.2).toFixed(2)}`,
    );
    assert.ok(xz < 5.2, `must be inside cap pad xz=${xz.toFixed(2)}`);
    s.step(1 / 60, hold({ interact: true }));
    for (let i = 0; i < 10; i++) s.step(1 / 60, hold({}));
    assert.ok(
      s.towersOn.has(tw.id),
      `interact on cap must light tower prompt=${s.prompt} y=${s.player.y.toFixed(2)} xz=${xz.toFixed(2)}`,
    );
  });
});
