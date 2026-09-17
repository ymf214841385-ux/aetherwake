/**
 * R37: mid-sidewalk remaining route must not backtrack to entry corner.
 * Real production Sim.enterShrine(2) geometry, metals=[].
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, shrineWorldOrigin, initWorld } from "./world.ts";
import { buildPullShrineRoute } from "./shrine-route-dynamic.ts";

function pullSim() {
  initWorld();
  const sim = new Sim();
  sim.mode = "playing";
  const idx = SHRINES.findIndex((s) => s.id === "pull")!;
  sim.enterShrine(idx);
  sim.interactLock = 0;
  sim.mode = "playing";
  sim.metals = [];
  return { sim, o: shrineWorldOrigin(idx), idx };
}

function routeAt(sim: Sim, idx: number, player: { x: number; y: number; z: number }) {
  return buildPullShrineRoute({
    shrineIndex: idx,
    player,
    metals: sim.metals.map((m) => ({ id: m.id, x: m.x, y: m.y, z: m.z, held: m.held })),
    solids: sim.solids,
    heightFn: sim.heightFn,
    extraSupports: sim.extraSupports(),
  });
}

function assertNoBacktrackToEntry(snap: ReturnType<typeof routeAt>, o: { x: number; z: number }, hereZ: number) {
  assert.equal(snap.status, "walk", `expected walk got ${snap.status} ${snap.reason}`);
  assert.ok(snap.segments.length > 0);
  for (const s of snap.segments) {
    assert.equal(s.validated, true, `unvalidated ${s.id} ${s.blockedReason}`);
    // Every polyline sample must not go backward to the entry corner z≈6.5
    // when the player is already past it on the sidewalk.
    for (const p of s.polyline ?? []) {
      assert.ok(
        p.z >= hereZ - 0.8,
        `polyline doubles back z=${p.z} < hereZ=${hereZ} (entry corner 6.5) seg=${s.id}`,
      );
    }
    // First emitted target (end of first segment) must be ahead of the player.
  }
  const first = snap.segments[0]!;
  assert.ok(
    first.to.z > hereZ - 0.5,
    `first target z=${first.to.z} must be ahead of hereZ=${hereZ} (not entry 6.5)`,
  );
}

describe("R37 mid-sidewalk remaining route (no entry backtrack)", () => {
  for (const zOff of [10, 12, 16]) {
    it(`sidewalk z=o.z+${zOff}: first target ahead, no return to z=6.5`, () => {
      const { sim, o, idx } = pullSim();
      const here = { x: o.x + 7.15, y: o.y, z: o.z + zOff };
      const snap = routeAt(sim, idx, here);
      assertNoBacktrackToEntry(snap, o, here.z);
      // Must not aim at sidewalk entry 6.5
      const firstTo = snap.segments[0]!.to;
      assert.notEqual(Math.abs(firstTo.z - (o.z + 6.5)) < 0.6 && Math.abs(firstTo.x - (o.x + 7.15)) < 0.6, true,
        `first target is entry corner ${JSON.stringify(firstTo)}`);
    });
  }

  it("far shore (z>o.z+17) routes directly to altar", () => {
    const { sim, o, idx } = pullSim();
    const here = { x: o.x + 7.15, y: o.y, z: o.z + 18 };
    const snap = routeAt(sim, idx, here);
    assert.equal(snap.status, "walk", snap.reason);
    const first = snap.segments[0]!.to;
    assert.ok(first.z > o.z + 17, `far shore first target z=${first.z} should not go back to rim entry`);
    assert.ok(Math.abs(first.x - o.x) < 3, `far shore should head toward altar x=${first.x}`);
  });

  it("entry floor still uses safe corner approach (not a pit diagonal)", () => {
    const { sim, o, idx } = pullSim();
    const here = { x: o.x, y: o.y, z: o.z + 4.4 };
    const snap = routeAt(sim, idx, here);
    // May be walk if complete; if so first hop should reach the +X rim, not cut the pit.
    if (snap.status === "walk") {
      const first = snap.segments[0]!;
      assert.equal(first.validated, true);
      assert.ok(first.to.x > o.x + 4 || first.to.z > o.z + 6, "first hop should approach sidewalk corner");
    } else {
      assert.match(snap.nextAction + snap.guidance, /侧廊/);
    }
  });
});
