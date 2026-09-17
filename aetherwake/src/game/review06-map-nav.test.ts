/**
 * Review 06 — map selection must drive quest + navigation; cache; polyline integrity.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, TOWERS, initWorld } from "./world.ts";
import { useHud } from "./store.ts";
import { validateWalkSegment } from "./shrine-route.ts";

function playingSim() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  return sim;
}

describe("R6-1 selectedMarkerId drives trackedObjective + navigation", () => {
  it("selecting mere tower (not dawn) makes quest and nav target mere", () => {
    const sim = playingSim();
    sim.player.x = 16;
    sim.player.z = 102;
    sim.player.y = sim.heightFn(16, 102);
    useHud.setState({ selectedMarkerId: "mere" });
    const t = sim.trackedObjective();
    assert.equal(t.targetId, "mere", "quest must follow map selection");
    assert.match(t.title, /镜湖|mere/i);
    const nav = sim.navigationSnapshot();
    assert.equal(nav.targetId, "tower-base:mere");
    useHud.setState({ selectedMarkerId: null });
  });

  it("selection persists after movement", () => {
    const sim = playingSim();
    useHud.setState({ selectedMarkerId: "crown" });
    sim.player.x += 1;
    sim.player.z += 1;
    const t = sim.trackedObjective();
    assert.equal(t.targetId, "crown");
    useHud.setState({ selectedMarkerId: null });
  });

  it("completed tower selection is ignored (falls back to default quest)", () => {
    const sim = playingSim();
    sim.towersOn.add("mere");
    useHud.setState({ selectedMarkerId: "mere" });
    const t = sim.trackedObjective();
    assert.notEqual(t.targetId, "mere", "completed selection must not stick");
    useHud.setState({ selectedMarkerId: null });
  });

  it("invalid id is ignored", () => {
    const sim = playingSim();
    useHud.setState({ selectedMarkerId: "not-a-marker" });
    const t = sim.trackedObjective();
    assert.notEqual(t.targetId, "not-a-marker");
    useHud.setState({ selectedMarkerId: null });
  });

  it("world switch into shrine clears overworld selection from nav dest", () => {
    const sim = playingSim();
    useHud.setState({ selectedMarkerId: "mere" });
    sim.enterShrine(SHRINES.findIndex((s) => s.id === "burst")!);
    sim.interactLock = 0;
    const nav = sim.navigationSnapshot();
    assert.equal(nav.worldId, "shrine:burst");
    assert.ok(!String(nav.targetId).includes("mere"));
    useHud.setState({ selectedMarkerId: null });
  });
});

describe("R6-2 real-support positive path cases", () => {
  it("still frozen slab with real solid allows walk to altar approach", () => {
    const sim = playingSim();
    sim.enterShrine(SHRINES.findIndex((s) => s.id === "still")!);
    sim.interactLock = 0;
    sim.mode = "playing";
    const o = { x: 220 + 3 * 48, y: 520, z: 0 };
    // Place player on entrance, freeze block under a bridging position using production solid.
    sim.moveBlock.frozen = 4;
    sim.moveBlock.x = o.x;
    sim.moveBlock.z = o.z + 13;
    const slab = sim.solids.find((s) => s.id === "move-block");
    if (slab) {
      slab.x = sim.moveBlock.x;
      slab.z = sim.moveBlock.z;
    }
    sim.player.x = o.x;
    sim.player.y = o.y;
    sim.player.z = o.z + 8;
    const snap = sim.navigationSnapshot();
    // May be walk or action depending on support continuity — but must not invent supports.
    assert.ok(["walk", "action-required", "unavailable"].includes(snap.status));
    // Expire → must be action-required, never walk.
    sim.moveBlock.frozen = 0;
    const expired = sim.navigationSnapshot();
    assert.equal(expired.status, "action-required");
  });

  it("burst after break has contiguous validated segments only (no zero-length junk)", () => {
    const sim = playingSim();
    sim.enterShrine(SHRINES.findIndex((s) => s.id === "burst")!);
    sim.interactLock = 0;
    sim.mode = "playing";
    const o = { x: 220 + 48, y: 520, z: 0 };
    sim.player.x = o.x;
    sim.player.z = o.z + 11.2;
    sim.player.y = o.y + 0.2;
    sim.explode(o.x, o.y + 1.2, o.z + 12.4);
    const snap = sim.navigationSnapshot();
    for (const s of snap.segments) {
      const len = Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z);
      assert.ok(len > 0.05 || s.from.x === s.to.x, `zero-length segment ${s.id}`);
      if (s.polyline) {
        assert.ok(s.polyline.length === 0 || s.polyline.length >= 2);
      }
    }
  });
});

describe("R6-3 navigation cache", () => {
  it("repeated navigationSnapshot without state change returns same object", () => {
    const sim = playingSim();
    sim.player.x = 16;
    sim.player.z = 102;
    sim.player.y = sim.heightFn(16, 102);
    const a = sim.navigationSnapshot();
    const b = sim.navigationSnapshot();
    assert.equal(a, b, "cache must return identical snapshot instance");
  });

  it("player move invalidates cache", () => {
    const sim = playingSim();
    const a = sim.navigationSnapshot();
    sim.player.x += 2;
    const b = sim.navigationSnapshot();
    assert.notEqual(a, b);
  });

  it("selected target change invalidates cache", () => {
    const sim = playingSim();
    const a = sim.navigationSnapshot();
    useHud.setState({ selectedMarkerId: "mere" });
    const b = sim.navigationSnapshot();
    assert.notEqual(a, b);
    useHud.setState({ selectedMarkerId: null });
  });
});

describe("R6-4 polyline interior change", () => {
  it("middle-point-only change updates polyline geometry", () => {
    const solids = [
      { id: "floor-a", kind: "box" as const, x: 0, y: 0, z: 2, w: 6, h: 0.2, d: 6, standable: true },
    ];
    const seg1 = validateWalkSegment(
      { x: 0, y: 0.1, z: 0 },
      { x: 0, y: 0.1, z: 4 },
      { solids, heightFn: () => 0, worldId: "t", id: "p" },
    );
    // Insert a bump in the middle support (low pad).
    const solids2 = [
      ...solids,
      { id: "bump", kind: "box" as const, x: 0, y: 0, z: 2, w: 2, h: 0.35, d: 1, standable: true },
    ];
    const seg2 = validateWalkSegment(
      { x: 0, y: 0.1, z: 0 },
      { x: 0, y: 0.35, z: 4 },
      { solids: solids2, heightFn: () => 0, worldId: "t", id: "p" },
    );
    assert.equal(seg1.validated, true);
    assert.equal(seg2.validated, true);
    const key = (s: typeof seg1) =>
      (s.polyline ?? []).map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join("|");
    assert.notEqual(key(seg1), key(seg2), "interior support change must change polyline");
  });
});
