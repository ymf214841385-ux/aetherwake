import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REAL_INPUT_CODES,
  TOWER_BASE_Y,
  TOWER_LEDGE_ROWS,
  authoredBaseY,
  assertRealKeys,
  climbTickPolicy,
  isInShaft,
  isRealInputCode,
  keysForAction,
  nearLedge,
  reapproachWaypoints,
  towerApproachPoint,
  towerLedgeLocalYs,
  towerLedgeWorldYs,
} from "./climb-policy.mjs";

const dawn = { x: 10, z: 68 };
const ctx = { id: "dawn", tw: dawn, baseY: 9.8, burstUntil: 0, now: 1 };

describe("climb policy QF1", () => {
  it("after rest on a ledge, re-grabs with W+E and does not tap S", () => {
    const a = climbTickPolicy(
      {
        state: "grounded",
        y: towerLedgeWorldYs(9.8)[1],
        stamina: 90,
        staminaMax: 100,
        x: 15,
        z: 68,
        towers: [],
        prompt: "",
      },
      ctx,
    );
    assert.equal(a.type, "regrab");
    assert.equal(a.tapS, false);
    assert.equal(a.holdW, true);
    assert.equal(a.holdE, true);
    assert.deepEqual(keysForAction(a), ["KeyW", "KeyE"]);
  });

  it("nearLedge is 3 authored rows, not 12 even spacings", () => {
    assert.equal(TOWER_LEDGE_ROWS, 3);
    const locals = towerLedgeLocalYs(9.8);
    assert.equal(locals.length, 3);
    const worlds = towerLedgeWorldYs(9.8);
    for (const y of worlds) assert.equal(nearLedge(y, 9.8), true);
    // Old 12-row midpoint (baseY+2.1+4*(38-3.4)/11 ≈ 24.48) is not a rest ledge.
    assert.equal(nearLedge(24.4, 9.8), false);
    const y0 = locals[0];
    const yTop = locals[2];
    assert.ok(Math.abs(y0 - 2.1) < 1e-9);
    assert.ok(Math.abs(yTop - (38 - 1.55)) < 1e-9);
  });

  it("drops only on an authored ledge; mid-shaft S would fall", () => {
    const onRow = towerLedgeWorldYs(9.8)[1];
    const drop = climbTickPolicy(
      {
        state: "climbing",
        y: onRow,
        stamina: 40,
        staminaMax: 100,
        x: 14.2,
        z: 68,
        towers: [],
        prompt: "",
      },
      ctx,
    );
    assert.equal(drop.type, "ledge-drop");
    const between = climbTickPolicy(
      {
        state: "climbing",
        y: 24.4,
        stamina: 12,
        staminaMax: 100,
        x: 14.2,
        z: 68,
        towers: [],
        prompt: "",
      },
      ctx,
    );
    assert.equal(between.type, "climb-up");
    assert.deepEqual(keysForAction(between), ["KeyW"]);
  });

  it("holds W only while already climbing", () => {
    const a = climbTickPolicy(
      {
        state: "climbing",
        y: 20,
        stamina: 80,
        staminaMax: 100,
        x: 14.2,
        z: 68,
        towers: [],
        prompt: "",
      },
      { ...ctx, burstUntil: 1e15, now: 0 },
    );
    assert.equal(a.type, "climb-up");
    assert.deepEqual(keysForAction(a), ["KeyW"]);
  });

  it("reapproach detours around the shaft instead of walking into (10,63)", () => {
    const wps = reapproachWaypoints({ x: 10, z: 63, state: "grounded" }, dawn);
    assert.ok(wps.length >= 2);
    for (const p of wps) {
      const d = Math.hypot(p.x - dawn.x, p.z - dawn.z);
      assert.ok(d > 4.2, `waypoint ${p.x},${p.z} is inside the shaft`);
    }
    const approach = towerApproachPoint(dawn);
    const last = wps[wps.length - 1];
    assert.equal(last.x, approach.x);
    assert.equal(last.z, approach.z);
    assert.ok(approach.z > dawn.z);
  });

  it("swimming at the shaft grabs with W+E, not a Space jump into the hollow", () => {
    const mere = { x: -108, z: 8 };
    const a = climbTickPolicy(
      {
        state: "swimming",
        y: 3.4,
        stamina: 80,
        staminaMax: 100,
        x: -108,
        z: 13.2,
        towers: [],
        prompt: "",
      },
      { id: "mere", tw: mere, baseY: 7.8, burstUntil: 0, now: 1 },
    );
    assert.equal(a.type, "approach-grab");
    assert.deepEqual(keysForAction(a), ["KeyW", "KeyE"]);
  });

  it("after regrab, burstUntil suppresses S-drop while still near the same ledge", () => {
    const y = towerLedgeWorldYs(11.1)[1];
    const during = climbTickPolicy(
      {
        state: "climbing",
        y,
        stamina: 40,
        staminaMax: 100,
        x: 15.8,
        z: 69,
        towers: [],
        prompt: "",
      },
      { id: "dawn", tw: dawn, baseY: 11.1, burstUntil: 2000, now: 1000 },
    );
    assert.equal(during.type, "climb-up");
    const after = climbTickPolicy(
      {
        state: "climbing",
        y,
        stamina: 40,
        staminaMax: 100,
        x: 15.8,
        z: 69,
        towers: [],
        prompt: "",
      },
      { id: "dawn", tw: dawn, baseY: 11.1, burstUntil: 500, now: 1000 },
    );
    assert.equal(after.type, "ledge-drop");
  });

  it("authored baseY is the pad, not the swim/approach y", () => {
    assert.equal(authoredBaseY("mere", 3.5), TOWER_BASE_Y.mere);
    assert.equal(authoredBaseY("dawn", 13.4), TOWER_BASE_Y.dawn);
    assert.ok(Math.abs(towerLedgeWorldYs(TOWER_BASE_Y.dawn)[0] - 13.2) < 0.2);
    assert.equal(nearLedge(30.59, 13.4), false, "swim/approach y shifts rest rows off the real ledges");
    assert.equal(nearLedge(30.59, TOWER_BASE_Y.dawn), true);
  });

  it("grounded on a ledge waits for a near-full bar before regrab", () => {
    const y = towerLedgeWorldYs(9.8)[1];
    const low = climbTickPolicy(
      {
        state: "grounded",
        y,
        stamina: 52,
        staminaMax: 100,
        x: 15,
        z: 68,
        towers: [],
        prompt: "",
      },
      ctx,
    );
    assert.equal(low.type, "rest");
    const full = climbTickPolicy(
      {
        state: "grounded",
        y,
        stamina: 90,
        staminaMax: 100,
        x: 15,
        z: 68,
        towers: [],
        prompt: "",
      },
      ctx,
    );
    assert.equal(full.type, "regrab");
  });

  it("grounded between authored rows is regrab, not a rest on empty air", () => {
    const between = climbTickPolicy(
      {
        state: "grounded",
        y: 24.4,
        stamina: 40,
        staminaMax: 100,
        x: 15,
        z: 68,
        towers: [],
        prompt: "",
      },
      ctx,
    );
    assert.equal(between.type, "regrab");
  });

  it("mere wall-hug xz=4.5 is not the hollow (78945 false shaft)", () => {
    const mere = { x: -108, z: 8 };
    assert.equal(isInShaft({ x: mere.x, z: mere.z + 4.5, y: 3.8, state: "swimming" }, mere), false);
    assert.equal(isInShaft({ x: mere.x + 0.2, z: mere.z + 0.2, y: 3.8, state: "swimming" }, mere), true);
  });

  it("flags the dawn shaft stuck pose", () => {
    assert.equal(isInShaft({ x: 10, z: 63, state: "grounded" }, dawn), false);
    assert.equal(isInShaft({ x: 10.1, z: 68.1, state: "grounded" }, dawn), true);
    assert.equal(isInShaft({ x: 10.1, z: 68.1, state: "climbing" }, dawn), false);
    assert.equal(isInShaft({ x: 10, z: 72.3, state: "swimming" }, dawn), false, "wall-hug is not the hollow");
  });

  it("grounded on the mere dock is a grab, not a below-pad detour", () => {
    const mere = { x: -108, z: 8 };
    const a = climbTickPolicy(
      {
        state: "grounded",
        y: 3.5,
        stamina: 100,
        staminaMax: 100,
        x: -108,
        z: 13.5,
        towers: ["dawn"],
        prompt: "",
      },
      { id: "mere", tw: mere, baseY: 7.8, burstUntil: 0, now: 1 },
    );
    assert.equal(a.type, "approach-grab");
  });

  it("mere underwater near the dock grabs the wall; far lake falls back to reapproach", () => {
    const mere = { x: -108, z: 8 };
    const near = climbTickPolicy(
      {
        state: "swimming",
        y: 3.2,
        stamina: 100,
        staminaMax: 100,
        x: -108,
        z: 13.5,
        towers: [],
        prompt: "",
      },
      { id: "mere", tw: mere, baseY: 7.8, burstUntil: 0, now: 1 },
    );
    assert.equal(near.type, "approach-grab");
    assert.deepEqual(keysForAction(near), ["KeyW", "KeyE"]);
    const far = climbTickPolicy(
      {
        state: "swimming",
        y: 3.2,
        stamina: 100,
        staminaMax: 100,
        x: -108,
        z: 40,
        towers: [],
        prompt: "",
      },
      { id: "mere", tw: mere, baseY: 7.8, burstUntil: 0, now: 1 },
    );
    assert.equal(far.type, "reapproach");
  });

  it("never instructs a 12m teleport / grabRest snap", () => {
    const samples = [
      { state: "grounded", y: 24.4, stamina: 90, staminaMax: 100, x: 15, z: 68, towers: [], prompt: "" },
      { state: "climbing", y: 20, stamina: 12, staminaMax: 100, x: 14, z: 68, towers: [], prompt: "" },
      { state: "swimming", y: 3, stamina: 100, staminaMax: 100, x: -108, z: 12, towers: [], prompt: "" },
      { state: "airborne", y: 18, stamina: 40, staminaMax: 100, x: 12, z: 70, towers: [], prompt: "" },
      { state: "grounded", y: 10, stamina: 100, staminaMax: 100, x: 10, z: 68, towers: [], prompt: "" },
    ];
    for (const s of samples) {
      const a = climbTickPolicy(s, ctx);
      assert.equal(assertRealKeys(a), true, a.type);
      assert.equal(/teleport|snap|grabRest/i.test(a.type), false);
      for (const k of keysForAction(a)) assert.equal(isRealInputCode(k), true);
    }
  });

  it("crown top rest is not the cap; activate uses authored baseY", () => {
    const crown = { x: 48, z: -128 };
    const rest = climbTickPolicy(
      {
        state: "climbing",
        y: 47.8,
        stamina: 80,
        staminaMax: 100,
        x: 48,
        z: -123,
        towers: ["dawn", "mere"],
        prompt: "",
      },
      { id: "crown", tw: crown, baseY: 16.8, burstUntil: 0, now: 1 },
    );
    assert.equal(rest.type, "climb-up");
    const cap = climbTickPolicy(
      {
        state: "grounded",
        y: 54.8,
        stamina: 80,
        staminaMax: 100,
        x: 48,
        z: -126,
        towers: ["dawn", "mere"],
        prompt: "",
      },
      { id: "crown", tw: crown, baseY: 16.8, burstUntil: 0, now: 1 },
    );
    assert.equal(cap.type, "activate");
  });

  it("crown cap outer pad xz=5.3 activates (85510 missed 启动)", () => {
    const crown = { x: 48, z: -128 };
    const ctx = { id: "crown", tw: crown, baseY: 16.8, burstUntil: 0, now: 1 };
    const prompted = climbTickPolicy(
      {
        state: "grounded",
        y: 54.8,
        stamina: 108,
        staminaMax: 108,
        x: 52.16,
        z: -131.17,
        towers: [],
        prompt: "启动 雪冠塔",
      },
      ctx,
    );
    assert.equal(prompted.type, "activate");
    const outer = climbTickPolicy(
      {
        state: "grounded",
        y: 54.8,
        stamina: 108,
        staminaMax: 108,
        x: 52.16,
        z: -131.17,
        towers: [],
        prompt: "",
      },
      ctx,
    );
    assert.equal(outer.type, "activate", `xz=${Math.hypot(52.16 - 48, -131.17 + 128).toFixed(2)} should still be cap activate`);
  });

  it("real input set is ordinary WASD/E/Space keys", () => {
    assert.ok(REAL_INPUT_CODES.includes("KeyW"));
    assert.ok(REAL_INPUT_CODES.includes("KeyE"));
    assert.ok(REAL_INPUT_CODES.includes("Space"));
    assert.ok(REAL_INPUT_CODES.includes("KeyC"));
    assert.equal(REAL_INPUT_CODES.some((c) => /teleport|grabRest/i.test(c)), false);
  });
});
