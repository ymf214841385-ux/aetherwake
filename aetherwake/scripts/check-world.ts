#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { climateAt, computeHeight, MOUNTAIN, PLATEAU, SPAWN } from "../src/game/height.ts";
import { CAMPS, SHRINES, TOWERS, TOWER_HEIGHT, WISPS, initWorld } from "../src/game/world.ts";

initWorld();

const step = 2;
const samples: { x: number; z: number; h: number }[] = [];
let maxH = -1e9;
let maxP = [0, 0];
let snow = 0;
let frost = 0;
for (let x = -192; x <= 192; x += step) {
  for (let z = -192; z <= 192; z += step) {
    const h = computeHeight(x, z);
    if (h > maxH) {
      maxH = h;
      maxP = [x, z];
    }
    if (h > 46) snow += 1;
    if (climateAt(x, z, h) === "frost") frost += 1;
    if ((x % 16 === 0 && z % 16 === 0) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 4) {
      samples.push({ x, z, h });
    }
  }
}

const towers = TOWERS.map((t) => ({
  id: t.id,
  x: t.x,
  z: t.z,
  ground: t.y,
  top: t.y + TOWER_HEIGHT,
  climbNoRest: 100 / 15 * 3.4,
}));

const report = {
  method: "computeHeight sampled on a 2-unit grid; collision uses the same function plus authored solids",
  sampleStep: step,
  maxHeight: maxH,
  maxPosition: maxP,
  spawn: { ...SPAWN, h: computeHeight(SPAWN.x, SPAWN.z) },
  plateau: { ...PLATEAU, h: computeHeight(PLATEAU.x, PLATEAU.z) },
  mountain: { ...MOUNTAIN, h: computeHeight(MOUNTAIN.x, MOUNTAIN.z) },
  pointsAboveLegacySnow46: snow,
  frostClimateCells: frost,
  towers,
  shrines: SHRINES.map((s) => ({ id: s.id, x: s.x, z: s.z, y: s.y })),
  camps: CAMPS.map((c) => ({ id: c.id, x: c.x, z: c.z, y: c.y })),
  wisps: WISPS.map((w) => ({ id: w.id, x: w.x, z: w.z, y: w.y })),
  initialClimbNoRest: 100 / 15 * 3.4,
  seedClimbNoRest: 164 / 15 * 3.4,
};

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, "../../docs/rebuild-evidence/world-sample.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, out, maxHeight: maxH, spawn: report.spawn.h, mountain: report.mountain.h }, null, 2));
