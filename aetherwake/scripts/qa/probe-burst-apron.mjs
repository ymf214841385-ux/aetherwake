#!/usr/bin/env node
/**
 * R22: dump real overworld solids/heights around burst apron + corridor edges.
 * Ordinary read-only probe. No state writes beyond initWorld().
 */
import { initWorld, SHRINES, landmarkSolids } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { validateWalkSegment } from "../../src/game/shrine-route.ts";
import { supportY, solidTop, queryWall } from "../../src/game/physics.ts";
import { FOOT_SNAP, STEP_UP, PLAYER_RADIUS } from "../../src/game/params.ts";
import { buildOverworldGraph } from "../../src/game/navigation.ts";
import { TOWERS, SAGE, CITADEL_POI } from "../../src/game/world.ts";
import { heightAt } from "../../src/game/height.ts";

initWorld();
const sim = new Sim();
sim.mode = "playing";
const s = SHRINES.find((x) => x.id === "burst");
console.log("burst poi", { x: s.x, y: s.y, z: s.z });
console.log("heightAt center", heightAt(s.x, s.z));
console.log("heightAt door", heightAt(s.x, s.z + 2.8));
console.log("heightAt door-side +X", heightAt(s.x + 3, s.z + 2.8));
console.log("heightAt door-side +X2", heightAt(s.x + 4.5, s.z));
console.log("heightAt door-side -X", heightAt(s.x - 4.5, s.z));
console.log("heightAt door-side +Z far", heightAt(s.x, s.z + 5));
console.log("heightAt south", heightAt(s.x, s.z - 4));
console.log("heightAt corr-b10", heightAt(118, 31));

const apron = sim.solids.find((q) => q.id === "burst-apron");
const body = sim.solids.find((q) => q.id === "burst-body");
console.log("apron solid", apron, "top", apron && solidTop(apron));
console.log("body solid", body);

// Ring sample around apron
const samples = [];
for (const ang of [0, 45, 90, 135, 180, 225, 270, 315]) {
  const rad = (ang * Math.PI) / 180;
  for (const r of [4.8, 5.2, 5.6, 6.0, 7.0]) {
    const x = s.x + Math.cos(rad) * r;
    const z = s.z + Math.sin(rad) * r;
    const terrain = sim.heightFn(x, z);
    const feet = Math.max(0, terrain);
    const sup = supportY(x, z, feet + FOOT_SNAP, sim.solids, sim.heightFn, sim.extraSupports(), null);
    samples.push({
      ang,
      r,
      x: +x.toFixed(2),
      z: +z.toFixed(2),
      terrain: +terrain.toFixed(3),
      support: +sup.y.toFixed(3),
      supportId: sup.id,
      riseFromTerrain: +(sup.y - terrain).toFixed(3),
    });
  }
}
console.log("ring samples", JSON.stringify(samples, null, 2));

// Door-side connectors: walk from higher terrain onto door
const door = { x: s.x, y: sim.heightFn(s.x, s.z + 2.8) + 0.28, z: s.z + 2.8 };
const approaches = [
  { id: "south-corr", from: { x: 118, y: sim.heightFn(118, 31), z: 31 } },
  { id: "door-front", from: { x: s.x, y: sim.heightFn(s.x, s.z + 5.5), z: s.z + 5.5 } },
  { id: "door-east", from: { x: s.x + 6, y: sim.heightFn(s.x + 6, s.z + 2.8), z: s.z + 2.8 } },
  { id: "door-west", from: { x: s.x - 6, y: sim.heightFn(s.x - 6, s.z + 2.8), z: s.z + 2.8 } },
  { id: "door-northeast", from: { x: s.x + 5, y: sim.heightFn(s.x + 5, s.z - 2), z: s.z - 2 } },
  { id: "door-northwest", from: { x: s.x - 5, y: sim.heightFn(s.x - 5, s.z - 2), z: s.z - 2 } },
  { id: "door-southeast", from: { x: s.x + 5, y: sim.heightFn(s.x + 5, s.z + 5), z: s.z + 5 } },
  { id: "door-southwest", from: { x: s.x - 5, y: sim.heightFn(s.x - 5, s.z + 5), z: s.z + 5 } },
];

function firstRejectDetail(from, to) {
  let feet = from.y;
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(2, Math.ceil(dist / (PLAYER_RADIUS * 1.1)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const hit = queryWall(x, z, feet + 0.55, sim.solids, PLAYER_RADIUS);
    if (hit && !(hit.id?.includes("apron") === false)) {
      // keep going; validateWalkSegment skips low standable
    }
    const sup = supportY(x, z, feet + FOOT_SNAP, sim.solids, sim.heightFn, sim.extraSupports(), null);
    const rise = sup.y - feet;
    if (rise > STEP_UP + 0.08) {
      return { i, x: +x.toFixed(2), z: +z.toFixed(2), prevFeet: +feet.toFixed(3), supportY: +sup.y.toFixed(3), supportId: sup.id, rise: +rise.toFixed(3), wall: hit?.id ?? null };
    }
    feet = sup.y;
  }
  return null;
}

for (const a of approaches) {
  const seg = validateWalkSegment(a.from, door, {
    solids: sim.solids,
    heightFn: sim.heightFn,
    extraSupports: sim.extraSupports(),
    worldId: "overworld",
    id: a.id,
  });
  const rej = firstRejectDetail(a.from, door);
  console.log("approach", a.id, {
    from: a.from,
    door,
    validated: seg.validated,
    blocked: seg.blockedReason,
    firstReject: rej,
    endY: seg.to?.y,
  });
}

// Corridor edges via buildOverworldGraph
const graph = buildOverworldGraph({
  spawn: sim.spawn,
  towers: TOWERS,
  shrines: SHRINES,
  sage: SAGE,
  citadel: CITADEL_POI,
  towersOn: sim.towersOn,
  heightFn: sim.heightFn,
});
const burstEdges = graph.edges.filter((e) => e.kind === "walk" && (e.from.includes("burst") || e.to.includes("burst") || e.from.startsWith("corr") || e.to.startsWith("corr") || e.from === "spawn" || e.to === "spawn"));
const seen = new Set();
for (const e of burstEdges) {
  if (e.from > e.to) continue;
  const k = `${e.from}->${e.to}`;
  if (seen.has(k)) continue;
  seen.add(k);
  const na = graph.nodes.find((n) => n.id === e.from);
  const nb = graph.nodes.find((n) => n.id === e.to);
  if (!na || !nb) continue;
  if (Math.hypot(na.x - nb.x, na.z - nb.z) > 80) continue;
  const fromP = { x: na.x, y: sim.heightFn(na.x, na.z), z: na.z };
  const toP = { x: nb.x, y: nb.y, z: nb.z };
  const seg = validateWalkSegment(fromP, toP, {
    solids: sim.solids,
    heightFn: sim.heightFn,
    extraSupports: sim.extraSupports(),
    worldId: "overworld",
    id: k,
  });
  if (!seg.validated) {
    console.log("EDGE FAIL", k, { from: fromP, to: toP, reason: seg.blockedReason, firstReject: firstRejectDetail(fromP, toP) });
  } else {
    console.log("EDGE OK", k, "endY", seg.to.y.toFixed(3));
  }
}

// Actual support at door point
const doorTerrain = sim.heightFn(door.x, door.z);
const doorSup = supportY(door.x, door.z, doorTerrain + FOOT_SNAP, sim.solids, sim.heightFn, sim.extraSupports(), null);
console.log("door support", { doorTerrain, doorSup, hfPlus028: doorTerrain + 0.28, apronTop: apron && solidTop(apron) });
