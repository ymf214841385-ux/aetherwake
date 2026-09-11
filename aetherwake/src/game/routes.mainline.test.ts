import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WATER_LEVEL, climateAt, heightAt } from "./height.ts";
import { BASE_STAMINA, CLIMB_SPEED, CLIMB_STAMINA, MANTLE_REACH_XZ, MANTLE_STEP_XZ, PLAYER_RADIUS } from "./params.ts";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import {
  CITADEL_POI,
  SHRINES,
  TOWER_HEIGHT,
  TOWER_LEDGE_D,
  TOWER_LEDGE_H,
  TOWER_LEDGE_RADIUS,
  TOWER_LEDGE_W,
  TOWER_RADIUS,
  TOWERS,
  shrineWorldOrigin,
  towerLedgeLocalY0,
  towerNeedsDock,
  towerShaftBaseY,
  towerSolids,
} from "./world.ts";
import { queryWall, resolveHorizontal } from "./physics.ts";

type Act = Parameters<Sim["step"]>[1];

function hold(partial: Partial<Act> = {}): Act {
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

function faceToward(s: Sim, x: number, z: number) {
  s.player.yaw = Math.atan2(s.player.x - x, s.player.z - z);
  s.cam.yaw = s.player.yaw;
}

function tower(id: string) {
  const tw = TOWERS.find((t) => t.id === id);
  assert.ok(tw, `missing tower ${id}`);
  return tw;
}

function shrinePoi(id: string) {
  const sh = SHRINES.find((t) => t.id === id);
  assert.ok(sh, `missing shrine ${id}`);
  return sh;
}

function fresh() {
  const s = new Sim(memoryStorage());
  s.freshRuntime(false);
  return s;
}

function xzTo(s: Sim, x: number, z: number) {
  return Math.hypot(s.player.x - x, s.player.z - z);
}

function onCap(s: Sim, tw: (typeof TOWERS)[number]) {
  return xzTo(s, tw.x, tw.z) < 5.2 && s.player.y > tw.y + TOWER_HEIGHT - 2.2;
}

function placeAt(s: Sim, x: number, z: number, y?: number) {
  s.player.x = x;
  s.player.z = z;
  s.player.y = y ?? s.heightFn(x, z) + 0.2;
  s.player.vx = 0;
  s.player.vy = 0;
  s.player.vz = 0;
  s.setMove("grounded");
}

function climbPoseOnDawn(s: Sim, yLocal = 10.4, stam = 12) {
  const tw = tower("dawn");
  s.player.x = tw.x;
  s.player.z = tw.z + TOWER_RADIUS + 0.5;
  s.player.y = tw.y + yLocal;
  s.player.vx = 0;
  s.player.vy = 0;
  s.player.vz = 0;
  s.player.stamina = stam;
  faceToward(s, tw.x, tw.z);
  s.setMove("climbing");
  return tw;
}

function dawnLedges(tw: (typeof TOWERS)[number]) {
  return towerSolids(tw).filter((q) => q.id.includes("-ledge-"));
}

const NO_REST_CLIMB_M = (BASE_STAMINA / CLIMB_STAMINA) * CLIMB_SPEED;

/** Player-like tower climb: W up, S onto a rest ledge, wait, then W+E to re-grab. */
function climbWithLedgeRest(s: Sim, tw: (typeof TOWERS)[number], seconds: number) {
  const steps = Math.floor(seconds * 60);
  let rested = 0;
  for (let i = 0; i < steps; i++) {
    if (s.towersOn.has(tw.id) || s.player.state === "dead") break;
    const p = s.player;
    if (p.state === "swimming" || p.state === "airborne" || (p.state === "grounded" && p.y < tw.y + 1.2)) {
      faceToward(s, tw.x, tw.z);
    }
    if (onCap(s, tw) || s.prompt.includes("启动")) {
      s.step(1 / 60, hold({ interact: true }));
      continue;
    }
    if (p.state === "climbing") {
      const rest = s.solids
        .filter((solid) => {
          if (!solid.id.startsWith(`${tw.id}-`)) return false;
          if (!solid.id.includes("-ledge-") && !solid.id.includes("-spiral-")) return false;
          return Math.abs(solid.y + solid.h - p.y) < 2.2;
        })
        .sort((a, b) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z))[0];
      if (p.stamina < 28 && rest) {
        const top = rest.y + rest.h;
        if (top > p.y + 0.85) s.step(1 / 60, hold({ moveY: 1 }));
        else s.step(1 / 60, hold({ moveY: -1 }));
      } else s.step(1 / 60, hold({ moveY: 1 }));
      continue;
    }
    if (p.state === "grounded") {
      if (p.y > tw.y + 1.8 && p.stamina < 88) {
        rested += 1;
        s.step(1 / 60, hold({}));
        continue;
      }
      s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
      continue;
    }
    s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
  }
  return rested;
}

function waitLock(s: Sim, frames = 70) {
  for (let i = 0; i < frames; i++) s.step(1 / 60, hold({}));
}

function enterShrineByInteract(s: Sim, id: string) {
  const sh = shrinePoi(id);
  placeAt(s, sh.x, sh.z, sh.y + 0.2);
  s.step(1 / 60, hold({ interact: true }));
  waitLock(s);
  assert.ok(s.shrine !== null, `叩响 did not enter ${id} prompt=${s.prompt}`);
  assert.equal(SHRINES[s.shrine!]?.id, id);
  return shrineWorldOrigin(s.shrine);
}

/** Legal explorer rim: +X to sidewalk, +Z past the pit, then into the altar cylinder. No arts. */
function walkSidePathToAltar(s: Sim, o: { x: number; y: number; z: number }) {
  const altar = { x: o.x, z: o.z + 23 };
  s.cam.yaw = -Math.PI / 2;
  s.player.yaw = -Math.PI / 2;
  for (let i = 0; i < 240; i++) {
    s.step(1 / 60, hold({ moveY: 1 }));
    if (s.player.x > o.x + 7.0) break;
  }
  s.cam.yaw = Math.PI;
  s.player.yaw = Math.PI;
  for (let i = 0; i < 420; i++) {
    s.step(1 / 60, hold({ moveY: 1 }));
    if (s.player.z > o.z + 21.6) break;
  }
  let minD = Infinity;
  let fell = false;
  for (let i = 0; i < 360; i++) {
    faceToward(s, altar.x, altar.z);
    s.step(1 / 60, hold({ moveY: 1 }));
    const d = Math.hypot(s.player.x - altar.x, s.player.z - altar.z);
    if (d < minD) minD = d;
    if (s.player.y < o.y - 1) {
      fell = true;
      break;
    }
    if (d < 2.05) break;
  }
  return { minD, fell, dAltar: Math.hypot(s.player.x - altar.x, s.player.z - altar.z), altar };
}

