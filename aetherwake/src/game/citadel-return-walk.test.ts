/**
 * Review14: walk the REAL citadelReturnWaypoints from the 36458 stuck pose.
 * Does not teleport; only face+W per leg. Records min progress / collision.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "../../src/game/persistence.ts";
import { Sim } from "../../src/game/sim.ts";
import { CITADEL_POI, TOWERS } from "../../src/game/world.ts";
import {
  citadelOffArena,
  citadelReturnWaypoints,
  insideKeepVolume,
} from "../../scripts/qa/citadel-steer.mjs";

function hold(partial = {}) {
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

function openSeal() {
  const s = new Sim(memoryStorage());
  s.freshRuntime(false);
  for (const t of TOWERS) s.towersOn.add(t.id);
  for (const id of ["rime", "burst", "pull", "still"]) s.shrinesOn.add(id);
  s.orbs = 4;
  s.rebuildSolids();
  return s;
}

function faceAndWalk(s: Sim, tx: number, tz: number, maxFrames = 240, arrive = 2.4) {
  const start = { x: s.player.x, y: s.player.y, z: s.player.z };
  const wantYaw = Math.atan2(-(tx - s.player.x), -(tz - s.player.z));
  s.player.yaw = wantYaw;
  s.cam.yaw = wantYaw;
  let minD = Math.hypot(tx - s.player.x, tz - s.player.z);
  for (let i = 0; i < maxFrames; i++) {
    s.step(1 / 60, hold({ moveY: 1, sprint: true }));
    const d = Math.hypot(tx - s.player.x, tz - s.player.z);
    if (d < minD) minD = d;
    if (d < arrive) break;
  }
  return {
    start,
    end: { x: +s.player.x.toFixed(2), y: +s.player.y.toFixed(2), z: +s.player.z.toFixed(2) },
    minD: +minD.toFixed(2),
    arrived: minD < arrive,
    state: s.player.state,
  };
}

describe("citadelReturnWaypoints simulated walk from 36458 pose", () => {
  it("full keep-escape path reaches melee range of live boss", () => {
    const s = openSeal();
    const boss = s.enemies.find((e) => e.kind === "boss")!;
    assert.ok(boss?.alive);
    // 36458 stuck pose
    s.player.x = 7.0;
    s.player.z = -16.5;
    s.player.y = 10.8;
    s.player.stamina = 100;
    s.setMove("grounded");
    for (let i = 0; i < 15; i++) s.step(1 / 60, hold({}));
    const pose = () => ({ x: s.player.x, z: s.player.z, y: s.player.y });
    const p0 = { x: +s.player.x.toFixed(2), y: +s.player.y.toFixed(2), z: +s.player.z.toFixed(2) };
    console.log("pose0", JSON.stringify(p0), "insideKeep", insideKeepVolume(s.player.x, s.player.z));

    const off0 = citadelOffArena(pose(), boss);
    const wps = citadelReturnWaypoints(pose(), boss);
    console.log("off0", off0.reason, "wps", JSON.stringify(wps));
    assert.ok(wps.length >= 3);
    assert.ok(wps[0].x >= 16, `first leg should exit keep east (probe-proven), got x=${wps[0].x}`);
    assert.equal(off0.reason, "inside-keep");

    const legs = [];
    for (let i = 0; i < wps.length; i++) {
      const wp = wps[i];
      const arriveR = i === 0 ? 2.5 : i === wps.length - 1 ? 2.6 : 2.2;
      const r = faceAndWalk(s, wp.x, wp.z, 300, arriveR);
      legs.push({ i, target: wp, ...r });
      console.log(`leg${i}`, JSON.stringify(legs[legs.length - 1]));
      // Keep-escape success = left keep volume (offEnd), even if 2m from exact wp
      if (i === 0 && !insideKeepVolume(s.player.x, s.player.z)) {
        // continue remaining legs
      } else if (!r.arrived && i === 0) {
        break;
      }
    }

    const bossD = Math.hypot(boss.x - s.player.x, boss.z - s.player.z);
    const offEnd = citadelOffArena(pose(), boss);
    console.log("end", JSON.stringify({ bossD: +bossD.toFixed(2), offEnd, legs }));

    assert.ok(
      legs[0].arrived || !insideKeepVolume(s.player.x, s.player.z),
      `first leg must exit keep east; got ${JSON.stringify(legs[0])}`,
    );
    assert.ok(legs[0].end.y > 9, `east exit must stay near courtyard y; got ${legs[0].end.y}`);
    assert.ok(
      bossD < 3.5,
      `after return path must be in melee of boss; bossD=${bossD} end=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`,
    );
  });

  it("probe keep exits: north/south/west/east from (7,-16)", () => {
    const s = openSeal();
    const boss = s.enemies.find((e) => e.kind === "boss")!;
    const probes = [
      { name: "north", x: 6, z: -4 },
      { name: "south", x: 6, z: -18.5 },
      { name: "west", x: -12, z: -12 },
      { name: "east", x: 18, z: -12 },
      { name: "on-top-then-north", x: 6, z: -4, climb: true },
    ];
    const results = [];
    for (const p of probes) {
      s.player.x = 7.0;
      s.player.z = -16.5;
      s.player.y = 10.8;
      s.player.stamina = 100;
      s.setMove("grounded");
      for (let i = 0; i < 8; i++) s.step(1 / 60, hold({}));
      const wantYaw = Math.atan2(-(p.x - s.player.x), -(p.z - s.player.z));
      s.player.yaw = wantYaw;
      s.cam.yaw = wantYaw;
      let minD = Math.hypot(p.x - s.player.x, p.z - s.player.z);
      for (let i = 0; i < 200; i++) {
        if (p.climb) s.step(1 / 60, hold({ climb: true, moveY: 1 }));
        s.step(1 / 60, hold({ moveY: 1, sprint: true }));
        const d = Math.hypot(p.x - s.player.x, p.z - s.player.z);
        if (d < minD) minD = d;
        if (d < 3) break;
      }
      results.push({
        name: p.name,
        minD: +minD.toFixed(2),
        arrived: minD < 3,
        end: { x: +s.player.x.toFixed(2), y: +s.player.y.toFixed(2), z: +s.player.z.toFixed(2) },
      });
    }
    console.log("exit-probes", JSON.stringify(results));
    // At least one documented exit must work for harness recovery
    assert.ok(
      results.some((r) => r.arrived),
      `no walkable exit from keep interior: ${JSON.stringify(results)}`,
    );
  });
});
