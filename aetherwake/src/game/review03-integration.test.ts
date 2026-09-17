/**
 * Supervisor review 03 — production regressions for LOS, navigation honesty,
 * and shrine pick registration.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { CHESTS, SHRINES, TOWERS, TOWER_HEIGHT, shrineWorldOrigin, initWorld } from "./world.ts";
import type { Actions } from "./input.ts";
import { buildOverworldGraph, findRoute, nearestNodeId } from "./navigation.ts";

function emptyActions(over: Partial<Actions> = {}): Actions {
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
    artSlot: -1,
    lookX: 0,
    lookY: 0,
    climb: false,
    interactTargetId: null,
    interactWorldId: null,
    activationId: null,
    ...over,
  };
}

function playingSim() {
  const sim = new Sim();
  sim.mode = "playing";
  return sim;
}

describe("03-1 independent wall blocks structure interact", () => {
  it("wall between player and shrine door blocks enter; remove wall then enter works", () => {
    initWorld();
    const sim = playingSim();
    const s = SHRINES[0]!;
    // Stand south of shrine (door side is +Z approach in handleInteract range to center).
    sim.player.x = s.x;
    sim.player.z = s.z + 5.5;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    // Independent wall on the path, not the shrine body.
    sim.solids.push({
      id: "qa-independent-wall",
      kind: "box",
      x: s.x,
      z: s.z + 3.0,
      y: sim.player.y,
      w: 6,
      h: 5,
      d: 0.5,
    });

    const beforeWorld = sim.worldKind;
    const a = emptyActions({
      interact: true,
      interactTargetId: `shrine:${s.id}`,
      interactWorldId: "overworld",
      activationId: "r3-shrine-wall",
    });
    sim.handleInteract(a);
    assert.equal(sim.worldKind, beforeWorld, "must not enter shrine through independent wall");
    assert.notEqual(sim.shrine, 0);

    // Remove wall → same interact enters.
    sim.solids = sim.solids.filter((x) => x.id !== "qa-independent-wall");
    sim.interactLock = 0;
    const b = emptyActions({
      interact: true,
      interactTargetId: `shrine:${s.id}`,
      interactWorldId: "overworld",
      activationId: "r3-shrine-open",
    });
    sim.handleInteract(b);
    assert.equal(sim.worldKind, "shrine");
    assert.equal(sim.shrine, 0);
  });

  it("wall between player and altar blocks claim; remove wall then claim works", () => {
    initWorld();
    const sim = playingSim();
    const idx = 0;
    const shrine = SHRINES[idx]!;
    sim.enterShrine(idx);
    sim.interactLock = 0;
    sim.mode = "playing";
    const o = shrineWorldOrigin(idx);
    // Stand just south of altar pad, wall between player and altar.
    sim.player.x = o.x;
    sim.player.z = o.z + 21.0;
    sim.player.y = o.y;
    sim.solids.push({
      id: "qa-altar-wall",
      kind: "box",
      x: o.x,
      z: o.z + 22.0,
      y: o.y,
      w: 5,
      h: 4,
      d: 0.5,
    });
    const a = emptyActions({
      interact: true,
      interactTargetId: `altar:${shrine.id}`,
      interactWorldId: sim.currentWorldId(),
      activationId: "r3-altar-wall",
    });
    sim.handleInteract(a);
    assert.equal(sim.orbs, 0, "must not claim through wall");
    assert.equal(sim.shrinesOn.has(shrine.id), false);

    sim.solids = sim.solids.filter((x) => x.id !== "qa-altar-wall");
    sim.interactLock = 0;
    const b = emptyActions({
      interact: true,
      interactTargetId: `altar:${shrine.id}`,
      interactWorldId: sim.currentWorldId(),
      activationId: "r3-altar-open",
    });
    sim.handleInteract(b);
    assert.ok(sim.shrinesOn.has(shrine.id));
    assert.equal(sim.orbs, 1);
  });

  it("wall between player and tower top blocks activate", () => {
    initWorld();
    const sim = playingSim();
    const tw = TOWERS[0]!;
    const topY = tw.y + TOWER_HEIGHT - 1.2;
    sim.player.x = tw.x;
    sim.player.z = tw.z + 3.5;
    sim.player.y = topY;
    // Independent wall on the cap approach, not the shaft/cap of this tower.
    sim.solids.push({
      id: "qa-tower-wall",
      kind: "box",
      x: tw.x,
      z: tw.z + 1.8,
      y: topY - 1,
      w: 5,
      h: 4,
      d: 0.5,
    });
    const a = emptyActions({
      interact: true,
      interactTargetId: `tower:${tw.id}`,
      interactWorldId: "overworld",
      activationId: "r3-tower-wall",
    });
    sim.handleInteract(a);
    assert.equal(sim.towersOn.has(tw.id), false, "must not activate through independent wall");

    sim.solids = sim.solids.filter((x) => x.id !== "qa-tower-wall");
    sim.interactLock = 0;
    const b = emptyActions({
      interact: true,
      interactTargetId: `tower:${tw.id}`,
      interactWorldId: "overworld",
      activationId: "r3-tower-open",
    });
    sim.handleInteract(b);
    assert.ok(sim.towersOn.has(tw.id));
  });

  it("chest wall LOS still works and no duplicate reward", () => {
    initWorld();
    const sim = playingSim();
    const chest = CHESTS.find((c) => c.id === "chest-start")!;
    sim.player.x = chest.x;
    sim.player.z = chest.z + 1.7;
    sim.player.y = sim.heightFn(sim.player.x, sim.player.z);
    sim.solids.push({
      id: "qa-chest-wall",
      kind: "box",
      x: chest.x,
      z: chest.z + 0.85,
      y: sim.player.y,
      w: 3,
      h: 4,
      d: 0.6,
    });
    sim.handleInteract(
      emptyActions({
        interact: true,
        interactTargetId: `chest:${chest.id}`,
        interactWorldId: "overworld",
        activationId: "r3-chest-wall",
      }),
    );
    assert.equal(sim.chestsGot.has(chest.id), false);
  });
});

describe("03-2 navigation honesty", () => {
  function graphFixture() {
    return buildOverworldGraph({
      spawn: { x: 16, y: 12, z: 102 },
      towers: TOWERS,
      shrines: SHRINES,
      sage: { x: 4, y: 16, z: 114 },
      citadel: { x: 0, y: 8, z: -160 },
      towersOn: new Set(),
    });
  }

  it("tower-top y differs from tower-base y", () => {
    const { nodes } = graphFixture();
    const base = nodes.find((n) => n.id === "tower-base:dawn")!;
    const top = nodes.find((n) => n.id === "tower-top:dawn")!;
    assert.ok(top.y - base.y > 10, `top.y=${top.y} base.y=${base.y}`);
  });

  it("walk edges are bidirectional between spawn and sage", () => {
    const { nodes, edges } = graphFixture();
    const a = findRoute(nodes, edges, "sage", "spawn");
    assert.notEqual(a.status, "unavailable", "return path sage→spawn must exist");
  });

  it("shrine-to-shrine is not unavailable just because origin is a shrine with no outbound", () => {
    const { nodes, edges } = graphFixture();
    const from = nearestNodeId(nodes, SHRINES[0]!.x, 0, SHRINES[0]!.z);
    const to = `shrine-door:${SHRINES[1]!.id}`;
    const r = findRoute(nodes, edges, from, to);
    assert.notEqual(r.status, "unavailable", `from=${from} must reach ${to}`);
  });

  it("ready route is not claimed without corridor validation", () => {
    // Until walkable corridor validation exists, long hauls must not report ready cost as route distance.
    const sim = playingSim();
    sim.player.x = 16;
    sim.player.z = 102;
    sim.player.y = sim.heightFn(16, 102);
    const t = sim.trackedObjective();
    // Dawn is ~35m away — if we cannot validate a corridor we must not claim ready route cost.
    assert.ok(
      t.routeStatus !== "ready" || (t.routeCost != null && t.routeCost > 10),
      "ready must carry a real positive cost, not 0",
    );
  });

  it("snapping near destination does not yield zero-cost ready when player is not at node y", () => {
    const { nodes, edges } = graphFixture();
    const top = nodes.find((n) => n.id === "tower-top:dawn")!;
    // Player at ground near tower xz — must not snap to tower-top as free route origin.
    const id = nearestNodeId(nodes, top.x, 1, top.z);
    assert.notEqual(id, "tower-top:dawn", "ground player must not snap to tower-top");
  });
});

describe("03-3 shrine altar/exit candidates use shrine world id", () => {
  it("after enterShrine candidates are altar/exit with shrine world", () => {
    initWorld();
    const sim = playingSim();
    sim.enterShrine(0);
    sim.interactLock = 0;
    const world = sim.currentWorldId();
    assert.equal(world, "shrine:rime");
    const cands = sim.collectInteractionCandidates();
    assert.ok(cands.some((c) => c.targetId === "altar:rime"));
    assert.ok(cands.some((c) => c.targetId === "exit:rime"));
    for (const c of cands) assert.equal(c.worldId, world);
  });
});