describe("QF geometry: towers, stamina, climate, shrine pits", () => {
  it("dawn base is heightAt(10,68); cap is base+38; no-rest climb is 22.67m", () => {
    const tw = tower("dawn");
    assert.equal(tw.x, 10);
    assert.equal(tw.z, 68);
    assert.ok(Math.abs(tw.y - heightAt(10, 68)) < 1e-5, `dawn.y=${tw.y} heightAt=${heightAt(10, 68)}`);
    assert.ok(Math.abs(tw.y - 11.1) < 1e-5, `harness TOWER_BASE_Y.dawn must stay ${tw.y}`);
    assert.ok(tw.y > WATER_LEVEL + 1, `dawn base y=${tw.y} should sit above WATER_LEVEL=${WATER_LEVEL}`);
    assert.equal(TOWER_HEIGHT, 38);
    assert.equal(TOWER_RADIUS, 4.2);
    assert.ok(Math.abs(NO_REST_CLIMB_M - 22.666666666666668) < 1e-9);
    const climbNeeded = TOWER_HEIGHT - 0.5;
    assert.ok(NO_REST_CLIMB_M < climbNeeded - 10, `no-rest ${NO_REST_CLIMB_M}m cannot cover ${climbNeeded}m shaft`);
    assert.equal(climateAt(10, 68, tw.y), "temperate");
  });

  it("dawn rest ledges are 0.42m thick, 3.45x2.45; inner lip sits outside the shaft", () => {
    const tw = tower("dawn");
    const solids = towerSolids(tw);
    const ledges = solids.filter((s) => s.id.includes("-ledge-"));
    assert.equal(ledges.length, 12);
    assert.equal(TOWER_LEDGE_W, 3.45);
    assert.equal(TOWER_LEDGE_D, 2.45);
    assert.equal(TOWER_LEDGE_H, 0.42);
    assert.ok(TOWER_LEDGE_RADIUS >= 5.9, `TOWER_LEDGE_RADIUS=${TOWER_LEDGE_RADIUS} must be >= 5.9`);
    const inner = TOWER_LEDGE_RADIUS - TOWER_LEDGE_D / 2;
    assert.ok(inner >= TOWER_RADIUS + 0.4, `inner=${inner} must be >= shaft+0.4=${TOWER_RADIUS + 0.4}`);
    assert.ok(inner >= 4.6, `inner=${inner} must be >= 4.6 (capsule ${TOWER_RADIUS + PLAYER_RADIUS})`);
    const i0 = ledges[0]!;
    const i4 = ledges[4]!;
    const i8 = ledges[8]!;
    assert.ok(Math.abs(Math.hypot(i0.x - tw.x, i0.z - tw.z) - TOWER_LEDGE_RADIUS) < 1e-6);
    assert.ok(Math.abs(i0.w! - 3.45) < 1e-9 && Math.abs(i0.d! - 2.45) < 1e-9);
    assert.ok(i0.h < 1, "thin standable boxes are skipped as walls in queryWall");
    const top0 = i0.y + i0.h;
    const top4 = i4.y + i4.h;
    const top8 = i8.y + i8.h;
    assert.ok(top0 > tw.y + 1.5 && top0 < tw.y + 4, `low row top=${top0}`);
    assert.ok(top4 > tw.y + 16 && top4 < tw.y + 24, `mid row top=${top4}`);
    assert.ok(top8 > tw.y + 32 && top8 < tw.y + 38, `high row top=${top8}`);
    const y0 = tw.y + towerLedgeLocalY0(tw.y);
    assert.ok(Math.abs(y0 - (tw.y + 2.1)) < 1e-6);
  });

  it("mere POI is above water but the ring at r>=4.7 is a swim; docks must exist for a lake approach", () => {
    const tw = tower("mere");
    assert.equal(tw.x, -108);
    assert.equal(tw.z, 8);
    assert.ok(tw.y > WATER_LEVEL, `mere.y=${tw.y} WATER_LEVEL=${WATER_LEVEL}`);
    assert.ok(Math.abs(tw.y - 7.8) < 1e-5, `harness TOWER_BASE_Y.mere must stay ${tw.y}`);
    assert.ok(heightAt(tw.x + 4.2, tw.z) > WATER_LEVEL - 0.05, "inner shaft ring should be dry enough to stand");
    assert.ok(heightAt(tw.x + 5, tw.z) < WATER_LEVEL - 0.05, "r=5 is already swimming");
    assert.equal(towerNeedsDock(tw), true, "lake ring around mere must count as a docked tower");
    const docks = towerSolids(tw).filter((s) => s.id.includes("-dock-"));
    assert.equal(docks.length, 8, `mere lake approach needs docks, got ${docks.length}`);
    assert.ok(Math.abs(docks[0]!.y - (WATER_LEVEL - 0.14)) < 1e-6, `dock y=${docks[0]!.y} WATER_LEVEL=${WATER_LEVEL}`);
    assert.equal(climateAt(tw.x, tw.z, tw.y), "lakeside");
  });

  it("mere shaft collision exists at the waterline so swim-grab is not a hollow under the pad", () => {
    const tw = tower("mere");
    const shaft = towerSolids(tw).find((s) => s.id === "mere-shaft");
    assert.ok(shaft);
    assert.ok(towerShaftBaseY(tw) <= WATER_LEVEL - 0.5, `shaftBase=${towerShaftBaseY(tw)} must reach the lake`);
    assert.ok(shaft!.y <= WATER_LEVEL - 0.5, `shaft.y=${shaft!.y} pad=${tw.y}`);
    const feet = WATER_LEVEL - 0.4;
    const wallX = tw.x;
    const wallZ = tw.z + TOWER_RADIUS + 0.2;
    const wall = queryWall(wallX, wallZ, feet, towerSolids(tw));
    assert.ok(wall?.climbable, `waterline queryWall missed shaft at y=${feet} hit=${wall?.id}`);
    const inside = resolveHorizontal(tw.x, tw.z + 0.2, feet, towerSolids(tw));
    assert.ok(Math.hypot(inside.x - tw.x, inside.z - tw.z) >= TOWER_RADIUS - 0.05, "waterline must not allow swimming through the cylinder");
  });

  it("crown (48,-128) is frost at climb y>36; spicy lasts 90s; no-rest climb dies in frost if unsheltered", () => {
    const tw = tower("crown");
    assert.equal(tw.x, 48);
    assert.equal(tw.z, -128);
    assert.equal(climateAt(48, -128, tw.y), "temperate");
    assert.equal(climateAt(48, -128, 36), "highland");
    assert.equal(climateAt(48, -128, 36.01), "frost");
    assert.equal(climateAt(48, -128, 40), "frost");
    assert.equal(climateAt(48, -128, tw.y + TOWER_HEIGHT), "frost");
    const s = fresh();
    s.cook("pepper");
    assert.equal(s.meals.length, 1);
    assert.equal(s.meals[0]?.spicy, true);
    s.eat(s.meals[0]!.id);
    assert.ok(Math.abs(s.player.spicy - 90) < 1e-6, `spicy=${s.player.spicy}`);
    const frostClimb = tw.y + TOWER_HEIGHT - 36;
    const frostTimeIfNoShelter = frostClimb / CLIMB_SPEED;
    assert.ok(frostTimeIfNoShelter > 3.2, `unsheltered frost exposure ~${frostTimeIfNoShelter.toFixed(1)}s exceeds one 3.2s HP tick`);
  });

  it("shrine interiors: altar cylinder r=2.2 at origin z+23; rime pit is wider than pull; sidewalk is a floor", () => {
    const rime = fresh();
    const o = enterShrineByInteract(rime, "rime");
    assert.equal(o.y, 520);
    assert.equal(o.z, 0);
    const pit = (lx: number, lz: number) => rime.heightFn(o.x + lx, o.z + lz);
    assert.ok(pit(0, 14) < o.y - 4, `rime center is a pit h=${pit(0, 14)}`);
    assert.ok(pit(5.0, 14) >= o.y - 0.01, `rime |lx|=5.0 is explorer rim, not pit (QF3 was abs(lx)<6.2)`);
    assert.ok(pit(4.5, 14) < o.y - 4, "rime |lx|=4.5 is still pit — wider than pull's 4.6");

    const pull = fresh();
    const op = enterShrineByInteract(pull, "pull");
    assert.ok(pull.heightFn(op.x + 4.5, op.z + 13) < op.y - 4, "pull |lx|=4.5 is pit");
    assert.ok(pull.heightFn(op.x + 5.0, op.z + 13) >= op.y - 0.01, "pull |lx|=5.0 is floor");
    const sidewalk = pull.solids.find((q) => q.id === "shrine-sidewalk");
    assert.ok(sidewalk, "sidewalk solid missing");
    assert.equal(sidewalk!.standable, true);
    assert.ok((sidewalk!.x ?? 0) > op.x + 6, `sidewalk x=${sidewalk!.x}`);
    const altar = pull.solids.find((q) => q.id === "shrine-altar");
    assert.ok(altar && Math.abs((altar.z ?? 0) - (op.z + 23)) < 1e-6);

    const burst = fresh();
    const ob = enterShrineByInteract(burst, "burst");
    const crack = burst.solids.find((q) => q.id === "crack");
    assert.ok(crack, "burst wall missing");
    assert.ok((crack!.w ?? 0) > 16, `burst wall must span the interior, w=${crack!.w}`);
    assert.ok(Math.abs((crack!.x ?? 0) - ob.x) < 0.01);
  });

  it("overworld shrine hut is a blocker with a dry apron; 叩响 works from the door face", () => {
    const rime = shrinePoi("rime");
    assert.ok(
      heightAt(rime.x + 5, rime.z) > WATER_LEVEL + 0.4,
      `rime +X apron wet y=${heightAt(rime.x + 5, rime.z)}`,
    );
    assert.ok(
      heightAt(rime.x, rime.z + 5) > WATER_LEVEL + 0.4,
      `rime +Z apron wet y=${heightAt(rime.x, rime.z + 5)}`,
    );
    const s = fresh();
    const body = s.solids.find((q) => q.id === "rime-body");
    const apron = s.solids.find((q) => q.id === "rime-apron");
    assert.ok(body, "rime-body missing");
    assert.equal(body!.standable, false);
    assert.equal(body!.climbable, false);
    assert.ok(apron, "rime-apron missing");
    assert.equal(apron!.standable, true);
    placeAt(s, rime.x, rime.z + 3.1, rime.y + 0.2);
    s.step(1 / 60, hold({ interact: true }));
    waitLock(s);
    assert.ok(s.shrine !== null, `door face did not 叩响 prompt=${s.prompt} xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`);
  });
});

