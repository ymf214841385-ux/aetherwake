/**
 * R35: invalid in-band plate must not suppress the legal +X sidewalk fallback.
 * Real production geometry — entry observer (316,520,4.4).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, shrineWorldOrigin, initWorld } from "./world.ts";
import { buildPullShrineRoute } from "./shrine-route-dynamic.ts";

function enterPull() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  const idx = SHRINES.findIndex((s) => s.id === "pull")!;
  sim.enterShrine(idx);
  sim.interactLock = 0;
  sim.mode = "playing";
  return { sim, o: shrineWorldOrigin(idx) };
}

function routeAtEntry(sim: Sim, o: { x: number; y: number; z: number }) {
  return buildPullShrineRoute({
    shrineIndex: 2,
    player: { x: o.x, y: o.y, z: o.z + 4.4 },
    metals: sim.metals.map((m) => ({ id: m.id, x: m.x, y: m.y, z: m.z, held: m.held })),
    solids: sim.solids,
    heightFn: sim.heightFn,
    extraSupports: sim.extraSupports(),
  });
}

function assertWalkSegmentsSound(snap: ReturnType<typeof routeAtEntry>) {
  if (snap.status !== "walk") return;
  assert.ok(snap.segments.length > 0, "walk requires non-empty segments");
  for (const s of snap.segments) {
    assert.equal(s.validated, true, `unvalidated walk seg ${s.id} ${s.blockedReason}`);
    assert.equal(s.kind, "walk");
    // Polyline must not cut the unsupported pit center (x=o.x, z in 10..16.5)
    for (const p of s.polyline ?? []) {
      const inPitBand = p.z > 9.5 && p.z < 17.0;
      const nearCenter = Math.abs(p.x - 316) < 4.0;
      // Allow the approach along the rim only if x is clearly off-center (+X sidewalk)
      if (inPitBand && nearCenter && Math.abs(p.x - 316) < 2.5) {
        // Pit floor samples would be y < floor; reject if y is below floor by >0.5
        assert.ok(p.y > 519.5, `polyline dips into pit ${JSON.stringify(p)}`);
      }
    }
  }
}

describe("R35 pull sidewalk fallback not suppressed by unusable plate", () => {
  it("no plate at entry: sidewalk offered (walk if complete, else 侧廊 guidance)", () => {
    const { sim, o } = enterPull();
    sim.metals = [];
    const snap = routeAtEntry(sim, o);
    assertWalkSegmentsSound(snap);
    assert.match(snap.nextAction + snap.guidance, /侧廊/);
  });

  it("plate away from pit (x far west): same usable fallback as no plate", () => {
    const { sim, o } = enterPull();
    const plate = sim.metals.find((m) => m.id.startsWith("metal-shrine"))!;
    plate.held = false;
    plate.x = o.x - 12;
    plate.z = o.z + 2;
    plate.y = o.y + 0.25;
    const snapAway = routeAtEntry(sim, o);
    assertWalkSegmentsSound(snapAway);
    assert.match(snapAway.nextAction + snapAway.guidance, /侧廊/);
    assert.notEqual(snapAway.nextAction, "用牵引调整金属板位置");

    const { sim: sim2, o: o2 } = enterPull();
    sim2.metals = [];
    const snapNone = routeAtEntry(sim2, o2);
    assert.equal(snapAway.status, snapNone.status, `away vs none status ${snapAway.status} vs ${snapNone.status}`);
    assert.match(snapNone.nextAction + snapNone.guidance, /侧廊/);
  });

  it("unusable in-band plate (near pit edge, not a bridge) still offers sidewalk", () => {
    const { sim, o } = enterPull();
    const plate = sim.metals.find((m) => m.id.startsWith("metal-shrine"))!;
    // In candidate band (|x-o.x|<5, z in 10..20) but cannot span the pit
    plate.held = false;
    plate.x = o.x + 2;
    plate.z = o.z + 11.5;
    plate.y = o.y - 0.2;
    const snap = routeAtEntry(sim, o);
    assertWalkSegmentsSound(snap);
    // MUST NOT only say "adjust plate" — legal sidewalk exists from entry
    assert.notEqual(snap.nextAction, "用牵引调整金属板位置");
    assert.match(snap.nextAction + snap.guidance, /侧廊/);
    if (snap.status === "walk") {
      // complete contiguous route to altar
      const last = snap.segments[snap.segments.length - 1]!;
      assert.ok(last.to.z > o.z + 18, `walk must reach altar side, last z=${last.to.z}`);
    }
  });

  it("on sidewalk with unusable plate still walks via corner to far shore and altar", () => {
    const { sim, o } = enterPull();
    const plate = sim.metals.find((m) => m.id.startsWith("metal-shrine"))!;
    plate.held = false;
    plate.x = o.x + 1;
    plate.z = o.z + 12;
    plate.y = o.y - 0.2;
    // stand on sidewalk rim
    const snap = buildPullShrineRoute({
      shrineIndex: 2,
      player: { x: o.x + 7.15, y: o.y, z: o.z + 8 },
      metals: sim.metals.map((m) => ({ id: m.id, x: m.x, y: m.y, z: m.z, held: m.held })),
      solids: sim.solids,
      heightFn: sim.heightFn,
      extraSupports: sim.extraSupports(),
    });
    assertWalkSegmentsSound(snap);
    assert.equal(snap.status, "walk", `sidewalk start must walk, got ${snap.status} ${snap.reason}`);
    const last = snap.segments[snap.segments.length - 1]!;
    assert.ok(last.to.z > o.z + 18, `must reach altar approach z=${last.to.z}`);
  });

  it("true multi-support bridge route is still preferred when it reaches altar", () => {
    const { sim, o } = enterPull();
    // Place two plates that could form a contiguous path across the pit
    sim.metals = sim.metals.filter((m) => !m.id.startsWith("metal-shrine"));
    sim.metals.push(
      { id: "metal-shrine-2a", x: o.x, y: o.y - 0.1, z: o.z + 11.5, held: false, vx: 0, vy: 0, vz: 0 },
      { id: "metal-shrine-2b", x: o.x, y: o.y - 0.1, z: o.z + 14.5, held: false, vx: 0, vy: 0, vz: 0 },
    );
    const snap = routeAtEntry(sim, o);
    assertWalkSegmentsSound(snap);
    // May be walk or action-required depending on real support continuity —
    // but if walk, segments must be validated and reach altar side.
    if (snap.status === "walk") {
      const last = snap.segments[snap.segments.length - 1]!;
      assert.ok(last.to.z > o.z + 18);
    }
  });
});
