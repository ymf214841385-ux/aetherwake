/**
 * Review 05 — walk validation must match production physics, contiguous paths only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { SHRINES, initWorld } from "./world.ts";
import { validateWalkSegment } from "./shrine-route.ts";
import { STEP_UP } from "./params.ts";

const flatH = () => 0;

describe("R5-1 validateWalkSegment capsule clearance", () => {
  it("rejects walking through a 3m standable box (side collision)", () => {
    const seg = validateWalkSegment(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 4 },
      {
        solids: [{ id: "tall-standable-box", kind: "box", x: 0, y: 0, z: 2, w: 2, h: 3, d: 1, standable: true }],
        heightFn: flatH,
        worldId: "overworld",
        id: "t1",
      },
    );
    assert.equal(seg.validated, false, `must not walk through tall standable box, got ${JSON.stringify(seg)}`);
  });

  it("allows walking over a low standable pad (step-up)", () => {
    const seg = validateWalkSegment(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0.3, z: 4 },
      {
        solids: [{ id: "pad", kind: "box", x: 0, y: 0, z: 2, w: 2, h: 0.3, d: 1, standable: true }],
        heightFn: flatH,
        worldId: "overworld",
        id: "t2",
      },
    );
    assert.equal(seg.validated, true, seg.blockedReason);
  });

  it("rejects a thin wall", () => {
    const seg = validateWalkSegment(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 4 },
      {
        solids: [{ id: "thin", kind: "box", x: 0, y: 0, z: 2, w: 3, h: 2, d: 0.2, standable: false }],
        heightFn: flatH,
        worldId: "overworld",
        id: "t3",
      },
    );
    assert.equal(seg.validated, false);
  });

  it("rejects large uphill step beyond STEP_UP", () => {
    const seg = validateWalkSegment(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1.2, z: 3 },
      {
        solids: [{ id: "cliff", kind: "box", x: 0, y: 0, z: 2, w: 4, h: 1.2, d: 2, standable: true }],
        heightFn: flatH,
        worldId: "overworld",
        id: "t4",
      },
    );
    assert.equal(seg.validated, false, `uphill ${STEP_UP} limit, got ${seg.blockedReason}`);
  });
});

describe("R5-2 contiguous path only", () => {
  function enterBurst() {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    const idx = SHRINES.findIndex((s) => s.id === "burst")!;
    sim.enterShrine(idx);
    sim.interactLock = 0;
    sim.mode = "playing";
    return sim;
  }

  it("blocked middle connector cannot be rescued by a clear final altar segment", () => {
    const sim = enterBurst();
    // Break wall so altar-side is open, then insert an independent blocker mid-room.
    sim.player.x = 220 + 48;
    sim.player.z = 11.2;
    sim.player.y = 520.2;
    sim.explode(220 + 48, 521.2, 12.4);
    assert.equal(sim.crackedBroken[sim.shrine!], true);
    // Block passage after the old wall.
    sim.solids.push({
      id: "qa-mid-block",
      kind: "box",
      x: 220 + 48,
      y: 520,
      z: 16,
      w: 18,
      h: 4,
      d: 0.6,
      standable: false,
    });
    const snap = sim.navigationSnapshot();
    assert.notEqual(snap.status, "walk", "disconnected suffix must not mark walk");
    const validated = snap.segments.filter((s) => s.validated);
    // No floating suffix past the blocker.
    for (const s of validated) {
      assert.ok(s.to.z < 15.5 || s.from.z < 15.5, `suffix beyond blocker ${s.id} to.z=${s.to.z}`);
    }
  });

  it("player already past entrance does not force walk back through entry only", () => {
    const sim = enterBurst();
    sim.player.x = 220 + 48;
    sim.player.z = 13.5; // past entrance 4.4 and past wall 12.4? wall intact — still south of wall
    sim.player.y = 520;
    const snap = sim.navigationSnapshot();
    // First segment should start near player, not teleport to entrance as origin-only path.
    const first = snap.segments.find((s) => s.validated) ?? snap.segments[0];
    if (first) {
      assert.ok(
        Math.hypot(first.from.x - sim.player.x, first.from.z - sim.player.z) < 2.5,
        `route rooted at player, from=${first.from.x},${first.from.z}`,
      );
    }
  });
});

describe("R5-3 dynamic supports come from Sim.extraSupports only", () => {
  function enter(id: string) {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    sim.enterShrine(SHRINES.findIndex((s) => s.id === id)!);
    sim.interactLock = 0;
    sim.mode = "playing";
    return sim;
  }

  it("rime snapshot does not invent ice supports; expired ice is not walkable", () => {
    const sim = enter("rime");
    // No ice → action required
    assert.equal(sim.navigationSnapshot().status, "action-required");
    // Expired ice in list must not create walk
    sim.ices.push({ x: 220, y: 520, z: 12, life: 0.05, vx: 0, vy: 0, vz: 0 } as never);
    const snap = sim.navigationSnapshot();
    assert.equal(snap.status, "action-required", "expired ice must not enable walk");
  });

  it("pull held metal is not a support (sidewalk walk may still exist)", () => {
    const sim = enter("pull");
    sim.metals.push({ id: "metal-shrine-pull", x: 220 + 36 * 0 + 268, y: 520, z: 14, held: true, vx: 0, vz: 0 } as never);
    // Fix coordinates relative to origin 268 for pull index 2
    const o = { x: 220 + 2 * 48, z: 0 };
    sim.metals[0]!.x = o.x;
    sim.metals[0]!.z = o.z + 14;
    assert.ok(
      !sim.extraSupports().some((e) => e.id === "metal-shrine-pull"),
      "held plate must leave extraSupports",
    );
    const snap = sim.navigationSnapshot();
    // R35: legal sidewalk may be walk; held plate itself must never be a support id in segments.
    if (snap.status === "walk") {
      assert.ok(snap.segments.every((s) => s.validated));
      const viaHeld = snap.segments.some((s) => /metal-shrine-pull/.test(s.id));
      assert.equal(viaHeld, false, "walk must not be attributed to held plate id");
    }
  });

  it("still freeze expiry returns to action-required", () => {
    const sim = enter("still");
    sim.moveBlock.frozen = 2;
    sim.moveBlock.frozen = 0;
    const snap = sim.navigationSnapshot();
    assert.equal(snap.status, "action-required");
  });
});

describe("R5-4 route line endpoints invalidate", () => {
  it("endpoint-only change produces a new polyline identity", () => {
    initWorld();
    const sim = new Sim();
    sim.mode = "playing";
    sim.enterShrine(SHRINES.findIndex((s) => s.id === "burst")!);
    sim.interactLock = 0;
    sim.mode = "playing";
    const a = sim.navigationSnapshot();
    const b = sim.navigationSnapshot();
    // Moving the player changes the first endpoint even if world/id set is the same.
    sim.player.z += 0.8;
    const c = sim.navigationSnapshot();
    const key = (s: typeof a) =>
      s.segments.map((g) => `${g.id}:${g.from.x.toFixed(2)},${g.from.z.toFixed(2)}->${g.to.x.toFixed(2)},${g.to.z.toFixed(2)}`).join("|");
    assert.equal(key(a), key(b));
    assert.notEqual(key(a), key(c), "endpoint move must change polyline key");
  });
});