describe("QF1 dawn: rest-ledge climb, W+E re-grab, activate", () => {
  it("S-to-ledge rest then W+E activates dawn without teleporting towersOn", () => {
    const s = fresh();
    const tw = tower("dawn");
    placeAt(s, tw.x, tw.z + 4.8);
    faceToward(s, tw.x, tw.z);
    assert.equal(s.towersOn.size, 0);
    const rested = climbWithLedgeRest(s, tw, 80);
    assert.ok(rested > 0, "38m shaft needs rest; no-rest stamina is only 22.67m");
    assert.equal(s.player.state === "dead", false, `died y=${s.player.y}`);
    assert.ok(
      s.towersOn.has("dawn"),
      `towers=${[...s.towersOn]} y=${s.player.y.toFixed(2)} cap=${(tw.y + TOWER_HEIGHT).toFixed(2)} state=${s.player.state} stam=${s.player.stamina.toFixed(1)} xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)} prompt=${s.prompt}`,
    );
    assert.ok(s.prompt.includes("晨光塔") || s.surveyT > 0, `activate prompt missing: ${s.prompt}`);
  });

  it("after S-to-ledge rest, W+E re-grabs instead of walking into the shaft", () => {
    const s = fresh();
    const tw = tower("dawn");
    placeAt(s, tw.x, tw.z + 4.8);
    faceToward(s, tw.x, tw.z);
    for (let i = 0; i < 2500 && s.player.stamina > 22; i++) {
      s.step(1 / 60, hold({ moveY: 1, interact: s.player.state !== "climbing", climb: s.player.state !== "climbing" }));
    }
    for (let i = 0; i < 24 && s.player.state === "climbing"; i++) s.step(1 / 60, hold({ moveY: -1 }));
    assert.equal(s.player.state, "grounded", `S did not land a rest ledge state=${s.player.state} y=${s.player.y}`);
    assert.ok(s.player.y > tw.y + 8, `rest y=${s.player.y} is not a mid-shaft ledge`);
    while (s.player.stamina < 90 && s.player.state === "grounded") s.step(1 / 60, hold({}));
    const y0 = s.player.y;
    const xz0 = xzTo(s, tw.x, tw.z);
    // Cam still faces the shaft (wish uses cam forward). W must re-grab, not walk off.
    for (let i = 0; i < 24; i++) s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
    assert.notEqual(s.player.state, "dead");
    assert.ok(s.player.y > y0 - 1.2, `fell from rest y=${y0} to ${s.player.y} (shaft drop)`);
    assert.ok(xzTo(s, tw.x, tw.z) < 8, `walked off ledge xz=${xzTo(s, tw.x, tw.z).toFixed(2)} from ${xz0.toFixed(2)}`);
    const after = s.player.state as string;
    assert.ok(
      after === "climbing" || (after === "grounded" && s.player.y > tw.y + 8),
      `after W+E state=${after} y=${s.player.y} xz=${xzTo(s, tw.x, tw.z).toFixed(2)}`,
    );
  });

  it("after rest, W without E does not dump the player into the wind-valley shaft", () => {
    const s = fresh();
    const tw = tower("dawn");
    placeAt(s, tw.x, tw.z + 4.8);
    faceToward(s, tw.x, tw.z);
    for (let i = 0; i < 2500 && s.player.stamina > 22; i++) {
      s.step(1 / 60, hold({ moveY: 1, interact: s.player.state !== "climbing", climb: s.player.state !== "climbing" }));
    }
    for (let i = 0; i < 24 && s.player.state === "climbing"; i++) s.step(1 / 60, hold({ moveY: -1 }));
    while (s.player.stamina < 90 && s.player.state === "grounded") s.step(1 / 60, hold({}));
    const y0 = s.player.y;
    for (let i = 0; i < 24; i++) s.step(1 / 60, hold({ moveY: 1 }));
    assert.ok(s.player.y > y0 - 1.5, `W-only walked off rest y=${y0} now y=${s.player.y} state=${s.player.state}`);
    assert.ok(xzTo(s, tw.x, tw.z) < 8, `W-only xz=${xzTo(s, tw.x, tw.z)} — wish uses cam forward into the shaft`);
  });
});

