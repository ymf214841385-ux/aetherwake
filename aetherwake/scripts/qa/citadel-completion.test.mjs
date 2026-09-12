import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyCitadelCompletion } from "./citadel-completion.mjs";

// IO fixtures exercise the acceptance contract, not a real browser victory.
const finishSnapshot = (overrides = {}) => ({
  bossDead: true,
  mode: "ending",
  boss: { alive: false },
  hp: 1,
  amber: 165,
  ...overrides,
});
const reloadObservation = (overrides = {}) => ({
  restored: true,
  envelope: { bossDead: true },
  ...overrides,
});
const afterSnapshot = (overrides = {}) => ({
  bossDead: true,
  mode: "playing",
  boss: { alive: false },
  amber: 165,
  ...overrides,
});

function fixture({ finish = finishSnapshot(), reload = reloadObservation(), after = afterSnapshot(), checkpoint = "/evidence/ending.json" } = {}) {
  const calls = [];
  return {
    calls,
    finish,
    reload,
    after,
    checkpoint,
    args: {
      finish,
      saveCheckpoint: async () => {
        calls.push("checkpoint");
        return checkpoint;
      },
      observeReload: async () => {
        calls.push("reload");
        return reload;
      },
      read: async () => {
        calls.push("read");
        return after;
      },
    },
  };
}

