/**
 * R22 C05: real overworld burst door + pull sidewalk non-empty walk.
 * Shrine-interior crack tests are NOT an entrance proof.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, shrineWorldOrigin, initWorld, TOWERS, SAGE, CITADEL_POI } from "./world.ts";
import { validateWalkSegment, buildOverworldDetourRoute } from "./shrine-route.ts";
import { buildOverworldGraph } from "./navigation.ts";
import { supportY, solidTop } from "./physics.ts";
import { FOOT_SNAP } from "./params.ts";

function enterShrineById(id: string) {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  const idx = SHRINES.findIndex((s) => s.id === id)!;
  sim.enterShrine(idx);
  sim.interactLock = 0;
  sim.mode = "playing";
  return { sim, o: shrineWorldOrigin(idx), idx };
}

function overworldSim() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  return sim;
}

describe("R22 overworld burst door (not shrine interior)", () => {
  it("door node y is real apron pad top, not hf+0.28", () => {
    const sim = overworldSim();
    const s = SHRINES.find((x) => x.id === "burst")!;
    const apron = sim.solids.find((q) => q.id === "burst-apron")!;
    assert.ok(apron, "burst-apron solid must exist in overworld");
    const apronTop = solidTop(apron);
    const graph = buildOverworldGraph({
      spawn: sim.spawn,
      towers: TOWERS,
      shrines: SHRINES,
      sage: SAGE,
      citadel: CITADEL_POI,
      towersOn: sim.towersOn,
      heightFn: sim.heightFn,
    });
    const door = graph.nodes.find((n) => n.id === "shrine-door:burst")!;
    assert.ok(door, "shrine-door:burst node required");
    assert.ok(
      Math.abs(door.y - apronTop) < 1e-3,
      `door.y=${door.y} must equal apron top ${apronTop} (not hf+0.28=${sim.heightFn(s.x, s.z + 2.8) + 0.28})`,
    );
  });

  it("south corr-b10→door walks onto apron within production snap rise", () => {
    const sim = overworldSim();
    const s = SHRINES.find((x) => x.id === "burst")!;
    const apronTop = solidTop(sim.solids.find((q) => q.id === "burst-apron")!);
    const from = { x: 118, y: sim.heightFn(118, 31), z: 31 };
    const door = { x: s.x, y: apronTop, z: s.z + 2.8 };
    const seg = validateWalkSegment(from, door, {
      solids: sim.solids,
      heightFn: sim.heightFn,
      extraSupports: sim.extraSupports(),
      worldId: "overworld",
      id: "corr-b10-door",
    });
    assert.equal(seg.validated, true, seg.blockedReason);
    assert.ok(Math.abs(seg.to.y - apronTop) < 0.05, `endY=${seg.to.y} ≈ apron ${apronTop}`);
  });

  it("records first failing edge when a bad south chord hits the apron rim", () => {
    // Document the historical failure: low outer terrain → apron snap.
    // With production MAX_RISE (2*FOOT_SNAP) this chord is now legal; assert that.
    const sim = overworldSim();
    const from = { x: 118, y: sim.heightFn(118, 34), z: 34 };
    const to = { x: 118, y: sim.heightFn(118, 33), z: 33 };
    const seg = validateWalkSegment(from, to, {
      solids: sim.solids,
      heightFn: sim.heightFn,
      extraSupports: sim.extraSupports(),
      worldId: "overworld",
      id: "corr-b8-b9",
    });
    // Production snapVertical allows ~0.74 onto the apron pad.
    assert.equal(seg.validated, true, `b8→b9 must match production snap: ${seg.blockedReason}`);
    const support = supportY(118, 33.3, sim.heightFn(118, 34) + FOOT_SNAP, sim.solids, sim.heightFn, [], null);
    assert.equal(support.id, "burst-apron");
    assert.ok(support.y - sim.heightFn(118, 34) <= FOOT_SNAP * 2 + 1e-6);
  });

  it("spawn→burst door detour is walk with validated segments (production navigationSnapshot path)", () => {
    const sim = overworldSim();
    const s = SHRINES.find((x) => x.id === "burst")!;
    const apronTop = solidTop(sim.solids.find((q) => q.id === "burst-apron")!);
    const graph = buildOverworldGraph({
      spawn: sim.spawn,
      towers: TOWERS,
      shrines: SHRINES,
      sage: SAGE,
      citadel: CITADEL_POI,
      towersOn: sim.towersOn,
      heightFn: sim.heightFn,
    });
    const waypoints = graph.nodes
      .filter((n) => n.kind !== "tower-top" && n.kind !== "citadel")
      .map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z }));
    const snap = buildOverworldDetourRoute({
      player: { x: sim.spawn.x, y: sim.spawn.y, z: sim.spawn.z },
      dest: { x: s.x, y: apronTop, z: s.z + 2.8, targetId: `shrine-door:burst`, label: s.name },
      waypoints,
      solids: sim.solids,
      heightFn: sim.heightFn,
      extraSupports: sim.extraSupports(),
      nextAction: "前往爆鸣祠",
      guidanceOk: "沿地面前往祠门前",
      guidanceBlocked: "尚未找到可通行路线，可绕开障碍再试",
    });
    assert.equal(snap.status, "walk", `status=${snap.status} reason=${snap.reason} guidance=${snap.guidance}`);
    const walks = snap.segments.filter((sg) => sg.validated && sg.kind === "walk");
    assert.ok(walks.length > 0, "spawn→burst door must produce non-empty validated walk");
    assert.equal(snap.targetId, "shrine-door:burst");
  });

  it("map-selected burst overworld navigationSnapshot is walk to the door", () => {
    const sim = overworldSim();
    sim.preferredMapTarget = () => "burst";
    const t = sim.trackedObjective();
    assert.equal(t.targetId, "burst");
    const snap = sim.navigationSnapshot();
    assert.equal(snap.status, "walk", `status=${snap.status} reason=${snap.reason} ${snap.guidance}`);
    assert.equal(snap.targetId, "shrine-door:burst");
    const walks = snap.segments.filter((sg) => sg.validated);
    assert.ok(walks.length > 0, "non-empty remaining walk");
  });
});

describe("R22 C05 pull sidewalk is a real walk", () => {
  it("sidewalk mid: guidance only claims 侧廊 when non-empty walk reaches altar", () => {
    const { sim, o } = enterShrineById("pull");
    sim.player.x = o.x + 7.15;
    sim.player.z = o.z + 10;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    assert.match(snap.guidance + snap.nextAction, /侧廊/);
    // Must not be a vacuous "侧廊可通行" with zero segments.
    const walks = snap.segments.filter((s) => s.validated && s.kind === "walk");
    assert.ok(walks.length > 0, `sidewalk mid needs non-empty walk status=${snap.status} segs=${snap.segments.length}`);
    // Contiguous chain must progress toward the altar (+Z), not retreat to entry.
    const last = walks[walks.length - 1]!;
    assert.ok(last.to.z >= o.z + 16, `route must reach far shore, last z=${last.to.z}`);
  });

  it("sidewalk far / far shore: complete walk to altar approach", () => {
    const { sim, o } = enterShrineById("pull");
    for (const pose of [
      { x: o.x + 7.15, z: o.z + 17.5 },
      { x: o.x + 2, z: o.z + 18 },
      { x: o.x, z: o.z + 18 },
    ]) {
      sim.player.x = pose.x;
      sim.player.z = pose.z;
      sim.player.y = o.y;
      // bust nav cache
      sim.player.x += 0.001;
      const snap = sim.navigationSnapshot();
      const walks = snap.segments.filter((s) => s.validated && s.kind === "walk");
      assert.ok(walks.length > 0, `pose ${pose.x},${pose.z} status=${snap.status}`);
      assert.equal(snap.status, "walk", `pose ${pose.x},${pose.z} ${snap.reason}`);
      const last = walks[walks.length - 1]!;
      assert.ok(last.to.z > o.z + 18, `must reach altar approach last.z=${last.to.z}`);
    }
  });

  it("pull near entry unbridged: sidewalk walk or toward action — never empty fake walk", () => {
    const { sim, o } = enterShrineById("pull");
    sim.player.x = o.x;
    sim.player.z = o.z + 5;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    // R35: complete validated sidewalk may be walk from near-entry.
    assert.ok(snap.status === "walk" || snap.status === "action-required", `status=${snap.status}`);
    assert.match(snap.nextAction + snap.guidance, /牵引|侧廊|祭坛/);
    if (snap.status === "walk") {
      assert.ok(snap.segments.length > 0 && snap.segments.every((s) => s.validated));
    }
  });
});

describe("R21/R22 burst interior remaining (still valid, not an entrance proof)", () => {
  it("burst near door after wall broken: remaining walk not back to entry z=4.4", () => {
    const { sim, o } = enterShrineById("burst");
    sim.crackedBroken[sim.shrine!] = true;
    sim.solids = sim.solids.filter((s) => s.id !== "crack");
    sim.player.x = o.x;
    sim.player.z = o.z + 13;
    sim.player.y = o.y;
    const snap = sim.navigationSnapshot();
    const walks = snap.segments.filter((s) => s.validated && s.kind === "walk");
    assert.ok(walks.length > 0, `past-wall burst needs non-empty remaining walk status=${snap.status} ${snap.guidance}`);
    assert.ok(walks[0]!.to.z > o.z + 12 || walks[0]!.to.z > walks[0]!.from.z, "must not route back through entry");
  });
});
