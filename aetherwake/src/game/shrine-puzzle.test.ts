/**
 * Still-shrine intended freeze-bridge vs no-ability control.
 *
 * Starting state: fresh Sim, 叩响 凝时祠, spawn at origin z+4.4.
 * Normal input: Actions WASD analog (moveY), artSlot/art (Digit5+F), interact (E).
 * No window.__sim writes, no HP/damage cheats, no teleport to the altar.
 *
 * Finding (pre-fix): extraSupport r=1.5 at y+0.9 did not span the pit, FOOT_SNAP
 * 0.62 could not mount it, jump from the lip landed on the pit floor. Freeze
 * toast fired, but the player never stood on the block. A continuous ±7.15
 * walkway then claimed without 凝时. Production fix: floor-height slab for the
 * intended bridge, plus a full-width still pit (no walkway bypass). Climbable
 * pit walls remain a skill alternate.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import { SHRINES, STILL_BLOCK, shrineWorldOrigin } from "./world.ts";

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

function faceToward(s: Sim, x: number, z: number) {
  s.player.yaw = Math.atan2(s.player.x - x, s.player.z - z);
  s.cam.yaw = s.player.yaw;
}

function fresh() {
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  return sim;
}

function waitLock(s: Sim, frames = 70) {
  for (let i = 0; i < frames; i++) s.step(1 / 60, hold({}));
}

function enter(s: Sim, id: string) {
  const sh = SHRINES.find((t) => t.id === id);
  assert.ok(sh);
  s.player.x = sh.x;
  s.player.z = sh.z;
  s.player.y = sh.y + 0.2;
  s.step(1 / 60, hold({ interact: true }));
  waitLock(s);
  assert.ok(s.shrine !== null, `叩响 did not enter ${id} prompt=${s.prompt}`);
  return shrineWorldOrigin(s.shrine);
}

function dAltar(s: Sim, o: { x: number; z: number }) {
  return Math.hypot(s.player.x - o.x, s.player.z - (o.z + 23));
}

function onSlab(s: Sim, o: { y: number }) {
  const slab = s.solids.find((q) => q.id === "move-block");
  if (!slab) return false;
  const hw = (slab.w ?? 0) * 0.5;
  const hd = (slab.d ?? 0) * 0.5;
  return (
    Math.abs(s.player.x - slab.x) <= hw + 0.02 &&
    Math.abs(s.player.z - slab.z) <= hd + 0.02 &&
    s.player.y > o.y - 0.25
  );
}

function walkSidewalk(s: Sim, o: { x: number; y: number; z: number }) {
  s.cam.yaw = -Math.PI / 2;
  s.player.yaw = -Math.PI / 2;
  for (let i = 0; i < 240; i++) {
    s.step(1 / 60, hold({ moveY: 1 }));
    if (s.player.x > o.x + 7.0) break;
  }
  s.cam.yaw = Math.PI;
  s.player.yaw = Math.PI;
  for (let i = 0; i < 420; i++) {
    s.step(1 / 60, hold({ moveY: 1 }));
    if (s.player.z > o.z + 21.6) break;
  }
  const altar = { x: o.x, z: o.z + 23 };
  let minD = Infinity;
  let fell = false;
  for (let i = 0; i < 360; i++) {
    faceToward(s, altar.x, altar.z);
    s.step(1 / 60, hold({ moveY: 1 }));
    const d = Math.hypot(s.player.x - altar.x, s.player.z - altar.z);
    if (d < minD) minD = d;
    if (s.player.y < o.y - 1) {
      fell = true;
      break;
    }
    if (d < 2.05) break;
  }
  return { minD, fell, art: s.art, frozen: s.moveBlock.frozen, orbs: s.orbs };
}

function puzzleLog(s: Sim, o: { x: number; y: number; z: number }, tag: string) {
  return {
    tag,
    art: s.art,
    frozen: +s.moveBlock.frozen.toFixed(2),
    toast: s.toast,
    prompt: s.prompt,
    orbs: s.orbs,
    shrines: [...s.shrinesOn],
    cracked: s.shrine != null ? Boolean(s.crackedBroken[s.shrine]) : false,
    ices: s.ices.length,
    y: +s.player.y.toFixed(2),
    lz: +(s.player.z - o.z).toFixed(2),
    dAltar: +dAltar(s, o).toFixed(2),
    onSlab: onSlab(s, o),
  };
}

describe("shrine puzzle evidence: no-ability control vs intended still bridge", () => {
  it("still no-ability CENTER +Z falls into the pit and does not claim", () => {
    const s = fresh();
    const o = enter(s, "still");
    assert.equal(s.art, 0);
    assert.equal(s.moveBlock.frozen, 0);
    s.cam.yaw = Math.PI;
    s.player.yaw = Math.PI;
    for (let i = 0; i < 480; i++) s.step(1 / 60, hold({ moveY: 1 }));
    const log = puzzleLog(s, o, "no-ability-center");
    s.step(1 / 60, hold({ interact: true }));
    assert.ok(s.player.y < o.y - 3, `expected pit fall y=${s.player.y}`);
    assert.ok(dAltar(s, o) > 2.2, `pit is not the altar d=${dAltar(s, o).toFixed(2)}`);
    assert.equal(s.orbs, 0);
    assert.equal(s.shrinesOn.has("still"), false);
    assert.equal(s.art, 0);
    assert.equal(s.moveBlock.frozen, 0);
    assert.equal(log.ices, 0);
  });

  it("still no-ability SIDEWALK/rim cannot claim (full-width pit, no walkway)", () => {
    const s = fresh();
    const o = enter(s, "still");
    assert.equal(
      s.solids.some((q) => q.id.startsWith("shrine-sidewalk")),
      false,
      "still must not keep the continuous ±7.15 walkway",
    );
    const walked = walkSidewalk(s, o);
    // Either fell into the full-width pit or never reached the altar cylinder.
    assert.ok(
      walked.fell || walked.minD > 2.2 || s.player.z < o.z + 16,
      `still rim reached altar without 凝时 minD=${walked.minD.toFixed(2)} z=${s.player.z.toFixed(1)} y=${s.player.y.toFixed(2)}`,
    );
    assert.equal(s.art, 0);
    assert.equal(s.moveBlock.frozen, 0);
    s.step(1 / 60, hold({ interact: true }));
    assert.equal(s.shrinesOn.has("still"), false, `sidewalk claimed prompt=${s.prompt}`);
    assert.equal(s.orbs, 0);
    const log = puzzleLog(s, o, "no-ability-sidewalk");
    assert.equal(log.frozen, 0);
  });

  it("still intended: freeze when aligned, walk the center slab, claim; log physical freeze", () => {
    const s = fresh();
    const o = enter(s, "still");
    const slab = s.solids.find((q) => q.id === "move-block");
    assert.ok(slab, "move-block solid missing after enter");
    assert.equal(slab!.standable, true);
    assert.ok((slab!.d ?? 0) >= 6.5, `slab must span the pit d=${slab!.d}`);
    assert.ok(slab!.h < 1, "slab is a floor, not a wall");
    assert.ok(Math.abs(slab!.h - STILL_BLOCK.h) < 1e-9);

    s.cam.yaw = Math.PI;
    s.player.yaw = Math.PI;
    for (let i = 0; i < 240; i++) {
      s.step(1 / 60, hold({ moveY: 1 }));
      if (s.player.z > o.z + 9.2) break;
    }
    assert.ok(s.player.y > o.y - 0.6, `fell before pit lip y=${s.player.y} z=${s.player.z}`);
    assert.ok(s.player.z > o.z + 8.6, `did not reach lip z=${s.player.z}`);

    let aligned = false;
    for (let i = 0; i < 480; i++) {
      if (Math.abs(s.moveBlock.x - o.x) < 1.4) {
        aligned = true;
        break;
      }
      s.step(1 / 60, hold({}));
    }
    assert.equal(aligned, true, `block never aligned x=${s.moveBlock.x} origin=${o.x}`);

    const frozenBefore = s.moveBlock.frozen;
    s.step(1 / 60, hold({ artSlot: 4 }));
    s.step(1 / 60, hold({ art: true }));
    const afterF = puzzleLog(s, o, "after-F");
    assert.equal(s.art, 4);
    assert.ok(s.moveBlock.frozen > frozenBefore + 1, `F had no freeze ${frozenBefore}->${s.moveBlock.frozen}`);
    assert.match(s.toast, /凝固/);

    const altar = { x: o.x, z: o.z + 23 };
    let stood = false;
    let fell = false;
    let minD = Infinity;
    for (let i = 0; i < 480; i++) {
      faceToward(s, altar.x, altar.z);
      s.step(1 / 60, hold({ moveY: 1 }));
      if (onSlab(s, o)) stood = true;
      const d = Math.hypot(s.player.x - altar.x, s.player.z - altar.z);
      if (d < minD) minD = d;
      if (s.player.y < o.y - 1.2) {
        fell = true;
        break;
      }
      if (d < 2.05) break;
    }
    const bridge = puzzleLog(s, o, "bridge-end");
    assert.equal(fell, false, `intended bridge fell ${JSON.stringify(bridge)}`);
    assert.equal(stood, true, `never stood on freeze slab ${JSON.stringify(bridge)}`);
    assert.ok(minD < 2.2, `intended never reached altar minD=${minD.toFixed(2)} ${JSON.stringify(bridge)}`);
    s.step(1 / 60, hold({ interact: true }));
    assert.ok(s.shrinesOn.has("still"), `intended did not claim prompt=${s.prompt} ${JSON.stringify(afterF)}`);
    assert.equal(s.orbs, 1);
    assert.ok(afterF.frozen > 1, "claim must follow an observed freeze, not F spam");
  });

  it("still freeze while the slab is off-lane does not let center +Z skip the pit", () => {
    const s = fresh();
    const o = enter(s, "still");
    s.cam.yaw = Math.PI;
    s.player.yaw = Math.PI;
    for (let i = 0; i < 200; i++) {
      s.step(1 / 60, hold({ moveY: 1 }));
      if (s.player.z > o.z + 9.2) break;
    }
    for (let i = 0; i < 480 && Math.abs(s.moveBlock.x - o.x) < 3.2; i++) s.step(1 / 60, hold({}));
    assert.ok(Math.abs(s.moveBlock.x - o.x) >= 3.2, `block stayed in lane x=${s.moveBlock.x}`);
    s.step(1 / 60, hold({ artSlot: 4 }));
    s.step(1 / 60, hold({ art: true }));
    assert.ok(s.moveBlock.frozen > 1, "off-lane freeze must still set frozen");
    for (let i = 0; i < 300; i++) s.step(1 / 60, hold({ moveY: 1 }));
    assert.ok(s.player.y < o.y - 3, `off-lane freeze still bridged the pit y=${s.player.y} bx=${s.moveBlock.x}`);
    assert.equal(s.shrinesOn.has("still"), false);
  });

  for (const id of ["rime", "pull"] as const) {
    it(`${id} no-ability sidewalk (same harness path) claims without arts`, () => {
      const s = fresh();
      const o = enter(s, id);
      const walked = walkSidewalk(s, o);
      assert.equal(s.art, 0);
      assert.equal(walked.fell, false, `${id} sidewalk fell y=${s.player.y}`);
      assert.ok(walked.minD < 2.2, `${id} sidewalk minD=${walked.minD.toFixed(2)}`);
      s.step(1 / 60, hold({ interact: true }));
      assert.ok(s.shrinesOn.has(id), `${id} sidewalk did not claim prompt=${s.prompt}`);
      assert.equal(s.orbs, 1);
      assert.equal(s.art, 0);
    });
  }

  it("burst no-ability sidewalk cannot claim; bomb is the physical gate", () => {
    const s = fresh();
    const o = enter(s, "burst");
    const blocked = walkSidewalk(s, o);
    assert.equal(s.crackedBroken[s.shrine!], false);
    assert.ok(
      blocked.minD > 2.2 || blocked.fell || s.player.z < o.z + 16,
      `burst sidewalk walked through the wall minD=${blocked.minD.toFixed(2)} z=${s.player.z}`,
    );
    assert.equal(s.shrinesOn.has("burst"), false);
    assert.equal(s.orbs, 0);
    const log = puzzleLog(s, o, "burst-no-ability");
    assert.equal(log.cracked, false);
  });
});
