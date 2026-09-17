#!/usr/bin/env node
/** Confirm corridor + door pass when MAX_RISE matches production snap (2*FOOT_SNAP). */
import { initWorld, SHRINES } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { queryWall, supportY } from "../../src/game/physics.ts";
import { FOOT_SNAP, PLAYER_RADIUS, STEP_UP } from "../../src/game/params.ts";

initWorld();
const sim = new Sim();

// Production-aligned sample of a walk (mirrors snapVertical + horizontal step)
function prodWalk(from, to, maxRise) {
  let feet = from.y;
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(2, Math.ceil(dist / (PLAYER_RADIUS * 1.1)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const wall = queryWall(x, z, feet + 0.55, sim.solids, PLAYER_RADIUS);
    if (wall) return { ok: false, why: `wall ${wall.id}`, x, z, feet };
    const sup = supportY(x, z, feet + FOOT_SNAP, sim.solids, sim.heightFn, sim.extraSupports(), null);
    const rise = sup.y - feet;
    if (rise > maxRise) return { ok: false, why: `rise ${rise.toFixed(3)}`, x, z, feet, sup: sup.y, id: sup.id, rise };
    if (sup.y < feet - (FOOT_SNAP + STEP_UP)) return { ok: false, why: `drop`, x, z, feet, sup: sup.y };
    feet = sup.y;
  }
  return { ok: true, endY: feet };
}

const oldMax = STEP_UP + 0.08;
const prodMax = FOOT_SNAP * 2;
console.log("oldMax", oldMax, "prodMax", prodMax);

const chains = [
  ["b8-b9", { x: 118, y: sim.heightFn(118, 34), z: 34 }, { x: 118, y: sim.heightFn(118, 33), z: 33 }],
  ["b10-door", { x: 118, y: sim.heightFn(118, 31), z: 31 }, { x: 118, y: 10.36, z: 30.8 }],
  ["south-corr", { x: 118, y: sim.heightFn(118, 31), z: 31 }, { x: 118, y: 10.36, z: 30.8 }],
  ["west-112-114", { x: 112, y: sim.heightFn(112, 30), z: 30 }, { x: 114, y: sim.heightFn(114, 29.6), z: 29.6 }],
  ["west-114-door", { x: 114, y: 10.36, z: 29.6 }, { x: 118, y: 10.36, z: 30.8 }],
  ["front-far", { x: 118, y: sim.heightFn(118, 33.5), z: 33.5 }, { x: 118, y: 10.36, z: 30.8 }],
];
for (const [name, a, b] of chains) {
  console.log(name, "old", prodWalk(a, b, oldMax), "prod", prodWalk(a, b, prodMax));
}
