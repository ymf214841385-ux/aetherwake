/**
 * D3.1/D3.2: production reposition executor + navigationOutcome + sim geometry.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOSS_Z_CONTINUE,
  LOS_REPOSITION_ARRIVE,
  LOS_REPOSITION_GATE_CENTER,
  LOS_REPOSITION_TARGET,
  executeLosReposition,
  losCleared,
  losRepositionNav,
} from "./los-reposition.mjs";
import { navigationOutcome } from "./shrine-steer.mjs";

const START = {
  x: 4.6,
  y: 10.7,
  z: -1.8,
  bossMeleeBlocked: true,
  blockerId: "citadel-wall-0-11-w",
  boss: { x: 3.3, z: 1.5 },
};
const distToTarget = Math.hypot(
  LOS_REPOSITION_TARGET.x - START.x,
  LOS_REPOSITION_TARGET.z - START.z,
);

function navOk(dist = 0.2) {
  return navigationOutcome({ dist, arrive: LOS_REPOSITION_ARRIVE, timedOut: false });
}

describe("D3.1 los reposition arrive radius", () => {
  it("documents why arrive 3.2 falsely arrived at 2.61m short", () => {
    assert.ok(Math.abs(distToTarget - 2.61) < 0.05, `dist=${distToTarget}`);
    const loose = navigationOutcome({ dist: distToTarget, arrive: 3.2, timedOut: false });
    assert.equal(loose.arrived, true);
    const tight = losRepositionNav(distToTarget, { timedOut: false });
    assert.equal(tight.arrived, false);
  });
});

describe("D3.2 two-segment reposition + strict clear", () => {
  it("losCleared: undefined blocked is NOT clear; boss required", () => {
    assert.equal(losCleared(null), false);
    assert.equal(losCleared({ bossMeleeBlocked: false }), false, "boss missing");
    assert.equal(losCleared({ boss: {}, bossMeleeBlocked: undefined }), false);
    assert.equal(losCleared({ boss: {}, bossMeleeBlocked: true }), false);
    assert.equal(losCleared({ boss: {}, bossMeleeBlocked: false }), true);
  });

  it("nav.arrived false cannot pass even if distance looks close", async () => {
    const goTo = async (tx, tz, _ms, opts) => ({
      x: tx,
      z: tz,
      y: 10.6,
      boss: { x: 10.6, z: 0.5 },
      bossMeleeBlocked: false,
      blockerId: null,
      // dist > arrive so outcome is timeout, not arrived
      nav: navigationOutcome({ dist: 2.0, arrive: opts.arrive, timedOut: true }),
    });
    const { ok, rec } = await executeLosReposition({
      goTo,
      read: async () => ({
        x: 4.6,
        z: -1.8,
        y: 10.7,
        boss: { x: 10.6, z: 0.5 },
        bossMeleeBlocked: false,
        blockerId: null,
      }),
      start: START,
    });
    assert.equal(ok, false);
    assert.equal(rec.reason, "seg1-nav-not-arrived");
  });

  it("segment1 clear does not append segment2", async () => {
    const calls = [];
    let pose = { ...START };
    const goTo = async (tx, tz) => {
      calls.push({ tx, tz });
      pose = {
        x: tx,
        z: tz,
        y: 10.6,
        boss: { x: 3.3, z: 1.5 },
        bossMeleeBlocked: false,
        blockerId: null,
        nav: navOk(),
      };
      return pose;
    };
    const { ok, rec } = await executeLosReposition({
      goTo,
      read: async () => pose,
      start: START,
    });
    assert.equal(ok, true, JSON.stringify(rec));
    assert.equal(rec.segments.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tx, LOS_REPOSITION_TARGET.x);
  });

  it("wing-blocked + boss.z>-0.3 walks (6,2) and can clear", async () => {
    const calls = [];
    let pose = {
      x: 5.57,
      y: 10.73,
      z: -0.77,
      boss: { x: 10.63, z: 0.5 },
      bossMeleeBlocked: true,
      blockerId: "citadel-wall-0-11-e",
    };
    const goTo = async (tx, tz) => {
      calls.push({ tx, tz });
      const atCenter = tz === LOS_REPOSITION_GATE_CENTER.z;
      pose = {
        x: tx,
        z: tz,
        y: 10.6,
        boss: { x: 10.63, z: 0.5 },
        bossMeleeBlocked: !atCenter,
        blockerId: atCenter ? null : "citadel-wall-0-11-e",
        nav: navOk(),
      };
      return pose;
    };
    const { ok, rec } = await executeLosReposition({
      goTo,
      read: async () => pose,
      start: pose,
    });
    assert.equal(ok, true, JSON.stringify(rec));
    assert.equal(rec.segments.length, 2);
    assert.deepEqual(
      calls.map((c) => [c.tx, c.tz]),
      [
        [LOS_REPOSITION_TARGET.x, LOS_REPOSITION_TARGET.z],
        [LOS_REPOSITION_GATE_CENTER.x, LOS_REPOSITION_GATE_CENTER.z],
      ],
    );
  });

  it("wing-blocked but boss.z<=-0.3 stops without segment2", async () => {
    const calls = [];
    const goTo = async (tx, tz) => {
      calls.push({ tx, tz });
      return {
        x: tx,
        z: tz,
        y: 10.6,
        boss: { x: 6, z: -5 },
        bossMeleeBlocked: true,
        blockerId: "citadel-wall-0-11-e",
        nav: navOk(),
      };
    };
    const { ok, rec } = await executeLosReposition({
      goTo,
      read: async () => ({
        ...START,
        boss: { x: 6, z: -5 },
        bossMeleeBlocked: true,
        blockerId: "citadel-wall-0-11-e",
      }),
    });
    assert.equal(ok, false);
    assert.equal(rec.reason, "boss-z-condition-not-met");
    assert.equal(calls.length, 1);
  });

  it("segment2 still blocked fails immediately", async () => {
    let pose = {
      x: 5.5,
      y: 10.7,
      z: -0.8,
      boss: { x: 10.6, z: 0.5 },
      bossMeleeBlocked: true,
      blockerId: "citadel-wall-0-11-e",
    };
    const goTo = async (tx, tz) => {
      pose = {
        x: tx,
        z: tz,
        y: 10.6,
        boss: { x: 10.6, z: 0.5 },
        bossMeleeBlocked: true,
        blockerId: "citadel-wall-0-11-e",
        nav: navOk(),
      };
      return pose;
    };
    const { ok, rec } = await executeLosReposition({
      goTo,
      read: async () => pose,
    });
    assert.equal(ok, false);
    assert.equal(rec.segments.length, 2);
    assert.equal(rec.reason, "seg2-still-blocked");
  });

  it("null snapshot fails without crash", async () => {
    const { ok, rec } = await executeLosReposition({
      goTo: async () => null,
      read: async () => null,
      start: null,
    });
    assert.equal(ok, false);
    assert.equal(rec.reason, "no-start-snapshot");
  });
});
