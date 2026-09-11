import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALTAR_ARRIVE,
  CITADEL_BLOCK,
  PIT_CLEAR_Z,
  PULL_APRON_BLOCK,
  RIME_PIT_HALF_X,
  SHRINE_APPROACH_STANDOFF,
  SHRINE_BODY_HALF,
  SHRINE_PROMPT_R,
  SIDEWALK_OFFSET_X,
  STILL_ALIGN_X,
  STILL_FROM_SPAWN,
  STILL_PIT_LIP_Z,
  STILL_SAFE_WAYPOINTS,
  canEnterIntendedShrine,
  stillBlockAligned,
  dAltar,
  enteredShrineMatches,
  inRimePit,
  navigationOutcome,
  segmentCrossesRimePit,
  segmentHitsOverworldBlock,
  shrineApproachCandidates,
  shrineApproachPoint,
  shrineNavTarget,
  shrinePromptMatches,
  shrineWorldOrigin,
  stillWaypointsClearObstacles,
} from "./shrine-steer.mjs";

describe("shrine altar steer QF3", () => {
  it("after z>origin+20 steers to (origin.x, origin.z+23) at 1.4 m, not the wall", () => {
    const o = shrineWorldOrigin(0);
    const pos = { x: o.x + 7.6, z: o.z + 22.4 };
    const t = shrineNavTarget("rime", o, pos);
    assert.equal(t.x, o.x);
    assert.equal(t.z, o.z + 23);
    assert.equal(t.arrive, ALTAR_ARRIVE);
    assert.equal(t.reason, "past-z20-altar");
    assert.ok(dAltar(pos, o) > 2.2);
    assert.ok(Math.hypot(t.x - pos.x, t.z - pos.z) > 2);
  });

  it("clears the rime pit on the sidewalk before cutting in", () => {
    const o = shrineWorldOrigin(0);
    const t = shrineNavTarget("rime", o, { x: o.x + 7.4, z: o.z + 20.4 });
    assert.equal(t.reason, "clear-pit");
    assert.ok(Math.abs(t.x - o.x) > 6.2);
    assert.ok(t.z > o.z + 20.5);
  });

  it("still stays on the sidewalk until past the pit lip, then uses the altar cylinder", () => {
    const o = shrineWorldOrigin(3);
    const before = shrineNavTarget("still", o, { x: o.x + 7.1, z: o.z + 20.4 });
    assert.equal(before.reason, "clear-pit");
    assert.equal(before.tapE, false);
    assert.ok(Math.abs(before.x - o.x) > 6.2);
    assert.ok(before.z > o.z + PIT_CLEAR_Z);
    const after = shrineNavTarget("still", o, { x: o.x + 7.1, z: o.z + 21.0 });
    assert.equal(after.x, o.x);
    assert.equal(after.z, o.z + 23);
    assert.equal(after.arrive, 1.4);
    assert.equal(after.reason, "past-z20-altar");
  });

  it("claims when inside 2.2 m", () => {
    const o = shrineWorldOrigin(2);
    const t = shrineNavTarget("pull", o, { x: o.x + 0.4, z: o.z + 23.1 });
    assert.equal(t.tapE, true);
  });

  it("never returns a teleport/snap instruction", () => {
    const o = shrineWorldOrigin(1);
    const t = shrineNavTarget("burst", o, { x: o.x, z: o.z + 4 });
    assert.equal(/teleport|snap|grabRest/i.test(t.reason), false);
    assert.equal(typeof t.x, "number");
    assert.equal(typeof t.z, "number");
  });

  it("from spawn goes +X to the sidewalk, not the diagonal that crosses the rime pit", () => {
    const o = shrineWorldOrigin(0);
    const spawn = { x: o.x, z: o.z + 4.4 };
    const t = shrineNavTarget("rime", o, spawn);
    assert.equal(t.reason, "sidewalk-x");
    assert.equal(t.tapE, false);
    assert.ok(Math.abs(t.x - (o.x + SIDEWALK_OFFSET_X)) < 0.05);
    assert.ok(t.z <= o.z + 8, `sidewalk-x must not run +Z into the pit z=${t.z}`);
    assert.equal(segmentCrossesRimePit(spawn, t, o), false);
    const forbidden = { x: o.x + 7.4, z: o.z + 22 };
    assert.equal(segmentCrossesRimePit(spawn, forbidden, o), true);
    assert.equal(RIME_PIT_HALF_X, 4.8);
    assert.equal(inRimePit({ x: o.x + 4.5, z: o.z + 14 }, o), true);
    assert.equal(inRimePit({ x: o.x + 5.0, z: o.z + 14 }, o), false);
  });

  it("burst still requires the bomb; sidewalk is not an auto-claim", () => {
    const o = shrineWorldOrigin(1);
    const spawn = shrineNavTarget("burst", o, { x: o.x, z: o.z + 4.4 });
    assert.equal(spawn.reason, "burst-wall");
    assert.equal(spawn.puzzle, "bomb");
    assert.equal(spawn.tapE, false);
    const side = shrineNavTarget("burst", o, { x: o.x + SIDEWALK_OFFSET_X, z: o.z + 10 });
    assert.equal(side.reason, "burst-wall");
    assert.equal(side.tapE, false);
    const past = shrineNavTarget("burst", o, { x: o.x + SIDEWALK_OFFSET_X, z: o.z + 22 });
    assert.equal(past.reason, "burst-wall");
    assert.equal(past.tapE, false);
    const open = shrineNavTarget("burst", o, { x: o.x + SIDEWALK_OFFSET_X, z: o.z + 22 }, { burstOpen: true });
    assert.notEqual(open.reason, "burst-wall");
    assert.equal(open.x, o.x);
    assert.equal(open.z, o.z + 23);
  });

  it("pull and still require gust/wait and do not auto-claim from the sidewalk", () => {
    const o = shrineWorldOrigin(2);
    const pullSpawn = shrineNavTarget("pull", o, { x: o.x, z: o.z + 4.4 });
    assert.equal(pullSpawn.reason, "pull-metal");
    assert.equal(pullSpawn.puzzle, "gust");
    assert.equal(pullSpawn.tapE, false);
    const pullSide = shrineNavTarget("pull", o, { x: o.x + SIDEWALK_OFFSET_X, z: o.z + 14 });
    assert.equal(pullSide.reason, "clear-pit");
    assert.equal(pullSide.tapE, false);

    const stillO = shrineWorldOrigin(3);
    const stillSpawn = shrineNavTarget("still", stillO, { x: stillO.x, z: stillO.z + 4.4 });
    assert.equal(stillSpawn.reason, "still-wait");
    assert.equal(stillSpawn.puzzle, "wait");
    assert.equal(stillSpawn.tapE, false);
    assert.ok(Math.abs(stillSpawn.x - stillO.x) > 6);
    const stillSide = shrineNavTarget("still", stillO, { x: stillO.x + SIDEWALK_OFFSET_X, z: stillO.z + 14 });
    assert.equal(stillSide.reason, "clear-pit");
    assert.equal(stillSide.tapE, false);
    assert.notEqual(stillSide.reason, "at-altar");
  });

  it("approach point stands off the shrine body but keeps the prompt in range", () => {
    const poi = { x: 36, z: 8 };
    for (const from of [
      { x: 24, z: 40 },
      { x: 118, z: 40 },
      { x: 14, z: -60 },
      { x: 36, z: 30 },
    ]) {
      const ap = shrineApproachPoint(poi, from);
      const d = Math.hypot(ap.x - poi.x, ap.z - poi.z);
      assert.ok(Math.abs(d - SHRINE_APPROACH_STANDOFF) < 1e-9, `standoff distance ${d}`);
      // outside the 4.4x4.4 body box on at least one axis
      assert.ok(
        Math.abs(ap.x - poi.x) > SHRINE_BODY_HALF || Math.abs(ap.z - poi.z) > SHRINE_BODY_HALF,
        `approach point inside the body box: ${ap.x},${ap.z}`,
      );
      // prompt radius still covers the box face from the approach point
      assert.ok(d < SHRINE_PROMPT_R, `prompt would not show at ${d}`);
      assert.equal(/teleport|snap|grabRest/i.test(`${ap.x},${ap.z}`), false);
    }
    const fallback = shrineApproachPoint(poi, null);
    assert.ok(Math.hypot(fallback.x - poi.x, fallback.z - poi.z) - SHRINE_APPROACH_STANDOFF < 1e-9);
  });

  it("approach candidates never include the shrine center", () => {
    const poi = { x: -72, z: 36 };
    const faces = shrineApproachCandidates(poi, poi);
    assert.ok(faces.length >= 4);
    for (const f of faces) {
      assert.ok(Math.hypot(f.x - poi.x, f.z - poi.z) > SHRINE_BODY_HALF, `face ${f.x},${f.z} inside body`);
      assert.ok(Math.hypot(f.x - poi.x, f.z - poi.z) < SHRINE_PROMPT_R);
    }
  });

  it("91526: wrong-shrine prompt 91m from still MUST refuse E and report nav failure", () => {
    const still = { x: 14, z: -78 };
    const pos = { x: 36.6, z: 10.5 };
    const dist = Math.hypot(pos.x - still.x, pos.z - still.z);
    assert.ok(dist > 85, `expected ~91m, got ${dist}`);
    const prompt = "进入 牵引祠";
    assert.equal(shrinePromptMatches(prompt, "still"), false, "generic 进入 must not match 凝时祠");
    assert.equal(shrinePromptMatches(prompt, "pull"), true);
    const gate = canEnterIntendedShrine({ id: "still", poi: still, x: pos.x, z: pos.z, prompt });
    assert.equal(gate.ok, false);
    assert.equal(gate.refuseE, true);
    assert.ok(gate.reason === "too-far" || gate.reason === "wrong-shrine", gate.reason);
    const nav = navigationOutcome({ dist, arrive: 1.4, timedOut: true });
    assert.equal(nav.arrived, false);
    assert.equal(nav.status, "timeout");
    assert.equal(enteredShrineMatches(2, "still"), false, "shrine 2 is pull, not still");
    assert.equal(enteredShrineMatches(3, "still"), true);
  });

  it("goTo timeout/nonarrival is an explicit failed status, arrival is not silent", () => {
    assert.deepEqual(navigationOutcome({ dist: 0.8, arrive: 2.2, timedOut: false }), {
      arrived: true,
      status: "arrived",
      dist: 0.8,
    });
    const timeout = navigationOutcome({ dist: 85.6, arrive: 2.6, timedOut: true });
    assert.equal(timeout.arrived, false);
    assert.equal(timeout.status, "timeout");
    const miss = navigationOutcome({ dist: 12, arrive: 2.2, timedOut: false });
    assert.equal(miss.arrived, false);
    assert.equal(miss.status, "nonarrival");
  });

  it("intended still overworld path leaves burst due south, not west into pull", () => {
    const burst = { x: 118, z: 28 };
    const still = { x: 14, z: -78 };
    const first = STILL_SAFE_WAYPOINTS[0];
    assert.ok(first.z < burst.z, `first still hop must go south, z ${first.z} vs burst ${burst.z}`);
    assert.ok(Math.abs(first.x - burst.x) < 8, `first hop must not cut west toward pull, x ${first.x}`);
    assert.ok(first.x > 90, "south leg stays on the east ridge, not the pull apron");
    const last = STILL_SAFE_WAYPOINTS[STILL_SAFE_WAYPOINTS.length - 1];
    const dStill = Math.hypot(last.x - still.x, last.z - still.z);
    assert.ok(dStill < SHRINE_PROMPT_R, `last waypoint ${last.x},${last.z} too far from 凝时祠 (${dStill})`);
    assert.ok(dStill > SHRINE_BODY_HALF);
    const okGate = canEnterIntendedShrine({
      id: "still",
      poi: still,
      x: last.x,
      z: last.z,
      prompt: "叩响 凝时祠",
    });
    assert.equal(okGate.ok, true, JSON.stringify(okGate));
    const wrongPrompt = canEnterIntendedShrine({
      id: "still",
      poi: still,
      x: last.x,
      z: last.z,
      prompt: "进入 牵引祠",
    });
    assert.equal(wrongPrompt.ok, false);
    assert.equal(wrongPrompt.refuseE, true);
    assert.equal(wrongPrompt.reason, "wrong-shrine");
  });

  it("still overworld waypoints do not bee-line through citadel walls or the pull apron", () => {
    const clear = stillWaypointsClearObstacles(STILL_SAFE_WAYPOINTS);
    assert.equal(clear.ok, true, JSON.stringify(clear));
    // 91526 pose is on the pull apron (finding). Citadel is a nearby west-wall
    // hypothesis: walking from that pose into the courtyard hits the east wall.
    assert.equal(segmentHitsOverworldBlock({ x: 36.6, z: 10.5 }, { x: 36.6, z: 10.5 }, PULL_APRON_BLOCK), true);
    assert.equal(segmentHitsOverworldBlock({ x: 36.6, z: 10.5 }, { x: 6, z: -5 }, CITADEL_BLOCK), true);
    assert.equal(segmentHitsOverworldBlock({ x: 40, z: 12 }, { x: 32, z: 4 }, PULL_APRON_BLOCK), true);
    const last = STILL_SAFE_WAYPOINTS[STILL_SAFE_WAYPOINTS.length - 1];
    assert.ok(Math.hypot(last.x - 14, last.z - -78) < SHRINE_PROMPT_R);
    assert.ok(Math.hypot(last.x - 14, last.z - -78) > SHRINE_BODY_HALF);
  });

  it("still from spawn stays east of the citadel and arrives at the south door", () => {
    const still = { x: 14, z: -78 };
    const clear = stillWaypointsClearObstacles(STILL_FROM_SPAWN);
    assert.equal(clear.ok, true, JSON.stringify(clear));
    for (const p of STILL_FROM_SPAWN) {
      assert.ok(p.x > 17.7 || p.z > 0.8 || p.z < -24.2, `spawn path ${p.x},${p.z} inside citadel block`);
    }
    const last = STILL_FROM_SPAWN[STILL_FROM_SPAWN.length - 1];
    assert.ok(Math.hypot(last.x - still.x, last.z - still.z) < SHRINE_PROMPT_R);
    assert.ok(Math.hypot(last.x - still.x, last.z - still.z) > SHRINE_BODY_HALF);
    assert.ok(STILL_PIT_LIP_Z < 10, "lip must sit on the floor, not in the pit");
    assert.equal(stillBlockAligned(364, 364.5), true);
    assert.equal(stillBlockAligned(364, 364 + STILL_ALIGN_X + 0.2), false);
  });
});
