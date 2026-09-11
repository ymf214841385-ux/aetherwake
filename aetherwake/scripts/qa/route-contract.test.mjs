import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRoute, saveReloadRestored } from "./route-contract.mjs";

const zeroObjective = {
  mode: "title",
  x: 16,
  y: 11.4,
  z: 102,
  towers: [],
  shrines: [],
  orbs: 0,
  ruinSolved: false,
  bossDead: false,
  prompt: "",
  shrine: null,
};

const complete = {
  mode: "ending",
  towers: ["dawn", "mere", "crown"],
  shrines: ["pull", "rime", "burst", "still"],
  orbs: 4,
  ruinSolved: true,
  bossDead: true,
};

const saveReloadOk = {
  attempted: true,
  savePresent: true,
  continued: true,
  restored: true,
  before: complete,
  after: { ...complete, mode: "playing" },
};

describe("evaluateRoute", () => {
  it("rejects a zero-objective run even if the browser threw nothing", () => {
    const r = evaluateRoute({
      final: zeroObjective,
      observed: { towers: [], shrines: [], orbs: 0, ruinSolved: false, bossDead: false },
      titleMidRun: true,
      attemptedCitadel: true,
      sealClosedAttempt: true,
    });
    assert.equal(r.ok, false);
    const ids = r.failures.map((f) => f.id);
    assert.ok(ids.includes("mode"));
    assert.ok(ids.includes("towers"));
    assert.ok(ids.includes("shrines"));
    assert.ok(ids.includes("orbs"));
    assert.ok(ids.includes("ruinSolved"));
    assert.ok(ids.includes("citadel-seal"));
    assert.ok(ids.includes("save-reload"));
  });

  it("rejects empty arrays with playing mode (no exception is not success)", () => {
    const r = evaluateRoute({
      final: { ...zeroObjective, mode: "playing" },
      titleMidRun: false,
      attemptedCitadel: false,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "towers"));
    assert.ok(r.failures.some((f) => f.id === "shrines"));
    assert.ok(r.failures.some((f) => f.id === "orbs"));
    assert.ok(r.failures.some((f) => f.id === "ruinSolved"));
    assert.ok(r.failures.some((f) => f.id === "citadel"));
    assert.ok(r.failures.some((f) => f.id === "save-reload"));
  });

  it("never coerces ok=true when shrines are zero", () => {
    const r = evaluateRoute({
      final: { ...complete, shrines: [], orbs: 0, mode: "playing" },
      observed: { towers: complete.towers, shrines: [], orbs: 0, ruinSolved: true, bossDead: true },
      attemptedCitadel: true,
      saveReload: saveReloadOk,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "shrines"));
    assert.ok(r.failures.some((f) => f.id === "orbs"));
  });

  it("rejects citadel attempt with seal closed even if other fields were forged", () => {
    const r = evaluateRoute({
      final: { ...complete, bossDead: false, mode: "playing" },
      attemptedCitadel: true,
      sealClosedAttempt: true,
      citadelPrompt: "封印未开（塔 3/3 · 祠 4/4）",
      saveReload: saveReloadOk,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "citadel-seal"));
  });

  it("rejects boss attempt that does not kill the boss", () => {
    const r = evaluateRoute({
      final: { ...complete, bossDead: false, mode: "playing" },
      attemptedCitadel: true,
      sealClosedAttempt: false,
      saveReload: saveReloadOk,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "bossDead"));
  });

  it("rejects complete objectives if citadel was not attempted", () => {
    const r = evaluateRoute({
      final: { ...complete, bossDead: false, mode: "playing" },
      attemptedCitadel: false,
      saveReload: saveReloadOk,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "citadel"));
  });

  it("rejects complete objectives if save+reload was not observed", () => {
    const r = evaluateRoute({
      final: complete,
      observed: { ruinSolved: true, bossDead: true },
      attemptedCitadel: true,
      sealClosedAttempt: false,
      saveReload: { attempted: false },
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "save-reload"));
  });

  it("rejects save+reload that does not restore towers/shrines", () => {
    const r = evaluateRoute({
      final: { ...complete, mode: "playing", towers: [], shrines: [], orbs: 0, bossDead: false },
      observed: { ruinSolved: true, bossDead: true, towers: complete.towers, shrines: complete.shrines, orbs: 4 },
      attemptedCitadel: true,
      saveReload: {
        attempted: true,
        savePresent: true,
        continued: true,
        restored: false,
        before: complete,
        after: { mode: "playing", towers: [], shrines: [], orbs: 0, bossDead: false },
      },
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "save-reload"));
    assert.ok(r.failures.some((f) => f.id === "towers"));
    assert.ok(r.failures.some((f) => f.id === "shrines"));
  });

  it("rejects unexpected page.close even if objectives look complete", () => {
    const r = evaluateRoute({
      final: complete,
      observed: { ruinSolved: true, bossDead: true },
      attemptedCitadel: true,
      saveReload: saveReloadOk,
      closeReason: { kind: "page.close", detail: "page.close event", message: "closed" },
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "close"));
  });

  it("passes only when all route conditions hold", () => {
    const r = evaluateRoute({
      final: complete,
      observed: { towers: complete.towers, shrines: complete.shrines, orbs: 4, ruinSolved: true, bossDead: true },
      titleMidRun: false,
      attemptedCitadel: true,
      sealClosedAttempt: false,
      saveReload: saveReloadOk,
    });
    assert.equal(r.ok, true);
    assert.equal(r.failures.length, 0);
  });

  it("saveReloadRestored requires the four shrines and three towers after reload", () => {
    const miss = saveReloadRestored(complete, { ...complete, shrines: ["pull"], orbs: 1 });
    assert.equal(miss.ok, false);
    const ok = saveReloadRestored(complete, { ...complete, mode: "playing" });
    assert.equal(ok.ok, true);
  });

  it("saveReloadRestored fails when ruinSolved drops true→false", () => {
    const drop = saveReloadRestored(complete, { ...complete, ruinSolved: false });
    assert.equal(drop.ok, false);
    assert.ok(drop.detail.includes("ruinSolved"));
  });
});
