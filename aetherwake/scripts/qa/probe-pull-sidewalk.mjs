#!/usr/bin/env node
/** Pull sidewalk → altar contiguous walk check. */
import { initWorld, SHRINES, shrineWorldOrigin, SHRINE_ROOM } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { validateWalkSegment, assembleContiguousPath } from "../../src/game/shrine-route.ts";

initWorld();
const sim = new Sim();
sim.mode = "playing";
const idx = SHRINES.findIndex((s) => s.id === "pull");
sim.enterShrine(idx);
sim.interactLock = 0;
sim.mode = "playing";
const o = shrineWorldOrigin(idx);
const altar = { x: o.x, y: o.y, z: o.z + SHRINE_ROOM.altarZ - 2.5, label: "祭坛前" };

const poses = [
  { id: "sidewalk-mid", x: o.x + 7.15, z: o.z + 10, y: o.y },
  { id: "sidewalk-far", x: o.x + 7.15, z: o.z + 16, y: o.y },
  { id: "far-shore", x: o.x + 2, z: o.z + 18, y: o.y },
  { id: "far-shore-c", x: o.x, z: o.z + 18, y: o.y },
];

const validate = (a, b, id) =>
  validateWalkSegment(a, b, {
    solids: sim.solids,
    heightFn: sim.heightFn,
    extraSupports: sim.extraSupports(),
    worldId: "shrine:pull",
    id,
  });

for (const p of poses) {
  sim.player.x = p.x;
  sim.player.y = p.y;
  sim.player.z = p.z;
  const snap = sim.navigationSnapshot();
  const walks = snap.segments.filter((s) => s.validated && s.kind === "walk");
  console.log(p.id, {
    status: snap.status,
    guidance: snap.guidance,
    next: snap.nextAction,
    walks: walks.length,
    segs: snap.segments.map((s) => ({ id: s.id, ok: s.validated, why: s.blockedReason, from: [s.from.x.toFixed(1), s.from.z.toFixed(1)], to: [s.to.x.toFixed(1), s.to.z.toFixed(1)] })),
  });
}

// Direct sidewalk rim walk: +X rim then +Z past pit then into altar
// sidewalk solid location
const sw = sim.solids.filter((s) => s.id.includes("sidewalk"));
console.log("sidewalk solids", sw);
console.log("pit", { half: (await import("../../src/game/world.ts")).shrinePitHalfWidth("pull"), span: (await import("../../src/game/world.ts")).shrinePitSpanZ("pull") });