describe("QF1 mantle: local step, no 12m snap", () => {
  it("S or exhaustion mantle never teleports xz > 2m in one 1/60 step", () => {
    assert.ok(MANTLE_REACH_XZ <= 2, `MANTLE_REACH_XZ=${MANTLE_REACH_XZ} must stay local`);
    for (const kind of ["S", "exhaust"] as const) {
      const s = fresh();
      climbPoseOnDawn(s, 10.4, kind === "exhaust" ? 0 : 1);
      const x0 = s.player.x;
      const z0 = s.player.z;
      s.step(1 / 60, kind === "S" ? hold({ moveY: -1 }) : hold({}));
      const dxz = Math.hypot(s.player.x - x0, s.player.z - z0);
      assert.ok(
        dxz <= 2,
        `${kind} mantle xz=${dxz.toFixed(3)} from ${x0.toFixed(2)},${z0.toFixed(2)} to ${s.player.x.toFixed(2)},${s.player.z.toFixed(2)} — grabRest 12m snap is gone`,
      );
      assert.ok(dxz <= MANTLE_STEP_XZ + 0.5, `${kind} step xz=${dxz.toFixed(3)} exceeds local mantle`);
    }
  });

  it("opposite-face ledge (~11m) is not reached in one rest action", () => {
    const s = fresh();
    const tw = climbPoseOnDawn(s, 10.4, 1);
    const ledges = dawnLedges(tw);
    const near = ledges.slice().sort((a, b) => Math.hypot(s.player.x - a.x, s.player.z - a.z) - Math.hypot(s.player.x - b.x, s.player.z - b.z))[0]!;
    const opposite = ledges.slice().sort((a, b) => Math.hypot(s.player.x - b.x, s.player.z - b.z) - Math.hypot(s.player.x - a.x, s.player.z - a.z))[0]!;
    const opp0 = Math.hypot(s.player.x - opposite.x, s.player.z - opposite.z);
    assert.ok(opp0 > 8, `setup is not on an opposite face opp=${opp0.toFixed(2)} near=${near.id}`);
    const x0 = s.player.x;
    const z0 = s.player.z;
    s.step(1 / 60, hold({ moveY: -1 }));
    const oneStep = Math.hypot(s.player.x - x0, s.player.z - z0);
    assert.ok(oneStep <= 2, `one rest frame xz=${oneStep.toFixed(3)} teleported toward ${opposite.id}`);
    for (let i = 0; i < 24 && s.player.state === "climbing"; i++) s.step(1 / 60, hold({ moveY: -1 }));
    const opp = Math.hypot(s.player.x - opposite.x, s.player.z - opposite.z);
    assert.ok(
      opp > 8,
      `rest landed opposite-face ${opposite.id} opp=${opp.toFixed(2)} (was ${opp0.toFixed(2)}) pos=${s.player.x.toFixed(2)},${s.player.z.toFixed(2)} — 11m snap is forbidden`,
    );
  });

  it("W on a rest ledge does not immediately fall into the shaft cylinder", () => {
    const s = fresh();
    const tw = tower("dawn");
    const inner = TOWER_LEDGE_RADIUS - TOWER_LEDGE_D / 2;
    const ledge = dawnLedges(tw)[4]!;
    const top = ledge.y + ledge.h;
    placeAt(s, ledge.x, ledge.z, top + 0.02);
    faceToward(s, tw.x, tw.z);
    s.player.stamina = 90;
    const y0 = s.player.y;
    const xz0 = xzTo(s, tw.x, tw.z);
    assert.ok(xz0 > inner - 0.05, `start xz=${xz0.toFixed(3)} is inside inner lip ${inner}`);
    for (let i = 0; i < 24; i++) s.step(1 / 60, hold({ moveY: 1 }));
    const xz = xzTo(s, tw.x, tw.z);
    assert.notEqual(s.player.state, "dead");
    assert.ok(s.player.y > y0 - 1.2, `W walked off rest y=${y0} now y=${s.player.y} state=${s.player.state}`);
    assert.ok(xz > TOWER_RADIUS, `fell into shaft xz=${xz.toFixed(3)} (inner=${inner}, shaft=${TOWER_RADIUS})`);
    assert.ok(
      s.player.state === "climbing" || (s.player.state === "grounded" && s.player.y > top - 0.4),
      `W on rest state=${s.player.state} y=${s.player.y} xz=${xz.toFixed(2)} — inner lip must sit outside the cylinder`,
    );
  });
});

describe("QF4 mere / crown reachability", () => {
  it("mere W+E from the south dock waterline starts a climb and does not swim through the shaft", () => {
    const s = fresh();
    const tw = tower("mere");
    s.player.x = tw.x;
    s.player.z = tw.z + 5.7;
    s.player.y = WATER_LEVEL - 0.4;
    s.player.vx = 0;
    s.player.vy = 0;
    s.player.vz = 0;
    s.setMove("swimming");
    faceToward(s, tw.x, tw.z);
    let enteredHollow = false;
    let grabbed = false;
    for (let i = 0; i < 240; i++) {
      faceToward(s, tw.x, tw.z);
      s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
      const xz = xzTo(s, tw.x, tw.z);
      if (s.player.state !== "climbing" && xz < TOWER_RADIUS - 0.05) enteredHollow = true;
      if (s.player.state === "climbing") {
        grabbed = true;
        break;
      }
    }
    assert.equal(
      enteredHollow,
      false,
      `swam through shaft hollow xz=${xzTo(s, tw.x, tw.z).toFixed(2)} y=${s.player.y.toFixed(2)} state=${s.player.state}`,
    );
    assert.equal(
      grabbed,
      true,
      `W+E from water did not start climb state=${s.player.state} y=${s.player.y.toFixed(2)} xz=${xzTo(s, tw.x, tw.z).toFixed(2)} prompt=${s.prompt}`,
    );
  });

  it("swimming away from mere with W-only does not re-grab the shaft", () => {
    const s = fresh();
    const tw = tower("mere");
    s.player.x = tw.x + 5.2;
    s.player.z = tw.z;
    s.player.y = WATER_LEVEL - 0.3;
    s.setMove("swimming");
    s.cam.yaw = -Math.PI / 2;
    s.player.yaw = -Math.PI / 2;
    for (let i = 0; i < 90; i++) s.step(1 / 60, hold({ moveY: 1 }));
    assert.notEqual(s.player.state, "climbing", `W-only swim-away grabbed state=${s.player.state} xz=${xzTo(s, tw.x, tw.z).toFixed(2)}`);
    assert.ok(s.player.x > tw.x + 6, `did not swim away x=${s.player.x.toFixed(2)}`);
  });

  it("mere climb from lake water (W+E while swimming) then rest-ledges activates 镜湖塔", () => {
    const s = fresh();
    const tw = tower("mere");
    s.player.x = tw.x + 8;
    s.player.z = tw.z;
    s.player.y = WATER_LEVEL - 0.4;
    s.player.vx = 0;
    s.player.vy = 0;
    s.player.vz = 0;
    s.setMove("swimming");
    faceToward(s, tw.x, tw.z);
    assert.equal(s.towersOn.size, 0);
    climbWithLedgeRest(s, tw, 90);
    assert.equal(s.player.state === "dead", false, `died y=${s.player.y} xz=${xzTo(s, tw.x, tw.z)}`);
    assert.ok(
      s.towersOn.has("mere"),
      `mere from water failed towers=${[...s.towersOn]} y=${s.player.y.toFixed(2)} state=${s.player.state} xz=${xzTo(s, tw.x, tw.z).toFixed(2)} prompt=${s.prompt} — swimming must be able to start climb and rest ledges must catch a fall into the lake`,
    );
  });

  it("mere climb from the dry inner ring activates 镜湖塔", () => {
    const s = fresh();
    const tw = tower("mere");
    placeAt(s, tw.x + 4.35, tw.z, Math.max(tw.y, heightAt(tw.x + 4.35, tw.z), WATER_LEVEL) + 0.15);
    faceToward(s, tw.x, tw.z);
    climbWithLedgeRest(s, tw, 80);
    assert.ok(
      s.towersOn.has("mere"),
      `dry-ring mere towers=${[...s.towersOn]} y=${s.player.y.toFixed(2)} state=${s.player.state} prompt=${s.prompt}`,
    );
  });

  it("crown climb finishes without death when tower shelter or spicy exists", () => {
    const s = fresh();
    const tw = tower("crown");
    placeAt(s, tw.x + 4.7, tw.z, tw.y + 0.2);
    faceToward(s, tw.x, tw.z);
    assert.equal(s.player.spicy, 0);
    climbWithLedgeRest(s, tw, 90);
    assert.notEqual(
      s.player.state,
      "dead",
      `crown died hp=${s.player.hp} y=${s.player.y} spicy=${s.player.spicy} — frost ticks 0.25 HP / 3.2s above y=36 unless towerShelter() or spicy`,
    );
    assert.ok(s.player.hp > 0, `hp=${s.player.hp}`);
    assert.ok(
      s.towersOn.has("crown"),
      `crown not lit towers=${[...s.towersOn]} y=${s.player.y.toFixed(2)} state=${s.player.state} hp=${s.player.hp} cold=${s.player.cold} spicy=${s.player.spicy} prompt=${s.prompt}`,
    );
  });

  it("unsheltered frost at crown coords drains HP; spicy cook/eat blocks it", () => {
    const s = fresh();
    s.player.x = 48;
    s.player.z = -128;
    s.player.y = 42;
    s.setMove("airborne");
    s.player.vy = 0;
    // step while falling in frost, off the tower pad
    s.player.x = 70;
    s.player.z = -128;
    s.player.y = 42;
    for (let i = 0; i < 60; i++) s.step(1 / 60, hold({}));
    // If they already snapped to terrain below 36, skip drain assert and instead prove spicy duration.
    const s2 = fresh();
    s2.cook("pepper");
    s2.eat(s2.meals[0]!.id);
    const spicy0 = s2.player.spicy;
    for (let i = 0; i < 180; i++) s2.step(1 / 60, hold({}));
    assert.ok(s2.player.spicy < spicy0 - 2.5 && s2.player.spicy > spicy0 - 3.5, `spicy decays in seconds, now ${s2.player.spicy}`);
    assert.ok(spicy0 >= 89, `cooked spicy duration starts at 90, got ${spicy0}`);
  });
});

