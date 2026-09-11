/**
 * lookToward overshoot / wrap / key-release (Review08).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookToward, wrapAngle, yawError } from "./nav-walk.mjs";

function simIO(rateRadPerMs = 0.002) {
  const s = { mode: "playing", x: 0, z: 0, camYaw: 0, shrine: null, t: 0 };
  const holds = [];
  return {
    holds,
    s,
    async read() {
      return { ...s };
    },
    async hold(keys, ms) {
      holds.push({ keys, ms, released: false });
      // ArrowLeft increases camYaw (sim: cam.yaw -= lookX; ArrowLeft => lookX<0)
      const dir = keys[0] === "ArrowLeft" ? 1 : -1;
      s.camYaw = wrapAngle(s.camYaw + dir * rateRadPerMs * ms);
      s.t += ms / 1000;
      holds[holds.length - 1].released = true;
    },
  };
}

describe("lookToward convergence", () => {
  it("small positive error converges without requiring inflated tol", async () => {
    const io = simIO(0.002);
    // want ~0.40 rad — above tol, still a modest turn
    const tx = Math.sin(0.4) * 10;
    const tz = -Math.cos(0.4) * 10;
    const r = await lookToward(io, tx, tz, { tol: 0.18, maxPulses: 20, minPulseMs: 40, maxPulseMs: 200 });
    assert.equal(r.status, "aligned");
    assert.ok(Math.abs(r.err) <= 0.18);
    assert.ok(r.pulses >= 1);
  });

  it("small negative error converges", async () => {
    const io = simIO(0.002);
    const tx = Math.sin(-0.12) * 10;
    const tz = -Math.cos(-0.12) * 10;
    const r = await lookToward(io, tx, tz, { tol: 0.18, maxPulses: 20, minPulseMs: 40, maxPulseMs: 200 });
    assert.equal(r.status, "aligned");
  });

  it("wrap-around target (behind) uses shortest arc", async () => {
    const io = simIO(0.002);
    // camYaw starts 0; target behind = want ≈ π
    const r = await lookToward(io, 0, 10, { tol: 0.2, maxPulses: 30, minPulseMs: 40, maxPulseMs: 250 });
    assert.equal(r.status, "aligned");
    assert.ok(Math.abs(r.err) <= 0.2);
  });

  it("does not oscillate forever on a high rate if progressive pulses used", async () => {
    // High rate: 0.01 rad/ms → 80ms pulse = 0.8 rad overshoot risk
    const io = simIO(0.01);
    const tx = Math.sin(0.25) * 10;
    const tz = -Math.cos(0.25) * 10;
    const r = await lookToward(io, tx, tz, {
      tol: 0.18,
      maxPulses: 25,
      minPulseMs: 20,
      maxPulseMs: 300,
    });
    assert.equal(r.status, "aligned", `err=${r.err} pulses=${r.pulses}`);
    const errs = r.trace.map((t) => t.err).filter((e) => Number.isFinite(e));
    // final |err| should be among the smallest
    const minAbs = Math.min(...errs.map(Math.abs));
    assert.ok(Math.abs(r.err) <= minAbs + 1e-6);
  });

  it("releases keys even if read throws mid-look (hold contract)", async () => {
    let down = 0;
    let up = 0;
    let n = 0;
    const io = {
      async read() {
        n += 1;
        if (n > 3) throw new Error("Target closed");
        return { mode: "playing", x: 0, z: 0, camYaw: 0 };
      },
      async hold(keys, ms) {
        down += 1;
        try {
          /* key down */
        } finally {
          up += 1;
        }
        return ms;
      },
    };
    await assert.rejects(() =>
      lookToward(io, 5, 0, { tol: 0.1, maxPulses: 5, minPulseMs: 10 }),
    );
    assert.ok(down >= 1);
    assert.equal(down, up, "hold must pair down/up");
  });

  it("yawError wraps to [-π,π]", () => {
    assert.ok(Math.abs(yawError(3.0, 0, 0, 1, 0)) < Math.PI);
    assert.ok(Math.abs(wrapAngle(Math.PI + 0.1)) <= Math.PI);
  });
});
