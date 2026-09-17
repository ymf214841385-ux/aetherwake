#!/usr/bin/env node
import { initWorld, SHRINES, shrineWorldOrigin } from "../../src/game/world.ts";
import { Sim } from "../../src/game/sim.ts";
import { FIXED_DT } from "../../src/game/params.ts";

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

// Still: aligned frozen slab
{
  const { sim, o } = enter("still");
  sim.moveBlock.frozen = 5;
  sim.moveBlock.x = o.x;
  sim.moveBlock.z = o.z + 13;
  const slab = sim.solids.find((s) => s.id === "move-block");
  if (slab) { slab.x = o.x; slab.z = o.z + 13; }
  sim.player.x = o.x; sim.player.y = o.y; sim.player.z = o.z + 8;
  const snap = sim.navigationSnapshot();
  console.log("still frozen aligned", snap.status, snap.segments?.length, snap.reason, snap.guidance);
}

// Rime: two ice pillars
{
  const { sim, o } = enter("rime");
  sim.ices.push({ x: o.x, y: o.y, z: o.z + 12, life: 8, vx:0,vy:0,vz:0 });
  sim.ices.push({ x: o.x, y: o.y, z: o.z + 16, life: 8, vx:0,vy:0,vz:0 });
  sim.ices.push({ x: o.x, y: o.y, z: o.z + 20, life: 8, vx:0,vy:0,vz:0 });
  sim.player.x = o.x; sim.player.y = o.y; sim.player.z = o.z + 8;
  const snap = sim.navigationSnapshot();
  console.log("rime 3 ice", snap.status, snap.segments?.length, snap.nextAction);
}

// Pull plate exact id
{
  const { sim, o } = enter("pull");
  const plate = sim.metals.find((m) => m.id.startsWith("metal-shrine"));
  console.log("plate id", plate?.id, "o", o);
  plate.held = false;
  plate.x = o.x; plate.z = o.z + 13; plate.y = o.y - 0.05;
  const { supportY } = await import("../../src/game/physics.ts");
  const withP = supportY(o.x, o.z+13, o.y+0.5, sim.solids, sim.heightFn, sim.extraSupports(), null);
  plate.held = true;
  const held = supportY(o.x, o.z+13, o.y+0.5, sim.solids, sim.heightFn, sim.extraSupports(), null);
  console.log("support unheld", withP, "held", held);
}
