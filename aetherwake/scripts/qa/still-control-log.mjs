/**
 * Short still-shrine control log: intended freeze vs no-ability rim.
 * Run: node --experimental-strip-types scripts/qa/still-control-log.mjs
 * Uses Sim only — no browser, no window.__sim, no HP/damage writes.
 */
import { memoryStorage } from "../../src/game/persistence.ts";
import { Sim } from "../../src/game/sim.ts";
import { SHRINES, shrineWorldOrigin } from "../../src/game/world.ts";

function hold(partial = {}) {
  return {
    moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
    attack: false, bow: false, interact: false, art: false, pause: false,
    map: false, bag: false, dodge: false, climb: false, artSlot: -1,
    lookX: 0, lookY: 0, ...partial,
  };
}

function fresh() {
  const sim = new Sim(memoryStorage());
  sim.freshRuntime(false);
  return sim;
}

function enterStill(s) {
  const sh = SHRINES.find((t) => t.id === "still");
  s.player.x = sh.x;
  s.player.z = sh.z;
  s.player.y = sh.y + 0.2;
  s.step(1 / 60, hold({ interact: true }));
  for (let i = 0; i < 70; i++) s.step(1 / 60, hold({}));
  return shrineWorldOrigin(s.shrine);
}

function snap(s, o, tag) {
  return {
    tag,
    art: s.art,
    frozen: +s.moveBlock.frozen.toFixed(2),
    blockX: +s.moveBlock.x.toFixed(2),
    orbs: s.orbs,
    shrines: [...s.shrinesOn],
    y: +s.player.y.toFixed(2),
    x: +s.player.x.toFixed(2),
    z: +s.player.z.toFixed(2),
    lz: +(s.player.z - o.z).toFixed(2),
    dAltar: +Math.hypot(s.player.x - o.x, s.player.z - (o.z + 23)).toFixed(2),
    hasSidewalk: s.solids.some((q) => q.id.startsWith("shrine-sidewalk")),
    prompt: s.prompt,
    toast: s.toast,
  };
}

// A) no-ability rim (+X then +Z)
const a = fresh();
const oa = enterStill(a);
a.cam.yaw = -Math.PI / 2;
a.player.yaw = -Math.PI / 2;
for (let i = 0; i < 240; i++) {
  a.step(1 / 60, hold({ moveY: 1 }));
  if (a.player.x > oa.x + 7) break;
}
a.cam.yaw = Math.PI;
a.player.yaw = Math.PI;
for (let i = 0; i < 420; i++) {
  a.step(1 / 60, hold({ moveY: 1 }));
  if (a.player.y < oa.y - 1 || a.player.z > oa.z + 22) break;
}
a.step(1 / 60, hold({ interact: true }));
console.log(JSON.stringify(snap(a, oa, "no-ability-rim"), null, 2));

// B) intended freeze-bridge
const b = fresh();
const ob = enterStill(b);
b.cam.yaw = Math.PI;
b.player.yaw = Math.PI;
for (let i = 0; i < 240; i++) {
  b.step(1 / 60, hold({ moveY: 1 }));
  if (b.player.z > ob.z + 9.2) break;
}
for (let i = 0; i < 480 && Math.abs(b.moveBlock.x - ob.x) >= 1.4; i++) b.step(1 / 60, hold({}));
const alignedX = b.moveBlock.x;
b.step(1 / 60, hold({ artSlot: 4 }));
b.step(1 / 60, hold({ art: true }));
const afterF = snap(b, ob, "after-freeze");
afterF.alignedBeforeF = +alignedX.toFixed(2);
let reached = false;
for (let i = 0; i < 480; i++) {
  b.cam.yaw = Math.PI;
  b.player.yaw = Math.PI;
  b.step(1 / 60, hold({ moveY: 1 }));
  if (Math.hypot(b.player.x - ob.x, b.player.z - (ob.z + 23)) < 2.05) {
    reached = true;
    break;
  }
  if (b.player.y < ob.y - 1.2) break;
}
b.step(1 / 60, hold({ interact: true }));
console.log(JSON.stringify({ afterF, reached, end: snap(b, ob, "intended-end") }, null, 2));