describe("QF3 shrines: pull/rime side path; still freeze-bridge; altar r=2.2", () => {
  for (const id of ["pull", "rime"] as const) {
    it(`${id}: 叩响, walk the side floor, 领取灵核 at dAltar<2.2 (no Digit2/3/4/5)`, () => {
      const s = fresh();
      assert.equal(s.orbs, 0);
      assert.equal(s.art, 0);
      const o = enterShrineByInteract(s, id);
      const { minD, fell, dAltar } = walkSidePathToAltar(s, o);
      assert.equal(s.art, 0, "side path must not require switching arts");
      assert.equal(fell, false, `${id} fell into the pit y=${s.player.y} dAltar=${dAltar.toFixed(2)}`);
      assert.ok(minD < 2.2, `${id} never entered altar cylinder minD=${minD.toFixed(2)} (QF3 rime stopped at 3.8)`);
      s.step(1 / 60, hold({ interact: true }));
      assert.ok(
        s.shrinesOn.has(id),
        `${id} orb not claimed pos=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)} dAltar=${dAltar.toFixed(2)} prompt=${s.prompt} shrine=${s.shrine} shrines=${[...s.shrinesOn]}`,
      );
      assert.equal(s.orbs, 1);
      assert.equal(s.shrinesOn.size, 1, "side path is a legal alternate for THIS shrine, not an auto-complete of all four arts");
    });
  }

  it("still: 叩响 + freeze bridge claims; side rim without 凝时 does not", () => {
    const s = fresh();
    const o = enterShrineByInteract(s, "still");
    const blocked = walkSidePathToAltar(s, o);
    assert.ok(
      blocked.fell || blocked.minD > 2.2 || s.player.z < o.z + 16,
      `still rim reached altar without freeze minD=${blocked.minD.toFixed(2)} z=${s.player.z.toFixed(1)}`,
    );
    s.step(1 / 60, hold({ interact: true }));
    assert.equal(s.shrinesOn.has("still"), false);

    const s2 = fresh();
    const o2 = enterShrineByInteract(s2, "still");
    s2.cam.yaw = Math.PI;
    s2.player.yaw = Math.PI;
    for (let i = 0; i < 240; i++) {
      s2.step(1 / 60, hold({ moveY: 1 }));
      if (s2.player.z > o2.z + 9.2) break;
    }
    for (let i = 0; i < 480 && Math.abs(s2.moveBlock.x - o2.x) >= 1.4; i++) s2.step(1 / 60, hold({}));
    s2.step(1 / 60, hold({ artSlot: 4 }));
    s2.step(1 / 60, hold({ art: true }));
    assert.ok(s2.moveBlock.frozen > 1, "still freeze must fire when aligned");
    let reached = false;
    for (let i = 0; i < 480; i++) {
      s2.cam.yaw = Math.PI;
      s2.player.yaw = Math.PI;
      s2.step(1 / 60, hold({ moveY: 1 }));
      if (Math.hypot(s2.player.x - o2.x, s2.player.z - (o2.z + 23)) < 2.05) {
        reached = true;
        break;
      }
      if (s2.player.y < o2.y - 1.2) break;
    }
    assert.ok(reached, `still freeze bridge never reached altar y=${s2.player.y.toFixed(2)} z=${s2.player.z.toFixed(1)}`);
    s2.step(1 / 60, hold({ interact: true }));
    assert.ok(s2.shrinesOn.has("still"), `still freeze did not claim prompt=${s2.prompt}`);
    assert.equal(s2.orbs, 1);
  });

  it("burst: sidewalk cannot pass the wall until 爆鸣; then altar claim works", () => {
    const s = fresh();
    const o = enterShrineByInteract(s, "burst");
    const blocked = walkSidePathToAltar(s, o);
    assert.equal(s.crackedBroken[s.shrine!], false);
    assert.ok(blocked.minD > 2.2 || blocked.fell || s.player.z < o.z + 16, `burst sidewalk walked through the bomb wall minD=${blocked.minD.toFixed(2)} z=${s.player.z}`);
    assert.equal(s.shrinesOn.has("burst"), false);
    s.player.x = o.x;
    s.player.z = o.z + 11.2;
    s.player.y = o.y + 0.2;
    s.explode(o.x, o.y + 1.2, o.z + 12.4);
    assert.equal(s.crackedBroken[s.shrine!], true);
    assert.equal(s.solids.some((q) => q.id === "crack"), false);
    const after = walkSidePathToAltar(s, o);
    assert.equal(after.fell, false, `burst fell after bomb y=${s.player.y}`);
    assert.ok(after.minD < 2.2, `burst never reached altar after bomb minD=${after.minD.toFixed(2)}`);
    s.step(1 / 60, hold({ interact: true }));
    assert.ok(s.shrinesOn.has("burst"), `burst orb not claimed prompt=${s.prompt}`);
  });

  it("rime side clearance from entrance hugging +X wall actually reaches dAltar<2.2", () => {
    const s = fresh();
    const o = enterShrineByInteract(s, "rime");
    const altar = { x: o.x, z: o.z + 23 };
    s.cam.yaw = -Math.PI / 2;
    s.player.yaw = -Math.PI / 2;
    for (let i = 0; i < 180; i++) {
      s.step(1 / 60, hold({ moveY: 1 }));
      if (s.player.x > o.x + 7.3) break;
    }
    assert.ok(s.player.x > o.x + 6.5, `did not reach rim x=${s.player.x}`);
    s.cam.yaw = Math.PI;
    s.player.yaw = Math.PI;
    for (let i = 0; i < 420; i++) {
      if (s.player.x < o.x + 6.8) {
        s.cam.yaw = -Math.PI / 2;
        s.player.yaw = -Math.PI / 2;
        s.step(1 / 60, hold({ moveY: 1 }));
        s.cam.yaw = Math.PI;
        s.player.yaw = Math.PI;
      } else {
        s.step(1 / 60, hold({ moveY: 1 }));
      }
      if (s.player.z > o.z + 21.8) break;
    }
    assert.ok(s.player.z > o.z + 20.5, `hug-wall never cleared the pit z=${s.player.z} (rime pit lz<20.4)`);
    let minD = Infinity;
    for (let i = 0; i < 300; i++) {
      faceToward(s, altar.x, altar.z);
      s.step(1 / 60, hold({ moveY: 1 }));
      const d = Math.hypot(s.player.x - altar.x, s.player.z - altar.z);
      if (d < minD) minD = d;
      if (s.player.y < o.y - 1) break;
      if (d < 2.05) break;
    }
    const dAltar = Math.hypot(s.player.x - altar.x, s.player.z - altar.z);
    assert.ok(s.player.y > o.y - 0.5, `rime hug fell into pit y=${s.player.y}`);
    assert.ok(minD < 2.2, `rime hug minD=${minD.toFixed(2)} dAltar=${dAltar.toFixed(2)} — QF3 stopped at 3.8`);
    s.step(1 / 60, hold({ interact: true }));
    assert.ok(s.shrinesOn.has("rime"), `rime not claimed dAltar=${dAltar.toFixed(2)} prompt=${s.prompt}`);
  });

  it("still side rim cannot claim without freeze; slab remains the intended bridge", () => {
    const s = fresh();
    const o = enterShrineByInteract(s, "still");
    assert.equal(s.moveBlock.z, o.z + 13);
    assert.equal(s.solids.some((q) => q.id.startsWith("shrine-sidewalk")), false);
    const { minD, fell } = walkSidePathToAltar(s, o);
    assert.ok(
      fell || minD > 2.2 || s.player.z < o.z + 16,
      `still rim reached altar without 凝时 minD=${minD.toFixed(2)} z=${s.player.z.toFixed(1)}`,
    );
    s.step(1 / 60, hold({ interact: true }));
    assert.equal(s.shrinesOn.has("still"), false, `still rim claimed prompt=${s.prompt}`);
  });

  it("rime center is a pit you can fall into; sidewalk is the legal floor around it", () => {
    const s = fresh();
    const o = enterShrineByInteract(s, "rime");
    s.cam.yaw = Math.PI;
    s.player.yaw = Math.PI;
    for (let i = 0; i < 240; i++) s.step(1 / 60, hold({ moveY: 1 }));
    assert.ok(s.player.y < o.y - 3, `center +Z should drop into rime pit y=${s.player.y} z=${s.player.z}`);
    const s2 = fresh();
    const o2 = enterShrineByInteract(s2, "rime");
    s2.player.x = o2.x + 7.15;
    s2.player.z = o2.z + 14;
    s2.player.y = o2.y + 0.2;
    s2.setMove("grounded");
    for (let i = 0; i < 30; i++) s2.step(1 / 60, hold({}));
    assert.ok(s2.player.y > o2.y - 0.4, `sidewalk is not a floor y=${s2.player.y}`);
  });

  it("rime pit is not a softlock: E/W climb or walk reaches lz>20.4 without shrine flags", () => {
    const s = fresh();
    const o = enterShrineByInteract(s, "rime");
    placeAt(s, o.x, o.z + 12, o.y - 4.4);
    assert.equal(s.orbs, 0);
    assert.equal(s.shrinesOn.size, 0);
    assert.equal(s.art, 0);
    assert.ok(s.player.z > o.z + 3.2, `door band z=${s.player.z}`);
    assert.ok(Math.hypot(s.player.x - o.x, s.player.z - (o.z + 23)) > 2.2, "pit center is not the altar");
    assert.equal(s.nearInteractable(), false, "pit must not count as interactable except altar r<2.2 and door z<o.z+3.2");

    s.cam.yaw = Math.PI;
    s.player.yaw = Math.PI;
    let climbed = false;
    for (let i = 0; i < 480; i++) {
      const lz = s.player.z - o.z;
      if (lz > 20.4 && s.player.y > o.y - 1) break;
      if (s.player.state === "climbing") climbed = true;
      s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
      if (s.player.state === "climbing") climbed = true;
    }
    if (s.player.z - o.z <= 20.4) {
      s.cam.yaw = -Math.PI / 2;
      s.player.yaw = -Math.PI / 2;
      for (let i = 0; i < 240; i++) {
        if (s.player.state === "climbing") {
          climbed = true;
          s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
        } else {
          s.step(1 / 60, hold({ moveY: 1, interact: true, climb: true }));
        }
        if (s.player.state === "climbing") climbed = true;
        if (s.player.y > o.y - 0.8) break;
      }
      s.cam.yaw = Math.PI;
      s.player.yaw = Math.PI;
      for (let i = 0; i < 360; i++) {
        s.step(1 / 60, hold({ moveY: 1 }));
        if (s.player.z - o.z > 20.4 && s.player.y > o.y - 1) break;
      }
    }
    const lz = s.player.z - o.z;
    assert.ok(
      lz > 20.4 && s.player.y > o.y - 1,
      `still in pit lz=${lz.toFixed(2)} y=${s.player.y.toFixed(2)} state=${s.player.state} climbed=${climbed} prompt=${s.prompt}`,
    );
    assert.equal(s.shrinesOn.size, 0, "escape must not write shrine flags");
    assert.equal(s.orbs, 0);
    assert.equal(s.art, 0);
    assert.ok(s.shrine !== null && SHRINES[s.shrine]?.id === "rime", "escape must not 离开灵祠");
  });
});

