/**
 * D3.1: production reposition executor + navigationOutcome.
 * Fail-first: arrive 3.2 wrongly "arrives" from 2.61m short of (6,-4).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOS_REPOSITION_ARRIVE,
  LOS_REPOSITION_TARGET,
  executeLosReposition,
  losRepositionNav,
} from "./los-reposition.mjs";
import { navigationOutcome } from "./shrine-steer.mjs";

// Recorded 9e35271 failure pose → (6,-4) distance ≈ 2.61
const START = { x: 4.6, y: 10.7, z: -1.8, bossMeleeBlocked: true, blockerId: "citadel-wall-0-11-w" };
const distToTarget = Math.hypot(LOS_REPOSITION_TARGET.x - START.x, LOS_REPOSITION_TARGET.z - START.z);

describe("D3.1 los reposition arrive radius", () => {
  it("documents why arrive 3.2 falsely arrived at 2.61m short (production navigationOutcome)", () => {
    assert.ok(Math.abs(distToTarget - 2.61) < 0.05, `dist=${distToTarget}`);
    const loose = navigationOutcome({ dist: distToTarget, arrive: 3.2, timedOut: false });
    assert.equal(loose.arrived, true, "old arrive 3.2 wrongly arrived");
    const tight = losRepositionNav(distToTarget, { timedOut: false });
    assert.equal(tight.arrived, false, "arrive 0.5 must not arrive");
    assert.equal(LOS_REPOSITION_ARRIVE, 0.5);
  });

  it("executor: fake immediate-arrive without moving → fail, blocked still true", async () => {
    const notes = [];
    const goTo = async () => ({
      ...START,
      nav: navigationOutcome({ dist: distToTarget, arrive: 3.2, timedOut: false }),
    });
    const { rec, ok } = await executeLosReposition({
      goTo,
      read: async () => START,
      note: (m) => notes.push(m),
      start: START,
    });
    assert.equal(ok, false);
    assert.equal(rec.arrived, true, "nav claimed arrived but pose unmoved");
    assert.ok(rec.displacement < 0.2, `must not move displacement=${rec.displacement}`);
    assert.equal(rec.blockedAfter, true);
    assert.match(notes.join("\n"), /reposition fail/);
  });

  it("executor: real walk to (6,-4) with LOS clear → ok and record fields", async () => {
    let pose = { ...START };
    const goTo = async (tx, tz, _ms, opts) => {
      // Mock walk: one step to target when arrive is tight (production contract).
      assert.equal(opts.arrive, LOS_REPOSITION_ARRIVE);
      assert.equal(opts.sprint, false);
      assert.equal(tx, LOS_REPOSITION_TARGET.x);
      assert.equal(tz, LOS_REPOSITION_TARGET.z);
      pose = {
        x: tx,
        y: 10.6,
        z: tz,
        bossMeleeBlocked: false,
        blockerId: null,
        nav: navigationOutcome({ dist: 0.1, arrive: opts.arrive, timedOut: false }),
      };
      return pose;
    };
    const { rec, ok } = await executeLosReposition({
      goTo,
      read: async () => pose,
      start: START,
    });
    assert.equal(ok, true, JSON.stringify(rec));
    assert.equal(rec.arrived, true);
    assert.equal(rec.blockedBefore, true);
    assert.equal(rec.blockedAfter, false);
    assert.ok(rec.displacement > 2, `displacement=${rec.displacement}`);
    assert.ok(rec.elapsedMs >= 0);
    assert.equal(rec.target.x, 6);
    assert.equal(rec.target.z, -4);
  });

  it("executor: arrived but LOS still blocked → fail", async () => {
    const goTo = async (tx, tz, _ms, opts) => ({
      x: tx,
      z: tz,
      y: 10.6,
      bossMeleeBlocked: true,
      blockerId: "citadel-wall-0-11-w",
      nav: navigationOutcome({ dist: 0.2, arrive: opts.arrive, timedOut: false }),
    });
    const { ok, rec } = await executeLosReposition({
      goTo,
      read: async () => START,
      start: START,
    });
    assert.equal(ok, false);
    assert.equal(rec.arrived, true);
    assert.equal(rec.blockedAfter, true);
  });
});
