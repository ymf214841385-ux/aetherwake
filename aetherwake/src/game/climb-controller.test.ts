/**
 * R10 — sequence tests for the actual climb decision function used by short-loop.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideClimbAction, isRestSupportId, type ClimbTelemetry } from "./climb-controller.ts";

const base = (over: Partial<ClimbTelemetry> = {}): ClimbTelemetry => ({
  state: "grounded",
  y: 30.5,
  stamina: 100,
  nearestClimbId: "dawn-spiral-4",
  ...over,
});

describe("R10 climb controller order", () => {
  it("climbing low stamina → DESCEND (not ASCEND/SUMMIT)", () => {
    const d = decideClimbAction(base({ state: "climbing", stamina: 5, y: 32, nearestClimbId: "dawn-shaft" }));
    assert.equal(d.phase, "DESCEND");
    assert.equal(d.tryClimb, true);
    assert.equal(d.tryInteract, false);
  });

  it("grounded ledge + low stamina → REST", () => {
    const d = decideClimbAction(base({ state: "grounded", stamina: 12, nearestClimbId: "dawn-spiral-4" }));
    assert.equal(d.phase, "REST");
    assert.equal(d.releaseInput, true);
    assert.equal(d.tryClimb, false);
  });

  it("REST_WAIT until recovered; timeout → FAIL", () => {
    const wait = decideClimbAction(base({ stamina: 40 }), { restElapsedMs: 1000, restRecovered: 85 });
    assert.equal(wait.phase, "REST_WAIT");
    const done = decideClimbAction(base({ stamina: 90 }), { restElapsedMs: 1000, restRecovered: 85 });
    assert.notEqual(done.phase, "REST_WAIT");
    const fail = decideClimbAction(base({ stamina: 20 }), { restElapsedMs: 9000, restRecovered: 85, restTimeoutMs: 8000 });
    assert.equal(fail.phase, "FAIL");
  });

  it("prior maxY must not force SUMMIT after fall to y=14", () => {
    // Controller has no maxY input — falling player is APPROACH/REST, never SUMMIT.
    const d = decideClimbAction(base({ state: "grounded", y: 13.4, stamina: 80, nearestClimbId: "dawn-shaft" }));
    assert.notEqual(d.phase, "SUMMIT_INTERACT");
    assert.equal(d.phase, "APPROACH");
  });

  it("death aborts", () => {
    const d = decideClimbAction(base({ state: "dead", hp: 0, stamina: 0 }));
    assert.equal(d.phase, "DEAD");
    assert.equal(d.releaseInput, true);
  });

  it("non-playing mode aborts", () => {
    const d = decideClimbAction(base({ mode: "paused", state: "grounded" }));
    assert.equal(d.phase, "FAIL");
  });

  it("climbing with stamina is ASCEND not SUMMIT", () => {
    const d = decideClimbAction(base({ state: "climbing", stamina: 50, y: 44, nearestClimbId: "dawn-shaft" }));
    assert.equal(d.phase, "ASCEND");
  });

  it("summit interact only when y>=activateY and control visible", () => {
    const low = decideClimbAction(base({ state: "grounded", y: 45, stamina: 90, nearestClimbId: "dawn-cap", interactVisible: true }), { activateY: 46.9 });
    assert.notEqual(low.phase, "SUMMIT_INTERACT");
    const ok = decideClimbAction(base({ state: "grounded", y: 47, stamina: 90, nearestClimbId: "dawn-cap", interactVisible: true }), { activateY: 46.9 });
    assert.equal(ok.phase, "SUMMIT_INTERACT");
    assert.equal(ok.tryInteract, true);
    const hidden = decideClimbAction(base({ state: "grounded", y: 47, stamina: 90, nearestClimbId: "dawn-cap", interactVisible: false }), { activateY: 46.9 });
    assert.notEqual(hidden.phase, "SUMMIT_INTERACT");
  });

  it("isRestSupportId recognizes spiral/ledge/cap", () => {
    assert.equal(isRestSupportId("dawn-spiral-4"), true);
    assert.equal(isRestSupportId("dawn-ledge-2"), true);
    assert.equal(isRestSupportId("dawn-cap"), true);
    assert.equal(isRestSupportId("dawn-shaft"), false);
    assert.equal(isRestSupportId("terrain"), false);
  });
});
