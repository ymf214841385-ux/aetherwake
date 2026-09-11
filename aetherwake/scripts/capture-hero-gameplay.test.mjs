import assert from "node:assert/strict";
import test from "node:test";
import { assertFrozenFixtureAnimation, buildGameplayCaptureSummary } from "./capture-hero-gameplay.mjs";

test("gameplay capture summary retains the exact observed loaded-asset metadata", () => {
  const asset = {
    status: "ready",
    source: "/__terra-preview/wanderer-v4.glb",
    clips: [{ name: "Attack", duration: 1 }],
    normalMapScale: 0.45,
  };
  const written = [{ path: "/tmp/scene-attack.png", label: "SCENE ATTACK", observed: { animation: { clip: "Attack" } } }];
  const logs = ["console.warn expected renderer deprecation"];

  const summary = buildGameplayCaptureSummary({ port: 8790, asset, written, logs });

  assert.equal(summary.ok, true);
  assert.strictEqual(summary.asset, asset);
  assert.strictEqual(summary.written, written);
  assert.strictEqual(summary.logs, logs);
  assert.equal(summary.fixture, "visual-fixture-only; not normal-input gameplay acceptance");
});

test("gameplay capture summary refuses the missing or failed asset state", () => {
  assert.throws(
    () => buildGameplayCaptureSummary({ port: 8790, asset: null, written: [], logs: [] }),
    /ready loaded-asset metadata/,
  );
  assert.throws(
    () => buildGameplayCaptureSummary({ port: 8790, asset: { status: "loadererror" }, written: [], logs: [] }),
    /ready loaded-asset metadata/,
  );
});

test("fixture freeze requires unchanged simulation, mixer time, and real hand/skin pose", () => {
  const pose = {
    simTime: 12.4,
    clip: "Attack",
    phase: 0.58,
    actionTime: 0.6,
    rightHand: [1, 2, 3],
    skinVertex: [1.1, 2.2, 3.3],
  };
  const verified = assertFrozenFixtureAnimation([pose, structuredClone(pose), structuredClone(pose)], "Attack");
  assert.equal(verified.frames, 3);
  assert.throws(
    () => assertFrozenFixtureAnimation([pose, { ...structuredClone(pose), phase: 0.59 }], "Attack"),
    /changed phase/,
  );
  assert.throws(
    () => assertFrozenFixtureAnimation([pose, { ...structuredClone(pose), skinVertex: [1.1, 2.2, 3.31] }], "Attack"),
    /changed skinVertex/,
  );
});