describe("citadel completion acceptance contract", () => {
  for (const mode of ["playing", "ending"]) {
    it(`accepts verified victory, saved completion and ${mode} continuation in order`, async () => {
      const f = fixture({ after: afterSnapshot({ mode }) });
      Object.freeze(f.finish.boss);
      Object.freeze(f.finish);
      Object.freeze(f.reload.envelope);
      Object.freeze(f.reload);
      Object.freeze(f.after.boss);
      Object.freeze(f.after);
      const result = await verifyCitadelCompletion(f.args);
      assert.deepEqual(f.calls, ["checkpoint", "reload", "read"]);
      assert.deepEqual(result, {
        ok: true,
        failures: [],
        reload: f.reload,
        finish: f.finish,
        after: f.after,
        checkpoint: f.checkpoint,
      });
    });
  }

  const invalidFinishes = [
    ["absent finish", null, "finish-boss-not-dead"],
    ["incomplete progress", finishSnapshot({ bossDead: false }), "finish-boss-not-dead"],
    ["truthy completion string", finishSnapshot({ bossDead: "true" }), "finish-boss-not-dead"],
    ["playing without ending observation", finishSnapshot({ mode: "playing" }), "finish-not-ending"],
    ["still living boss", finishSnapshot({ boss: { alive: true } }), "finish-boss-alive-unverified"],
    ["missing boss", finishSnapshot({ boss: null }), "finish-boss-alive-unverified"],
    ["missing boss alive flag", finishSnapshot({ boss: {} }), "finish-boss-alive-unverified"],
    ["dead player", finishSnapshot({ hp: 0 }), "finish-player-not-alive"],
    ["unknown player HP", finishSnapshot({ hp: undefined }), "finish-player-not-alive"],
    ["nonfinite HP", finishSnapshot({ hp: Infinity }), "finish-player-not-alive"],
    ["unknown reward", finishSnapshot({ amber: undefined }), "finish-amber-unavailable"],
    ["nonfinite reward", finishSnapshot({ amber: NaN }), "finish-amber-unavailable"],
  ];
  for (const [label, finish, failure] of invalidFinishes) {
    it(`rejects ${label} before archiving or reloading`, async () => {
      const f = fixture({ finish });
      const result = await verifyCitadelCompletion(f.args);
      assert.equal(result.ok, false);
      assert.ok(result.failures.includes(failure));
      assert.deepEqual(f.calls, []);
      assert.equal(result.finish, finish);
      assert.equal(result.after, null);
      assert.equal(result.reload, null);
      assert.equal(result.checkpoint, null);
    });
  }

  for (const checkpoint of [null, "", false]) {
    it(`rejects missing checkpoint ${JSON.stringify(checkpoint)} before reload`, async () => {
      const f = fixture({ checkpoint });
      const result = await verifyCitadelCompletion(f.args);
      assert.equal(result.ok, false);
      assert.deepEqual(result.failures, ["checkpoint-missing"]);
      assert.deepEqual(f.calls, ["checkpoint"]);
      assert.equal(result.after, null);
      assert.equal(result.reload, null);
    });
  }

  const invalidReloads = [
    ["no reload observation", null, "reload-not-restored"],
    ["not restored", reloadObservation({ restored: false }), "reload-not-restored"],
    ["truthy restored", reloadObservation({ restored: "true" }), "reload-not-restored"],
    ["no save envelope", reloadObservation({ envelope: null }), "saved-boss-not-dead"],
    ["old save", reloadObservation({ envelope: { bossDead: false } }), "saved-boss-not-dead"],
    ["truthy saved flag", reloadObservation({ envelope: { bossDead: "true" } }), "saved-boss-not-dead"],
  ];
  for (const [label, reload, failure] of invalidReloads) {
    it(`rejects ${label} despite a completed final snapshot`, async () => {
      const f = fixture({ reload });
      const result = await verifyCitadelCompletion(f.args);
      assert.equal(result.ok, false);
      assert.ok(result.failures.includes(failure));
      assert.equal(result.reload, reload);
      assert.equal(result.after, f.after);
      assert.deepEqual(f.calls, ["checkpoint", "reload", "read"]);
    });
  }

  const invalidAfters = [
    ["missing actual read", null, "after-boss-not-dead"],
    ["rolled-back progress", afterSnapshot({ bossDead: false }), "after-boss-not-dead"],
    ["truthy progress", afterSnapshot({ bossDead: "true" }), "after-boss-not-dead"],
    ["resurrected boss", afterSnapshot({ boss: { alive: true } }), "after-boss-alive-unverified"],
    ["missing boss state", afterSnapshot({ boss: null }), "after-boss-alive-unverified"],
    ["title screen", afterSnapshot({ mode: "title" }), "after-mode-invalid"],
    ["dead screen", afterSnapshot({ mode: "dead" }), "after-mode-invalid"],
    ["unaccepted credits mode", afterSnapshot({ mode: "credits" }), "after-mode-invalid"],
    ["duplicate reward", afterSnapshot({ amber: 200 }), "amber-changed"],
    ["lost reward", afterSnapshot({ amber: 130 }), "amber-changed"],
    ["missing reward", afterSnapshot({ amber: undefined }), "after-amber-unavailable"],
    ["nonfinite reward", afterSnapshot({ amber: Infinity }), "after-amber-unavailable"],
    ["coerced reward", afterSnapshot({ amber: "165" }), "after-amber-unavailable"],
  ];
  for (const [label, after, failure] of invalidAfters) {
    it(`rejects ${label} despite a restored save report`, async () => {
      const f = fixture({ after });
      const result = await verifyCitadelCompletion(f.args);
      assert.equal(result.ok, false);
      assert.ok(result.failures.includes(failure));
      assert.equal(result.after, after);
      assert.deepEqual(f.calls, ["checkpoint", "reload", "read"]);
    });
  }

  it("accepts measured zero amber without requiring an invented reward amount", async () => {
    const f = fixture({ finish: finishSnapshot({ amber: 0 }), after: afterSnapshot({ amber: 0 }) });
    assert.equal((await verifyCitadelCompletion(f.args)).ok, true);
  });

  for (const [key, expected] of [
    ["saveCheckpoint", ["checkpoint"]],
    ["observeReload", ["checkpoint", "reload"]],
    ["read", ["checkpoint", "reload", "read"]],
  ]) {
    it(`propagates ${key} failure and performs no later IO`, async () => {
      const f = fixture();
      const failure = new Error(`${key} transport failed`);
      f.args[key] = async () => {
        f.calls.push(expected.at(-1));
        throw failure;
      };
      await assert.rejects(verifyCitadelCompletion(f.args), (error) => error === failure);
      assert.deepEqual(f.calls, expected);
    });
  }

  it("awaits checkpoint completion before refreshing and refresh before reading", async () => {
    const f = fixture();
    let releaseCheckpoint;
    let releaseReload;
    const checkpointPending = new Promise((resolve) => { releaseCheckpoint = resolve; });
    const reloadPending = new Promise((resolve) => { releaseReload = resolve; });
    f.args.saveCheckpoint = async () => {
      f.calls.push("checkpoint");
      return checkpointPending;
    };
    f.args.observeReload = async () => {
      f.calls.push("reload");
      return reloadPending;
    };
    const pending = verifyCitadelCompletion(f.args);
    assert.deepEqual(f.calls, ["checkpoint"]);
    releaseCheckpoint(f.checkpoint);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.calls, ["checkpoint", "reload"]);
    releaseReload(f.reload);
    assert.equal((await pending).ok, true);
    assert.deepEqual(f.calls, ["checkpoint", "reload", "read"]);
  });
});
