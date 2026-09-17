/**
 * R24 APPROACH_CONTACT phase controller — real call-layer contracts.
 * near-tower without contact must APPROACH, not FAIL/climb.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canHandoffToClimb, decideApproachContact } from "./walk-steer.ts";
import { TOWER_RADIUS } from "./world.ts";

const TOWER = { x: 10, z: 68 };

describe("R24 APPROACH_CONTACT phase", () => {
  it("near 6.82 / contact=false → turn or drive (not handoff, not stop-as-FAIL)", () => {
    // Historical dawn-4sh-r22 pose.
    const sample = {
      x: 11.38,
      z: 61.32,
      camYaw: 0,
      hp: 4,
      state: "grounded",
      touchingClimbable: false,
      nearestClimbId: "dawn-shaft",
      nearestClimbDistance: 6.82,
    };
    const d = decideApproachContact({
      sample,
      target: TOWER,
      requiredClimbPrefix: "dawn",
    });
    assert.ok(d.kind === "turn" || d.kind === "drive", `got ${JSON.stringify(d)}`);
    assert.notEqual(d.kind, "handoff");
  });

  it("facing the tower + no contact → short drive toward the surface", () => {
    // Place player due south of tower so camYaw=0 faces −Z… wait tower is +Z from player.
    // Player at z=61.32, tower z=68 → need to face +Z → camYaw = π.
    const sample = {
      x: 10,
      z: 61.5,
      camYaw: Math.PI,
      hp: 4,
      state: "grounded",
      touchingClimbable: false,
      nearestClimbId: null,
      nearestClimbDistance: 6.5,
    };
    const d = decideApproachContact({
      sample,
      target: TOWER,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(d.kind, "drive", JSON.stringify(d));
  });

  it("real contact + dawn id → handoff exactly once (gate ok)", () => {
    const sample = {
      x: 10 + TOWER_RADIUS + 0.55,
      z: 68,
      camYaw: Math.PI / 2, // face −X toward center from +X
      hp: 4,
      state: "grounded",
      touchingClimbable: true,
      nearestClimbId: "dawn-shaft",
      nearestClimbDistance: 4.75,
    };
    const d = decideApproachContact({
      sample,
      target: TOWER,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(d.kind, "handoff");
    const gate = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: sample.nearestClimbDistance,
      nearestClimbId: sample.nearestClimbId,
      touchingClimbable: true,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(gate.ok, true);
  });

  it("contact on the wrong tower stops — mere cannot take over dawn", () => {
    const d = decideApproachContact({
      sample: {
        x: 10,
        z: 61.5,
        camYaw: Math.PI,
        hp: 4,
        state: "grounded",
        touchingClimbable: true,
        nearestClimbId: "mere-shaft",
        nearestClimbDistance: 5,
      },
      target: TOWER,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(d.kind, "stop");
    assert.match((d as { reason: string }).reason, /wrong-wall/);
  });

  it("at shaft surface without contact stops (do not walk through the center)", () => {
    const d = decideApproachContact({
      sample: {
        x: 10 + 2.0,
        z: 68,
        camYaw: Math.PI / 2,
        hp: 4,
        state: "grounded",
        touchingClimbable: false,
        nearestClimbId: null,
        nearestClimbDistance: 2.0,
      },
      target: TOWER,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(d.kind, "stop");
    assert.match((d as { reason: string }).reason, /at-surface-no-contact/);
  });

  it("no-progress and dead stop the approach (bounded budget)", () => {
    const base = {
      x: 11.38,
      z: 61.32,
      camYaw: Math.PI,
      hp: 4,
      state: "grounded",
      touchingClimbable: false as boolean,
      nearestClimbId: "dawn-shaft" as string | null,
      nearestClimbDistance: 6.82 as number | null,
    };
    const stuck = decideApproachContact({
      sample: base,
      target: TOWER,
      requiredClimbPrefix: "dawn",
      noProgress: 12,
      maxNoProgress: 12,
    });
    assert.equal(stuck.kind, "stop");
    assert.match((stuck as { reason: string }).reason, /no-progress/);

    const dead = decideApproachContact({
      sample: { ...base, state: "dead", hp: 0 },
      target: TOWER,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(dead.kind, "stop");
  });
});

describe("R24 call-layer: executor invoked only after contact handoff", () => {
  it("near-no-contact → 0 executor calls; contact → exactly 1", async () => {
    let executorCalls = 0;
    const runClimbExecutor = async () => {
      executorCalls += 1;
      return { activated: true, climbingSeen: true };
    };
    /** Mirrors dawn-from-shrines.mjs gate shape. */
    const phase = async (sample: Parameters<typeof decideApproachContact>[0]["sample"], arrived: boolean) => {
      if (!arrived) return { ran: false };
      const dec = decideApproachContact({
        sample,
        target: TOWER,
        requiredClimbPrefix: "dawn",
      });
      if (dec.kind !== "handoff") return { ran: false, dec };
      const gate = canHandoffToClimb({
        world: "overworld",
        mode: "playing",
        alive: true,
        nearestClimbDistance: sample.nearestClimbDistance ?? null,
        nearestClimbId: sample.nearestClimbId ?? null,
        touchingClimbable: sample.touchingClimbable === true,
        requiredClimbPrefix: "dawn",
      });
      if (!gate.ok) return { ran: false, dec, gate };
      await runClimbExecutor();
      return { ran: true, dec };
    };

    // r22 pose: arrived, no contact
    await phase(
      {
        x: 11.38,
        z: 61.32,
        camYaw: 0,
        hp: 4,
        state: "grounded",
        touchingClimbable: false,
        nearestClimbId: "dawn-shaft",
        nearestClimbDistance: 6.82,
      },
      true,
    );
    assert.equal(executorCalls, 0, "no contact → 0 calls");

    // After APPROACH_CONTACT
    await phase(
      {
        x: 10 + TOWER_RADIUS + 0.55,
        z: 68,
        camYaw: Math.PI / 2,
        hp: 4,
        state: "grounded",
        touchingClimbable: true,
        nearestClimbId: "dawn-shaft",
        nearestClimbDistance: 4.75,
      },
      true,
    );
    assert.equal(executorCalls, 1, "contact → exactly 1 call");

    // Not arrived must never climb
    await phase(
      {
        x: 11.38,
        z: 61.32,
        camYaw: Math.PI,
        hp: 4,
        state: "grounded",
        touchingClimbable: true,
        nearestClimbId: "dawn-shaft",
        nearestClimbDistance: 4.8,
      },
      false,
    );
    assert.equal(executorCalls, 1, "not arrived → still 1 call total");
  });
});
