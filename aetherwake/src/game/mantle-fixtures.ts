import assert from "node:assert/strict";
import { fittedTopPoint, playerBodyClear, supportY } from "./physics.ts";
import type { BodyPosition } from "./physics.ts";
import type { Sim } from "./sim.ts";
import type { TOWERS } from "./world.ts";

type Tower = (typeof TOWERS)[number];

export function assertLegacyTowerStartBlocked(sim: Sim, old: BodyPosition) {
  assert.equal(playerBodyClear(old, sim.solids, sim.heightFn), false,
    `legacy fixture body overlaps original terrain/solids at ${JSON.stringify(old)}`);
}

function placeOnSupport(sim: Sim, p: BodyPosition) {
  assert.ok(playerBodyClear(p, sim.solids, sim.heightFn), "initial whole body must be clear");
  const support = supportY(p.x, p.z, p.y, sim.solids, sim.heightFn, []);
  assert.ok(Math.abs(support.y - p.y) < 1e-8, "initial feet must have real support");
  // Only the initial position changes; original input, resource and time
  // contracts remain in each calling test.
  sim.player.x = p.x;
  sim.player.y = p.y;
  sim.player.z = p.z;
}

export function placeClearTowerGround(sim: Sim, tower: Tower) {
  // Actual ground gaps between the authored low ledges. These are the same
  // clear entries exercised by the normal-input whole-route mantle tests.
  const angle = tower.id === "dawn" ? 11 * Math.PI / 32 : tower.id === "mere" ? Math.PI / 32 : 0;
  const x = tower.x + Math.cos(angle) * 4.6;
  const z = tower.z + Math.sin(angle) * 4.6;
  placeOnSupport(sim, { x, z, y: sim.heightFn(x, z) });
}

export function placeClearLowLedge(sim: Sim, tower: Tower, index: number) {
  const ledge = sim.solids.find(s => s.id === `${tower.id}-ledge-${index}`)!;
  assert.ok(ledge && index < 4, "initial ledge must be in the original low row");
  const angle = index * Math.PI / 2;
  const point = fittedTopPoint(ledge, { x: tower.x + Math.cos(angle) * 4.7,
    z: tower.z + Math.sin(angle) * 4.7, y: ledge.y + ledge.h });
  assert.ok(point);
  placeOnSupport(sim, point);
}
