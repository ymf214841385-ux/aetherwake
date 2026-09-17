#!/usr/bin/env node
import { initWorld, SHRINES, shrineWorldOrigin } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";

function enter(id) {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  const idx = SHRINES.findIndex((s) => s.id === id);
  sim.enterShrine(idx);
  sim.interactLock = 0;
  sim.mode = "playing";
  return { sim, o: shrineWorldOrigin(idx) };
}

for (const yOff of [-4.6, -2, -1, -0.5, 0, 0.5]) {
  const { sim, o } = enter("rime");
  for (const z of [12, 15, 18]) {
    sim.ices.push({ x: o.x, y: o.y + yOff, z: o.z + z, life: 8, vx:0,vy:0,vz:0 });
  }
  sim.player.x = o.x; sim.player.y = o.y; sim.player.z = o.z + 8;
  const snap = sim.navigationSnapshot();
  console.log("yOff", yOff, "status", snap.status, "segs", snap.segments.length, "validated", snap.segments.filter(s=>s.validated).length);
}
