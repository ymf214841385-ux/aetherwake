#!/usr/bin/env node
/** Why headed spawn→burst-door is unavailable while unit detour says walk. */
import { initWorld, SHRINES, TOWERS, SAGE, CITADEL_POI } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { buildOverworldGraph } from "../../src/game/navigation.ts";
import { buildOverworldDetourRoute, validateWalkSegment } from "../../src/game/shrine-route.ts";
import { solidTop } from "../../src/game/physics.ts";

initWorld();
const sim = new Sim();
sim.mode = "playing";
const s = SHRINES.find((x) => x.id === "burst");
const apronTop = solidTop(sim.solids.find((q) => q.id === "burst-apron"));

function tryFrom(px, py, pz, label) {
  const graph = buildOverworldGraph({
    spawn: sim.spawn,
    towers: TOWERS,
    shrines: SHRINES,
    sage: SAGE,
    citadel: CITADEL_POI,
    towersOn: sim.towersOn,
    heightFn: sim.heightFn,
  });
  const waypoints = graph.nodes
    .filter((n) => n.kind !== "tower-top" && n.kind !== "citadel")
    .map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z }));
  const snap = buildOverworldDetourRoute({
    player: { x: px, y: py, z: pz },
    dest: { x: s.x, y: apronTop, z: s.z + 2.8, targetId: `shrine-door:burst`, label: s.name },
    waypoints,
    solids: sim.solids,
    heightFn: sim.heightFn,
    extraSupports: sim.extraSupports(),
    nextAction: "前往爆鸣祠",
    guidanceOk: "沿地面前往祠门前",
    guidanceBlocked: "尚未找到可通行路线，可绕开障碍再试",
  });
  console.log(label, {
    from: [px, py, pz],
    status: snap.status,
    reason: snap.reason,
    segs: snap.segments.length,
    first: snap.segments[0]?.id,
    walks: snap.segments.filter((x) => x.validated).length,
  });
  return snap;
}

console.log("spawn", sim.spawn);
tryFrom(sim.spawn.x, sim.spawn.y, sim.spawn.z, "spawn");
tryFrom(34.41, 15.12, 83.18, "headed-near-b1");
tryFrom(16, sim.heightFn(16, 102), 102, "spawn-xz");

// Validate each corridor hop from actual feet
const graph = buildOverworldGraph({
  spawn: sim.spawn, towers: TOWERS, shrines: SHRINES, sage: SAGE, citadel: CITADEL_POI,
  towersOn: sim.towersOn, heightFn: sim.heightFn,
});
const chain = ["spawn", "corr-b1", "corr-b2", "corr-b3", "corr-b4", "corr-b5", "corr-b6", "corr-b7", "corr-b8", "corr-b9", "corr-b10", "shrine-door:burst"];
let feet = sim.spawn.y;
for (let i = 0; i < chain.length - 1; i++) {
  const a = graph.nodes.find((n) => n.id === chain[i]);
  const b = graph.nodes.find((n) => n.id === chain[i + 1]);
  if (!a || !b) { console.log("missing node", chain[i], chain[i+1]); break; }
  const from = { x: a.x, y: feet, z: a.z };
  const seg = validateWalkSegment(from, { x: b.x, y: b.y, z: b.z }, {
    solids: sim.solids, heightFn: sim.heightFn, extraSupports: sim.extraSupports(),
    worldId: "overworld", id: `${chain[i]}->${chain[i + 1]}`,
  });
  console.log(chain[i], "->", chain[i + 1], seg.validated, seg.blockedReason, "endY", seg.to.y, "nodeY", b.y);
  if (!seg.validated) break;
  feet = seg.to.y;
}
