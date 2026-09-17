/**
 * R20/R21/R22 climb executor wiring regressions — real executor contracts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideClimbAction } from "./climb-controller.ts";
import { canFaceEnemyBody, canHandoffToClimb } from "./walk-steer.ts";
import { initWorld, TOWERS, TOWER_RADIUS } from "./world.ts";
import { Sim } from "./sim.ts";

describe("R20 climb executor contracts", () => {
  it("grounded spiral low stamina → REST (executor must stop input)", () => {
    const d = decideClimbAction(
      {
        state: "grounded",
        y: 30.5,
        stamina: 12,
        nearestClimbId: "dawn-spiral-4",
        interactVisible: true,
      },
      {},
    );
    assert.equal(d.phase, "REST");
    assert.equal(d.releaseInput, true);
    assert.equal(d.tryClimb, false);
  });

  it("climbing low stamina → DESCEND (executor must not ASCEND-loop)", () => {
    const d = decideClimbAction(
      { state: "climbing", y: 36, stamina: 5, nearestClimbId: "dawn-shaft", interactVisible: true },
      {},
    );
    assert.equal(d.phase, "DESCEND");
  });

  it("FAIL → executor stops immediately", () => {
    const d = decideClimbAction(
      { state: "grounded", y: 30, stamina: 20, nearestClimbId: "dawn-spiral-4", mode: "paused" },
      { restElapsedMs: 0 },
    );
    assert.equal(d.phase, "FAIL");
  });

  it("high grounded with cap support is SUMMIT not APPROACH-shaft", () => {
    const d = decideClimbAction(
      {
        state: "grounded",
        y: 47,
        stamina: 90,
        nearestClimbId: "dawn-cap",
        interactVisible: true,
        towers: [],
      },
      { activateY: 46.9 },
    );
    assert.equal(d.phase, "SUMMIT_INTERACT");
  });

  it("high grounded without interact visible is not SUMMIT", () => {
    const d = decideClimbAction(
      {
        state: "grounded",
        y: 47,
        stamina: 90,
        nearestClimbId: "dawn-cap",
        interactVisible: false,
      },
      { activateY: 46.9 },
    );
    assert.notEqual(d.phase, "SUMMIT_INTERACT");
  });

  it("R24: grounded on shaft at activate height is SUMMIT not APPROACH-loop", () => {
    // dawn-4sh-r24: y=49.15 support dawn-shaft grounded — must light, not regrab.
    const d = decideClimbAction(
      {
        state: "grounded",
        y: 49.15,
        stamina: 100,
        nearestClimbId: "dawn-shaft",
        interactVisible: true,
      },
      { activateY: 46.9 },
    );
    assert.equal(d.phase, "SUMMIT_INTERACT");
    assert.equal(d.tryInteract, true);
    assert.equal(d.tryClimb, false);
  });

  it("R24: mere climb does not short-circuit when dawn is already lit", () => {
    const d = decideClimbAction(
      {
        state: "grounded",
        y: 8,
        stamina: 100,
        nearestClimbId: "mere-shaft",
        interactVisible: false,
        towers: ["dawn"],
      },
      { activateY: 40, targetTowerId: "mere" },
    );
    assert.notEqual(d.reason, "already-lit");
    assert.notEqual(d.phase, "SUMMIT_INTERACT");
    assert.equal(d.phase, "APPROACH");
  });
});

describe("R22 climb handoff uses production contact + target id", () => {
  it("center-distance alone never unlocks handoff", () => {
    // Old bug: d=2.0 with no wall probe passed. Production requires queryWall contact.
    const g = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: 2.0,
      nearestClimbId: "dawn-shaft",
    });
    assert.equal(g.ok, false);
    assert.match(g.reason, /not-touching/);
  });

  it("far center without production contact refuses (historical d=13.73 bug)", () => {
    const g = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: 13.73,
      nearestClimbId: "dawn-shaft",
    });
    assert.equal(g.ok, false);
    assert.match(g.reason, /not-touching/);
  });

  it("absurd center distance with contact still refuses as inconsistent telemetry", () => {
    const g = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: 25,
      nearestClimbId: "dawn-shaft",
      touchingClimbable: true,
    });
    assert.equal(g.ok, false);
    assert.match(g.reason, /too-far/);
  });

  it("wrong tower surface cannot take over dawn", () => {
    const g = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: 5.2,
      nearestClimbId: "mere-shaft",
      touchingClimbable: true,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(g.ok, false);
    assert.match(g.reason, /wrong-climb-target/);
  });

  it("citadel keep cannot take over dawn", () => {
    const g = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: 4,
      nearestClimbId: "citadel-keep",
      touchingClimbable: true,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(g.ok, false);
  });

  it("contact + dawn shaft allows handoff (not mantle-distance claim)", () => {
    // Center distance to a r=4.2 shaft can be ~5 when the body is on the wall.
    const g = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: 5.2,
      nearestClimbId: "dawn-shaft",
      touchingClimbable: true,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(g.ok, true);
  });

  it("missing touchingClimbable / dead / non-playing refuse", () => {
    assert.equal(canHandoffToClimb({ nearestClimbDistance: 5, nearestClimbId: "dawn-shaft" }).ok, false);
    assert.equal(
      canHandoffToClimb({ mode: "playing", alive: false, nearestClimbDistance: 5, nearestClimbId: "dawn-shaft", touchingClimbable: true }).ok,
      false,
    );
    assert.equal(
      canHandoffToClimb({ mode: "paused", alive: true, nearestClimbDistance: 5, nearestClimbId: "dawn-shaft", touchingClimbable: true }).ok,
      false,
    );
  });

  it("production probeClimbWall at dawn shaft reports climbable contact", () => {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    const tw = TOWERS.find((t) => t.id === "dawn")!;
    // Stand just outside the shaft — production contact band.
    sim.player.x = tw.x;
    sim.player.z = tw.z + TOWER_RADIUS + 0.55;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    // Face the tower (-Z from +Z side)
    sim.player.yaw = 0;
    const probe = sim.probeClimbWall();
    assert.ok(probe, "must hit a wall from the dawn shaft face");
    assert.equal(probe.climbable, true);
    assert.match(probe.id, /dawn/);
    const gate = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: probe.centerDistance,
      nearestClimbId: probe.id,
      touchingClimbable: probe.climbable,
      requiredClimbPrefix: "dawn",
    });
    assert.equal(gate.ok, true);
  });

  it("spawn far from dawn: probe has no climbable contact, gate refuses", () => {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    // spawn default
    const probe = sim.probeClimbWall();
    const gate = canHandoffToClimb({
      world: "overworld",
      mode: "playing",
      alive: true,
      nearestClimbDistance: probe?.centerDistance ?? null,
      nearestClimbId: probe?.id ?? null,
      touchingClimbable: Boolean(probe?.climbable),
      requiredClimbPrefix: "dawn",
    });
    assert.equal(gate.ok, false);
  });

  it("spy: runClimbExecutor never runs when handoff refuses or not arrived", async () => {
    let calls = 0;
    const runClimbExecutor = async () => {
      calls += 1;
      return { activated: false };
    };
    // Same gate shape as dawn-from-shrines.mjs
    const maybeClimb = async (handoff: { ok: boolean }, arrived: boolean) => {
      if (!handoff.ok || !arrived) return;
      await runClimbExecutor();
    };

    await maybeClimb(canHandoffToClimb({ touchingClimbable: false, nearestClimbId: "dawn-shaft" }), true);
    assert.equal(calls, 0, "no contact → 0 calls");

    await maybeClimb(
      canHandoffToClimb({
        touchingClimbable: true,
        nearestClimbId: "mere-shaft",
        requiredClimbPrefix: "dawn",
      }),
      true,
    );
    assert.equal(calls, 0, "wrong tower → 0 calls");

    await maybeClimb(
      canHandoffToClimb({
        touchingClimbable: true,
        nearestClimbId: "dawn-shaft",
        requiredClimbPrefix: "dawn",
      }),
      false,
    );
    assert.equal(calls, 0, "not arrived → 0 calls");

    await maybeClimb(
      canHandoffToClimb({
        world: "overworld",
        mode: "playing",
        alive: true,
        touchingClimbable: true,
        nearestClimbId: "dawn-shaft",
        requiredClimbPrefix: "dawn",
      }),
      true,
    );
    assert.equal(calls, 1, "contact+target+arrived → 1 call");
  });
});

describe("R21 climb facing gates", () => {
  it("canFaceEnemyBody uses angle not mere distance", () => {
    const behind = canFaceEnemyBody({ x: 0, z: 0, bodyYaw: 0 }, { x: 0, z: 2 });
    assert.equal(behind, false);
    const front = canFaceEnemyBody({ x: 0, z: 0, bodyYaw: 0 }, { x: 0, z: -2 });
    assert.equal(front, true);
  });
});
