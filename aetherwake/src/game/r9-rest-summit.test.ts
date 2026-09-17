/**
 * Review 09 — valid rest fixture from headed short-loop-real2 i23.
 * Pose: x=13.08, z=71.94, support dawn-spiral-4 top y=30.585, body clear.
 * ASCEND → REST on grounded ledge → recover stamina → ASCEND.
 * Do not invent world y by adding tw.y to local height.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import { TOWERS, TOWER_HEIGHT } from "./world.ts";
import { supportY, queryWall } from "./physics.ts";
import { FOOT_SNAP } from "./params.ts";

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

function freshAtRest() {
  const s = new Sim(memoryStorage());
  s.freshRuntime(false);
  const tw = TOWERS.find((t) => t.id === "dawn")!;
  // Exact headed i23 pose (world coords).
  const x = 13.08;
  const z = 71.94;
  const feet = 30.58500038146973;
  const sup = supportY(x, z, feet + FOOT_SNAP, s.solids, s.heightFn, s.extraSupports(), null);
  assert.equal(sup.id, "dawn-spiral-4", `support must be spiral ledge, got ${sup.id}`);
  assert.ok(Math.abs(sup.y - feet) < 0.05, `feet on support, support.y=${sup.y} feet=${feet}`);
  const wall = queryWall(x, z, feet, s.solids);
  assert.equal(wall, null, `body must be clear at rest, hit ${wall?.id}`);
  s.player.x = x;
  s.player.z = z;
  s.player.y = feet;
  s.player.vy = 0;
  s.player.vx = 0;
  s.player.vz = 0;
  s.player.stamina = 100;
  s.player.hp = 3;
  s.setMove("grounded");
  // Re-assert after placement
  const sup2 = supportY(s.player.x, s.player.z, s.player.y + FOOT_SNAP, s.solids, s.heightFn, s.extraSupports(), null);
  assert.equal(sup2.id, "dawn-spiral-4");
  assert.equal(s.player.state, "grounded");
  return { s, tw };
}

describe("R9 valid rest fixture summit", () => {
  it("ASCEND→REST→recover→ASCEND from dawn-spiral-4 reaches activate height", (t) => {
    const { s, tw } = freshAtRest();
    const activateY = tw.y + TOWER_HEIGHT - 2.2;
    let maxY = s.player.y;
    const trace: {
      phase: string;
      i: number;
      y: number;
      state: string;
      stam: number;
      x: number;
      z: number;
      support?: string;
    }[] = [];
    const snap = (phase: string, i: number) => {
      const sup = supportY(s.player.x, s.player.z, s.player.y + FOOT_SNAP, s.solids, s.heightFn, s.extraSupports(), null);
      trace.push({
        phase,
        i,
        y: +s.player.y.toFixed(3),
        state: s.player.state,
        stam: +s.player.stamina.toFixed(1),
        x: +s.player.x.toFixed(2),
        z: +s.player.z.toFixed(2),
        support: sup.id,
      });
    };

    let phase: "ASCEND" | "REST" = "ASCEND";
    let restFrames = 0;
    let ascendFrames = 0;
    let cycles = 0;

    for (let i = 0; i < 1800; i++) {
      maxY = Math.max(maxY, s.player.y);
      if (s.towersOn.has("dawn") || s.player.state === "dead") break;
      if (s.player.y >= activateY) {
        s.step(1 / 60, hold({ interact: true }));
        if (s.towersOn.has("dawn")) break;
      }

      if (phase === "ASCEND") {
        ascendFrames += 1;
        s.step(1 / 60, hold({ climb: true, moveY: 1 }));
        // Low stamina while climbing → descend toward rest
        if (s.player.stamina < 8 && s.player.state === "climbing") {
          s.step(1 / 60, hold({ climb: true, moveY: -1 }));
        }
        // Legitimate rest ledge + grounded → switch REST
        if (s.player.state === "grounded" && s.player.stamina < 40) {
          const sup = supportY(s.player.x, s.player.z, s.player.y + FOOT_SNAP, s.solids, s.heightFn, s.extraSupports(), null);
          if (sup.id.includes("spiral") || sup.id.includes("ledge") || sup.id.includes("cap")) {
            phase = "REST";
            restFrames = 0;
            snap("to-REST", i);
          }
        }
        if (ascendFrames > 400 && s.player.stamina < 5) {
          phase = "REST";
          restFrames = 0;
          snap("forced-REST-low-stam", i);
        }
      } else {
        // REST: release all gameplay movement/climb/interact.
        restFrames += 1;
        s.step(1 / 60, hold({}));
        if (restFrames % 30 === 0) snap("REST", i);
        if (s.player.stamina >= 85 || restFrames > 400) {
          phase = "ASCEND";
          ascendFrames = 0;
          cycles += 1;
          snap("to-ASCEND", i);
          // Intentional toward-wall regrab: climb + up
          s.step(1 / 60, hold({ climb: true, moveY: 1 }));
        }
      }
      if (i % 60 === 0) snap(phase, i);
    }

    t.diagnostic(JSON.stringify({ maxY: +maxY.toFixed(2), finalY: +s.player.y.toFixed(2), cycles, towers: [...s.towersOn], tail: trace.slice(-12) }));

    assert.ok(
      s.towersOn.has("dawn") || maxY >= activateY || s.player.y >= activateY,
      `valid rest ASCEND/REST schedule failed: maxY=${maxY.toFixed(2)} y=${s.player.y.toFixed(2)} activateY=${activateY.toFixed(2)} stam=${s.player.stamina.toFixed(1)} state=${s.player.state}`,
    );
  });

  it("rest without input does not auto-regrab; intentional climb regrabs", () => {
    const { s } = freshAtRest();
    const y0 = s.player.y;
    for (let i = 0; i < 60; i++) s.step(1 / 60, hold({}));
    assert.equal(s.player.state, "grounded", "must stay grounded on rest without input");
    assert.ok(Math.abs(s.player.y - y0) < 0.5);
    // Toward wall regrab
    let grabbed = false;
    for (let i = 0; i < 90; i++) {
      s.step(1 / 60, hold({ climb: true, moveY: 1 }));
      if ((s.player.state as string) === "climbing") {
        grabbed = true;
        break;
      }
    }
    assert.ok(grabbed, "intentional climb must regrab from rest ledge");
  });
});
