/**
 * Real walkTo / lookToward / followWaypoints (shared nav-walk.mjs).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { followRouteWithRespawn, followWaypoints, lookToward, walkStepMs, walkTo, yawError } from "./nav-walk.mjs";

function ioFrom(states, { turnFail = false } = {}) {
  let i = 0;
  const holds = [];
  return {
    holds,
    async read() {
      const s = states[Math.min(i, states.length - 1)];
      i += 1;
      return s;
    },
    async lookToward(tx, tz, opts) {
      const s = await this.read();
      if (turnFail) return { status: "timeout", err: 0.9, camYaw: s?.camYaw ?? 0, pulses: 3 };
      // emulate convergence: snap camYaw toward target after one pulse
      if (s) {
        const want = Math.atan2(-(tx - s.x), -(tz - s.z));
        s.camYaw = want;
      }
      return { status: "aligned", err: 0, camYaw: s?.camYaw ?? 0, pulses: 1 };
    },
    async hold(keys, ms) {
      holds.push({ keys, ms });
    },
  };
}

describe("shared lookToward + walkTo", () => {
  it("lookToward converges when arrow pulses reduce err", async () => {
    // camYaw starts 0; target requires turning
    const s = { mode: "playing", x: 16, z: 102, camYaw: 0, shrine: null };
    let pulses = 0;
    const io = {
      async read() {
        return { ...s };
      },
      async hold(keys) {
        pulses += 1;
        // sim.ts: cam.yaw -= lookX; ArrowLeft => lookX<0 => cam.yaw increases
        if (keys[0] === "ArrowLeft") s.camYaw += 0.25;
        if (keys[0] === "ArrowRight") s.camYaw -= 0.25;
      },
    };
    const r = await lookToward(io, 40, 80, { tol: 0.18, maxPulses: 10, pulseMs: 10 });
    assert.equal(r.status, "aligned");
    assert.ok(Math.abs(r.err) <= 0.18);
    assert.ok(pulses >= 1);
  });

  it("lookToward timeout reports final err", async () => {
    const io = {
      async read() {
        return { mode: "playing", x: 0, z: 0, camYaw: 0, shrine: null };
      },
      async hold() {},
    };
    const r = await lookToward(io, 10, 0, { tol: 0.05, maxPulses: 2, pulseMs: 5 });
    assert.equal(r.status, "timeout");
    assert.ok(Number.isFinite(r.err));
  });

  it("walkTo does NOT press W when lookToward fails", async () => {
    const io = ioFrom([{ mode: "playing", x: 16, z: 102, camYaw: 0, shrine: null }], { turnFail: true });
    const r = await walkTo(io, 40, 80, 2000, { arrive: 3.2, expectShrine: null, stepMs: 50 });
    assert.equal(r.status, "turn-failed");
    assert.ok(io.holds.every((h) => !h.keys.includes("KeyW")), "W must not fire when unaligned");
    assert.ok(r.look && r.look.status === "timeout");
  });

  it("walkTo presses W only after aligned and distance can decrease", async () => {
    // Simulated: starts near target, aligned snap, W shrinks distance
    let x = 16;
    let z = 102;
    const states = [];
    const io = {
      async read() {
        return { mode: "playing", x, z, camYaw: yawError(0, x, z, 40, 80) === 0 ? 0 : Math.atan2(-(40 - x), -(80 - z)), shrine: null };
      },
      async lookToward() {
        return { status: "aligned", err: 0, camYaw: 0, pulses: 0 };
      },
      async hold(keys, ms) {
        if (keys.includes("KeyW")) {
          // move toward (40,80)
          const dx = 40 - x;
          const dz = 80 - z;
          const d = Math.hypot(dx, dz) || 1;
          const step = Math.min(2, (ms / 220) * 1.2);
          x += (dx / d) * step;
          z += (dz / d) * step;
          states.push({ x, z, ms });
        }
      },
    };
    const r = await walkTo(io, 40, 80, 3000, { arrive: 3.2, expectShrine: null, stepMs: 200 });
    assert.equal(r.status, "arrived");
    assert.ok(r.dist < 3.2);
    assert.ok(states.length >= 1, "must walk when aligned");
    assert.ok(states.at(-1).ms <= 800, "step should be distance-scaled, not huge");
  });

  it("walkStepMs shortens as we approach arrive radius", () => {
    const far = walkStepMs(30, 3.2, 220);
    const near = walkStepMs(4, 3.2, 220);
    assert.ok(near <= far);
    assert.ok(near >= 80);
    assert.ok(far <= 880);
  });

  it("inside shrine walking to lip is not region-changed", async () => {
    const io = ioFrom([
      { mode: "playing", x: 364, z: 6, shrine: 3, camYaw: 0 },
      { mode: "playing", x: 364, z: 8.8, shrine: 3, camYaw: 0 },
      { mode: "playing", x: 364, z: 9.0, shrine: 3, camYaw: 0 },
    ]);
    const r = await walkTo(io, 364, 9.2, 5000, { arrive: 1.4, expectShrine: 3, stepMs: 10 });
    assert.equal(r.status, "arrived");
  });

  it("followWaypoints aborts on first non-arrived", async () => {
    let n = 0;
    const io = {
      async read() {
        n += 1;
        return { mode: "playing", x: 16, z: 102, shrine: null, camYaw: 0 };
      },
      async lookToward() {
        return { status: "timeout", err: 1, camYaw: 0, pulses: 1 };
      },
      async hold() {},
    };
    const results = await followWaypoints(io, [{ x: 40, z: 80 }, { x: 48, z: 20 }], 80, {
      arrive: 3,
      expectShrine: null,
      stepMs: 10,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "turn-failed");
  });

  it("yawError wraps to [-pi,pi]", () => {
    assert.ok(Math.abs(yawError(3.0, 0, 0, 1, 0)) < Math.PI);
  });

  it("followRouteWithRespawn resets to index 0 after spawn respawn", async () => {
    const wps = [
      { x: 40, z: 80 },
      { x: 48, z: 20 },
      { x: 18, z: -90 },
    ];
    // read() is called once per walkTo when player is already at the goal (arrived).
    // Sequence: wp0 arrive → wp1 arrive → death → respawn → wp0 → wp1 → complete.
    let visit = 0;
    const io = {
      async read() {
        visit += 1;
        if (visit === 3) {
          return { mode: "dead", x: 41, z: -88, camYaw: 0, shrine: null, hp: 0, state: "dead", toast: "hit" };
        }
        // visits 1,2 → wp0,wp1; after respawn visit resets so 4,5 → wp0,wp1; 6 → wp2
        const map = { 1: 0, 2: 1, 4: 0, 5: 1, 6: 2 };
        const w = wps[map[visit] ?? 0];
        return { mode: "playing", x: w.x, z: w.z, camYaw: 0, shrine: null, hp: 3, state: "grounded" };
      },
      async lookToward() {
        return { status: "aligned", err: 0, camYaw: 0, pulses: 0 };
      },
      async hold() {},
      async respawn() {
        // Simulate camp respawn at spawn; next read (after) will be at spawn via visit++.
        visit = 3;
      },
    };
    // After death, orchestrator calls respawn then read() once — that read must be at spawn.
    // visit 4 would be wp0 by map; we need one read at spawn first.
    // Patch: after respawn, next read is visit 4 → we want spawn (16,102) not wp0.
    // Adjust map: visit 4 = spawn, 5 = wp0, 6 = wp1, 7 = wp2.
    const ioSpawn = {
      async read() {
        visit += 1;
        if (visit === 3) {
          return { mode: "dead", x: 41, z: -88, camYaw: 0, shrine: null, hp: 0, state: "dead", toast: "hit" };
        }
        if (visit === 4) {
          return { mode: "playing", x: 16, z: 102, camYaw: 0, shrine: null, hp: 3, state: "grounded" };
        }
        const map = { 1: 0, 2: 1, 5: 0, 6: 1, 7: 2 };
        const w = wps[map[visit] ?? 0];
        return { mode: "playing", x: w.x, z: w.z, camYaw: 0, shrine: null, hp: 3, state: "grounded" };
      },
      async lookToward() {
        return { status: "aligned", err: 0, camYaw: 0, pulses: 0 };
      },
      async hold() {},
      async respawn() {
        /* visit already 3; next read is 4 = spawn */
      },
    };
    const r = await followRouteWithRespawn(ioSpawn, wps, 1000, {
      arrive: 2,
      expectShrine: null,
      maxRouteAttempts: 3,
      spawnX: 16,
      spawnZ: 102,
    });
    assert.ok(r.deaths.length >= 1, "must record death");
    assert.ok(r.log.some((e) => e.note === "respawn-at-spawn-reset-route"), "must reset route after spawn");
    assert.equal(r.ok, true, `should complete after reset status=${r.status} log=${JSON.stringify(r.log)}`);
    assert.equal(r.status, "completed");
  });

  it("followRouteWithRespawn does not jump from spawn to a late waypoint", async () => {
    const wps = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 0 },
    ];
    const calls = [];
    let n = 0;
    const io = {
      async read() {
        n += 1;
        if (n === 3) return { mode: "dead", x: 15, z: 0, camYaw: 0, shrine: null, hp: 0, state: "dead" };
        const idx = n <= 1 ? 0 : n === 2 ? 1 : 0;
        return { mode: "playing", x: wps[idx].x, z: wps[idx].z, camYaw: 0, shrine: null, hp: 3, state: "grounded" };
      },
      async lookToward() {
        return { status: "aligned", err: 0, camYaw: 0, pulses: 0 };
      },
      async hold() {},
      async respawn() {
        // respawn to spawn (0,0) — next walk target must be wp0, not wp2
        n = 0;
      },
    };
    // Wrap by recording walkTo targets via hold — walkTo won't hold if already at target.
    // Record via log i values in followRoute result.
    const r = await followRouteWithRespawn(io, wps, 500, {
      arrive: 1,
      expectShrine: null,
      maxRouteAttempts: 2,
      spawnX: 0,
      spawnZ: 0,
    });
    const afterReset = r.log.filter((e) => e.note === "respawn-at-spawn-reset-route");
    assert.ok(afterReset.length >= 1);
    // After reset, first processed index must be 0
    const idxAfter = r.log.findIndex((e) => e.note === "respawn-at-spawn-reset-route");
    assert.equal(r.log[idxAfter + 1]?.i, 0, "after spawn reset next wp index must be 0");
  });
});
