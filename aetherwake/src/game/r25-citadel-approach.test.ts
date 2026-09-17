/**
 * R25 citadel outer-wall gate approach — production physics only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { initWorld } from "./world.ts";
import { citadelGateApproachWaypoints, validateCitadelGateApproach } from "./citadel-approach.ts";
import { validateWalkSegment } from "./shrine-route.ts";
import { PLAYER_RADIUS } from "./params.ts";

function sim() {
  initWorld();
  const s = new Sim();
  s.mode = "playing";
  return s;
}

describe("R25 citadel gate approach", () => {
  it("straight back-wall → courtyard is rejected", () => {
    const s = sim();
    const seg = validateWalkSegment(
      { x: 14, y: s.heightFn(14, -24), z: -24 },
      { x: 6, y: s.heightFn(6, -4), z: -4 },
      { solids: s.solids, heightFn: s.heightFn, worldId: "overworld", id: "straight" },
    );
    assert.equal(seg.validated, false);
    assert.match(seg.blockedReason || "", /citadel-wall/);
  });

  it("old fallback (14,-20)→(10,-5) is rejected (keep/wall)", () => {
    const s = sim();
    const seg = validateWalkSegment(
      { x: 14, y: s.heightFn(14, -20), z: -20 },
      { x: 10, y: s.heightFn(10, -5), z: -5 },
      { solids: s.solids, heightFn: s.heightFn, worldId: "overworld", id: "fallback" },
    );
    assert.equal(seg.validated, false);
  });

  it("east outer detour from (14,-24) reaches the gate mouth continuously", () => {
    const s = sim();
    const r = validateCitadelGateApproach({
      player: { x: 14, y: s.heightFn(14, -24), z: -24 },
      solids: s.solids,
      heightFn: s.heightFn,
      extraSupports: s.extraSupports(),
    });
    assert.equal(r.ok, true, r.blockedReason);
    assert.ok(r.segments.length >= 5);
    assert.ok(r.segments.every((sg) => sg.validated));
    // Ends in courtyard south of keep
    const last = r.segments[r.segments.length - 1]!;
    assert.ok(Math.abs(last.to.x - 6) < 1);
    assert.ok(last.to.z < -3 && last.to.z > -6);
  });

  it("west outer detour from (0,-26) also reaches the gate", () => {
    const s = sim();
    const r = validateCitadelGateApproach({
      player: { x: 0, y: s.heightFn(0, -26), z: -26 },
      solids: s.solids,
      heightFn: s.heightFn,
      extraSupports: s.extraSupports(),
    });
    assert.equal(r.ok, true, r.blockedReason);
  });

  it("side offset exceeds east wall face + player capsule (no wall-hug cut)", () => {
    const wps = citadelGateApproachWaypoints({ x: 14, z: -24 });
    const side = wps.find((w) => w.z === -18);
    assert.ok(side, "must have a side-track waypoint");
    assert.ok(side.x > 17.7 + PLAYER_RADIUS, `side x=${side.x} must clear east wall face`);
  });

  it("waypoints keep south clearance off the back wall before turning east", () => {
    const wps = citadelGateApproachWaypoints({ x: 14, z: -24 });
    const first = wps[0]!;
    assert.ok(first.z <= -24.4, `first z=${first.z} must stay south of back-wall capsule`);
  });
});
