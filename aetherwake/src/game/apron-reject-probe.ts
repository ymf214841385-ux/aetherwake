/**
 * C05 apron first-reject sample vs production step rules.
 * South rim snap (~0.74) is within production FOOT_SNAP*2 (snapVertical), so it
 * is walkable — not a STEP_UP reject. Door-side rise stays ~0.24.
 * Does NOT raise STEP_UP.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initWorld, SHRINES } from "./world.ts";
import { Sim } from "./sim.ts";
import { validateWalkSegment } from "./shrine-route.ts";
import { supportY, solidTop } from "./physics.ts";
import { FOOT_SNAP, STEP_UP, PLAYER_RADIUS } from "./params.ts";

function firstApronSnap(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, sim: Sim) {
  let feet = from.y;
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(2, Math.ceil(dist / (PLAYER_RADIUS * 1.1)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const sup = supportY(x, z, feet + FOOT_SNAP, sim.solids, sim.heightFn, sim.extraSupports(), null);
    const rise = sup.y - feet;
    if (rise > STEP_UP + 0.08 && sup.id.endsWith("-apron")) {
      return { i, x, z, prevFeet: feet, supportY: sup.y, supportId: sup.id, rise };
    }
    feet = sup.y;
  }
  return null;
}

describe("C05 apron first-reject", () => {
  it("south-side first apron snap rise is production-walkable (FOOT_SNAP*2), not a STEP_UP block", () => {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    const s = SHRINES.find((x) => x.id === "burst")!;
    const apron = sim.solids.find((q) => q.id === "burst-apron")!;
    const apronTop = solidTop(apron);
    const door = { x: s.x, y: apronTop, z: s.z + 2.8 };
    const from = { x: 115, y: sim.heightFn(115, 32.5), z: 32.5 };
    const snap = firstApronSnap(from, door, sim);
    assert.ok(snap, "must observe an apron snap sample on the south approach");
    assert.equal(snap.supportId, "burst-apron");
    // Historical sample ~0.70–0.74; production snapVertical allows FOOT_SNAP*2.
    assert.ok(snap.rise > STEP_UP, `sample rise ${snap.rise.toFixed(3)} exceeds STEP_UP (documented)`);
    assert.ok(snap.rise <= FOOT_SNAP * 2 + 1e-6, `rise ${snap.rise.toFixed(3)} must be within production snap ${FOOT_SNAP * 2}`);
    const seg = validateWalkSegment(from, door, {
      solids: sim.solids,
      heightFn: sim.heightFn,
      extraSupports: sim.extraSupports(),
      worldId: "overworld",
      id: "apron",
    });
    assert.equal(seg.validated, true, seg.blockedReason);
  });

  it("high-terrain door sample steps onto apron within STEP_UP", () => {
    initWorld();
    const sim = new Sim();
    const s = SHRINES.find((x) => x.id === "burst")!;
    // Door terrain ≈ 10.12, apron top 10.36 → rise ≈ 0.24
    const feet = sim.heightFn(s.x, s.z + 2.8);
    const sup = supportY(s.x, s.z + 2.8, feet + FOOT_SNAP, sim.solids, sim.heightFn, [], null);
    const rise = sup.y - feet;
    assert.ok(rise < STEP_UP + 0.08, `door-side rise ${rise.toFixed(3)} should be steppable`);
    assert.equal(sup.id, "burst-apron");
  });
});