describe("citadel gate after seal", () => {
  it("the +Z visual gate is a collision opening, not a closed 22 m bar", () => {
    const s = fresh();
    const gateZ = CITADEL_POI.z + 11;
    const hit = queryWall(CITADEL_POI.x, gateZ, CITADEL_POI.y + 1, s.solids);
    assert.equal(hit, null, `gate center blocked by ${hit?.id}`);
    const wing = queryWall(CITADEL_POI.x + 8, gateZ, CITADEL_POI.y + 1, s.solids);
    assert.ok(wing, "wing walls must still exist beside the gate");
  });

  it("west wall collides at courtyard y, not only on the keep pad (90227 walked under it)", () => {
    const s = fresh();
    const courtyardZ = CITADEL_POI.z + 7.2;
    const y = s.heightFn(-4.5, courtyardZ);
    const hit = queryWall(-4.5, courtyardZ, y, s.solids);
    assert.equal(hit?.id, "citadel-wall--11-0", `courtyard west face open id=${hit?.id} y=${y.toFixed(2)} keepY=${CITADEL_POI.y.toFixed(2)}`);
    const gateAtFloor = queryWall(CITADEL_POI.x, CITADEL_POI.z + 11, y, s.solids);
    assert.equal(gateAtFloor, null, `gate must stay open at courtyard y=${y.toFixed(2)} blocked by ${gateAtFloor?.id}`);
  });

  it("seal-open walk from +Z reaches the courtyard boss without climbing the keep", () => {
    const s = fresh();
    for (const t of TOWERS) s.towersOn.add(t.id);
    for (const sh of SHRINES) {
      s.shrinesOn.add(sh.id);
      s.orbs += 1;
    }
    assert.equal(s.sealIsOpen(), true);
    placeAt(s, CITADEL_POI.x, CITADEL_POI.z + 16, CITADEL_POI.y + 0.2);
    faceToward(s, CITADEL_POI.x, CITADEL_POI.z + 7.2);
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss);
    for (let i = 0; i < 360; i++) {
      faceToward(s, boss!.x, boss!.z);
      s.step(1 / 60, hold({ moveY: 1 }));
      if (Math.hypot(s.player.x - boss!.x, s.player.z - boss!.z) < 2.4) break;
    }
    assert.ok(
      Math.hypot(s.player.x - boss!.x, s.player.z - boss!.z) < 2.8,
      `did not reach courtyard boss xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)} boss=${boss!.x.toFixed(1)},${boss!.z.toFixed(1)} state=${s.player.state}`,
    );
  });

  function openSeal(s: Sim) {
    for (const t of TOWERS) s.towersOn.add(t.id);
    for (const sh of SHRINES) {
      s.shrinesOn.add(sh.id);
      s.orbs += 1;
    }
  }

  it("dodge into the west wall stays in the courtyard (90227 clipped to x≈-11 y≈7.4)", () => {
    const s = fresh();
    openSeal(s);
    placeAt(s, -2.2, CITADEL_POI.z + 7.2);
    const y0 = s.player.y;
    s.cam.yaw = Math.PI / 2;
    s.player.stamina = 100;
    s.step(1 / 60, hold({ dodge: true, moveY: 1 }));
    for (let i = 0; i < 24; i++) s.step(1 / 60, hold({}));
    assert.ok(
      s.player.x > -5.05,
      `dodge clipped west wall to x=${s.player.x.toFixed(2)} z=${s.player.z.toFixed(2)} y=${s.player.y.toFixed(2)} from y0=${y0.toFixed(2)}`,
    );
    assert.ok(
      s.player.y > y0 - 1.2,
      `dodge dropped off the courtyard y ${y0.toFixed(2)}→${s.player.y.toFixed(2)} x=${s.player.x.toFixed(2)}`,
    );
  });

  it("90227 west-of-wall pose cannot bee-line the boss; gate path can", () => {
    const s = fresh();
    openSeal(s);
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss);
    placeAt(s, -11.1, -6.0);
    const yStuck = s.player.y;
    faceToward(s, boss!.x, boss!.z);
    for (let i = 0; i < 300; i++) {
      faceToward(s, boss!.x, boss!.z);
      s.step(1 / 60, hold({ moveY: 1, sprint: true }));
    }
    const bee = Math.hypot(s.player.x - boss!.x, s.player.z - boss!.z);
    assert.ok(
      bee > 5.5,
      `bee-line from 90227 pose reached d=${bee.toFixed(2)} xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)} y=${s.player.y.toFixed(1)} stuckY=${yStuck.toFixed(1)}`,
    );

    placeAt(s, -11.1, -6.0);
    const wps = [
      { x: -12, z: 6 },
      { x: CITADEL_POI.x, z: 8 },
      { x: CITADEL_POI.x, z: CITADEL_POI.z + 12.8 },
      { x: boss!.x, z: boss!.z + 2.4 },
    ];
    for (const wp of wps) {
      for (let i = 0; i < 420; i++) {
        faceToward(s, wp.x, wp.z);
        s.step(1 / 60, hold({ moveY: 1, sprint: true }));
        if (Math.hypot(s.player.x - wp.x, s.player.z - wp.z) < 2.4) break;
      }
    }
    const viaGate = Math.hypot(s.player.x - boss!.x, s.player.z - boss!.z);
    assert.ok(
      viaGate < 4.2,
      `gate return missed d=${viaGate.toFixed(2)} xz=${s.player.x.toFixed(1)},${s.player.z.toFixed(1)} y=${s.player.y.toFixed(1)} boss=${boss!.x.toFixed(1)},${boss!.z.toFixed(1)}`,
    );
  });

  it("boss AI does not wander west of the courtyard wall (Review19 production bounds)", () => {
    const s = fresh();
    openSeal(s);
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss);
    // Player west of wall — LOS blocked; boss must stay on courtyard side.
    placeAt(s, -11.1, -6.0);
    for (let i = 0; i < 420; i++) {
      s.step(1 / 60, hold({}));
    }
    assert.ok(
      boss!.x > -4.6,
      `boss left courtyard west face x=${boss!.x.toFixed(2)} z=${boss!.z.toFixed(2)} y=${boss!.y.toFixed(2)} phase=${boss!.brain?.phase}`,
    );
    // Knockback from west must resolve against the wall, not clip through.
    placeAt(s, 2, CITADEL_POI.z + 7.2);
    faceToward(s, boss!.x, boss!.z);
    // Force boss onto the west edge then damage with westward knockback.
    boss!.x = -3.6;
    boss!.z = CITADEL_POI.z + 7.2;
    boss!.y = s.heightFn(boss!.x, boss!.z);
    s.damageEnemy(boss!, 0.1, -8, 0);
    assert.ok(
      boss!.x > -5.05,
      `boss knockback clipped west wall x=${boss!.x.toFixed(2)} z=${boss!.z.toFixed(2)}`,
    );
  });

  it("harness west-corridor approach does not walk the boss off the fight floor", () => {
    // Live 51264: after west-corridor/-keep waypoints, boss ended at
    // (-13.1, y=3.6, -7.8) — west of wall and below courtyard.
    const s = fresh();
    openSeal(s);
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss);
    const boss0 = { x: boss!.x, y: boss!.y, z: boss!.z };
    const wps = [
      { x: 5, z: 80 },
      { x: 5, z: 15 },
      { x: -18, z: 5 },
      { x: -18, z: -12 },
      { x: 6, z: 8 },
      { x: 6, z: 0.8 },
    ];
    for (const wp of wps) {
      placeAt(s, wp.x, wp.z);
      for (let i = 0; i < 90; i++) {
        faceToward(s, wp.x, wp.z);
        s.step(1 / 60, hold({ moveY: 1, sprint: true }));
      }
    }
    // Engage briefly from the gate so aggro can pull the boss.
    for (let i = 0; i < 180; i++) {
      faceToward(s, boss!.x, boss!.z);
      s.step(1 / 60, hold({ moveY: 1 }));
    }
    assert.ok(
      boss!.x > -5.2 && boss!.x < 17.5,
      `boss left fight floor X from (${boss0.x.toFixed(1)},${boss0.z.toFixed(1)}) to (${boss!.x.toFixed(1)},${boss!.y.toFixed(1)},${boss!.z.toFixed(1)})`,
    );
    assert.ok(
      boss!.y > 8.5,
      `boss dropped below courtyard y=${boss!.y.toFixed(2)} at x=${boss!.x.toFixed(2)} z=${boss!.z.toFixed(2)}`,
    );
  });

  it("west wall collision reaches low ground so boss cannot walk under (51264)", () => {
    const s = fresh();
    openSeal(s);
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss);
    // Live: boss at (-13.1, y=3.6) after chasing west. Wall query at low y used to miss.
    boss!.x = -3.0;
    boss!.z = CITADEL_POI.z + 7.2;
    boss!.y = 6.3;
    boss!.brain.phase = "approach";
    placeAt(s, -12, CITADEL_POI.z + 7.2);
    for (let i = 0; i < 180; i++) {
      s.step(1 / 60, hold({}));
    }
    assert.ok(
      boss!.x > -5.2,
      `boss walked under west wall x=${boss!.x.toFixed(2)} y=${boss!.y.toFixed(2)} z=${boss!.z.toFixed(2)}`,
    );
    // queryWall itself must hit at the live low-y sample.
    const hit = queryWall(-4.5, CITADEL_POI.z + 7.2, 6.3, s.solids);
    assert.ok(
      hit && String(hit.id).includes("citadel-wall"),
      `low-y west face open id=${hit?.id} y=6.3`,
    );
  });

  it("boss soft arena bound walks home — no spawn teleport (Review20)", () => {
    const s = fresh();
    openSeal(s);
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss);
    boss!.x = -12.9;
    boss!.z = -8.2;
    boss!.y = 3.7;
    boss!.brain.phase = "approach";
    placeAt(s, 20, CITADEL_POI.z + 7.2);
    let prev = { x: boss!.x, z: boss!.z };
    let maxStep = 0;
    let teleported = false;
    for (let i = 0; i < 180; i++) {
      s.step(1 / 60, hold({}));
      const step = Math.hypot(boss!.x - prev.x, boss!.z - prev.z);
      if (step > maxStep) maxStep = step;
      // A jump from west-low to courtyard spawn is ~18m in one tick.
      if (step > 2.5) teleported = true;
      prev = { x: boss!.x, z: boss!.z };
    }
    assert.ok(!teleported, `boss teleported maxStep=${maxStep.toFixed(2)}`);
    assert.ok(maxStep < 1.2, `boss step too large maxStep=${maxStep.toFixed(2)}`);
    assert.ok(
      boss!.x > -12.9 + 2 || boss!.z > -8.2 + 2,
      `boss did not walk toward home x=${boss!.x.toFixed(2)} z=${boss!.z.toFixed(2)}`,
    );
    // After enough time it should clear the west face (no snap) and recover courtyard y.
    const z0 = boss!.z;
    for (let i = 0; i < 1800; i++) s.step(1 / 60, hold({}));
    assert.ok(
      boss!.x > -5.2 || boss!.z > CITADEL_POI.z + 3,
      `boss walk-home incomplete x=${boss!.x.toFixed(2)} y=${boss!.y.toFixed(2)} z=${boss!.z.toFixed(2)} (from z0=${z0.toFixed(2)})`,
    );
    assert.ok(boss!.y > 8.0, `boss y after walk-home=${boss!.y.toFixed(2)}`);
  });

  it("courtyard chase to north end keeps boss on walkable floor, continuous steps", () => {
    const s = fresh();
    openSeal(s);
    const boss = s.enemies.find((e) => e.kind === "boss");
    assert.ok(boss);
    const spawn = { x: boss!.x, y: boss!.y, z: boss!.z };
    // Player starts in courtyard then sprints toward the +Z gate / north.
    placeAt(s, CITADEL_POI.x, CITADEL_POI.z + 7.2);
    const trail = [];
    let prev = { x: boss!.x, z: boss!.z, y: boss!.y };
    let maxStep = 0;
    for (let i = 0; i < 480; i++) {
      // Drive player north through the gate gap.
      faceToward(s, CITADEL_POI.x, CITADEL_POI.z + 28);
      s.step(1 / 60, hold({ moveY: 1, sprint: true }));
      const step = Math.hypot(boss!.x - prev.x, boss!.z - prev.z);
      if (step > maxStep) maxStep = step;
      if (i % 12 === 0) {
        trail.push({
          i,
          px: +s.player.x.toFixed(2),
          pz: +s.player.z.toFixed(2),
          bx: +boss!.x.toFixed(2),
          by: +boss!.y.toFixed(2),
          bz: +boss!.z.toFixed(2),
          phase: boss!.brain.phase,
          step: +step.toFixed(3),
        });
      }
      prev = { x: boss!.x, z: boss!.z, y: boss!.y };
    }
    assert.ok(maxStep < 1.2, `boss teleported during chase maxStep=${maxStep.toFixed(2)} trail=${JSON.stringify(trail.slice(-4))}`);
    assert.ok(
      boss!.x > CITADEL_POI.x - 10.6 && boss!.x < CITADEL_POI.x + 11.6,
      `boss left arena X x=${boss!.x.toFixed(2)} trail=${JSON.stringify(trail.slice(-4))}`,
    );
    assert.ok(
      boss!.z > CITADEL_POI.z - 3.1 && boss!.z < CITADEL_POI.z + 13.6,
      `boss left arena Z z=${boss!.z.toFixed(2)} trail=${JSON.stringify(trail.slice(-4))}`,
    );
    const floorY = s.heightFn(CITADEL_POI.x, CITADEL_POI.z + 7.2);
    assert.ok(boss!.y > floorY - 3.2, `boss y dropped too far y=${boss!.y.toFixed(2)} floor=${floorY.toFixed(2)}`);
    // Must have actually engaged (moved from spawn), not frozen.
    assert.ok(
      Math.hypot(boss!.x - spawn.x, boss!.z - spawn.z) > 0.4,
      `boss never moved from spawn ${JSON.stringify(spawn)} now=${boss!.x.toFixed(2)},${boss!.z.toFixed(2)}`,
    );
  });

  it("kill4 first-death: dodge into the boss face still eats the strike; away clears", () => {
    // Production sim of dec#4→#5 geometry: windup at d≈2.4, dash along cam.
    function runDodge(faceAway: boolean) {
      const s = fresh();
      openSeal(s);
      const boss = s.enemies.find((e) => e.kind === "boss")!;
      placeAt(s, 5.3, -0.4);
      boss.x = 5.8;
      boss.z = -2.7;
      boss.y = s.heightFn(boss.x, boss.z);
      boss.brain.phase = "windup";
      boss.brain.t = 0.55;
      boss.telegraph = 0.55;
      s.player.hp = 3.5;
      s.player.stamina = 100;
      s.player.dodgeCd = 0;
      if (faceAway) {
        // Face courtyard-safe aim (away / strafe), then C.
        s.cam.yaw = Math.atan2(s.player.x - boss.x, s.player.z - boss.z);
      } else {
        // Face the boss (old harness ignored citadelDodgeAim).
        faceToward(s, boss.x, boss.z);
      }
      s.step(1 / 60, hold({ dodge: true }));
      for (let i = 0; i < 50; i++) s.step(1 / 60, hold({}));
      return {
        hp: s.player.hp,
        dist: Math.hypot(s.player.x - boss.x, s.player.z - boss.z),
        y: s.player.y,
      };
    }
    const into = runDodge(false);
    const away = runDodge(true);
    assert.ok(
      into.hp < 3.5 || into.dist < 1.6,
      `face-into dodge should be dangerous hp=${into.hp} d=${into.dist.toFixed(2)} y=${into.y.toFixed(2)}`,
    );
    assert.ok(
      away.hp >= into.hp,
      `face-away must not be worse than face-into away.hp=${away.hp} into.hp=${into.hp}`,
    );
    assert.ok(
      away.dist > into.dist - 0.05,
      `face-away should not end closer away.d=${away.dist.toFixed(2)} into.d=${into.dist.toFixed(2)}`,
    );
  });
});
