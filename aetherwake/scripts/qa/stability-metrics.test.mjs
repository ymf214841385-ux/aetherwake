import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateStability, summarizeFrames } from "./stability-metrics.mjs";

describe("stability metrics", () => {
  it("does not pass with empty samples", () => {
    const r = evaluateStability({ durationMs: 0, requestedMs: 600000, samples: [], pageErrors: [], frames: [] });
    assert.equal(r.ok, false);
    assert.equal(r.frames.p50, null);
  });

  it("computes percentiles from real frame times", () => {
    const frames = [8, 10, 12, 16, 20, 24, 30, 40];
    const s = summarizeFrames(frames);
    assert.equal(s.n, 8);
    assert.equal(s.p50, 16);
    assert.ok(s.p95 >= s.p50);
  });

  it("fails if the run is far shorter than requested", () => {
    const samples = [{ mem: 10 }, { mem: 11 }];
    const frames = Array.from({ length: 40 }, () => 16);
    const r = evaluateStability({
      durationMs: 5000,
      requestedMs: 600000,
      samples,
      pageErrors: [],
      frames,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "duration"));
  });

  it("passes a full-duration run with frames and no real pageerrors", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ mem: 70e6 + i }));
    const frames = Array.from({ length: 40 }, () => 16);
    const r = evaluateStability({
      durationMs: 600000,
      requestedMs: 600000,
      samples,
      pageErrors: [],
      frames,
    });
    assert.equal(r.ok, true);
    assert.equal(r.failures.length, 0);
    assert.equal(r.frames.p50, 16);
  });

  it("fails on a real pageerror (pointer-lock must be filtered by the harness first)", () => {
    const samples = Array.from({ length: 8 }, () => ({ mem: 1 }));
    const frames = Array.from({ length: 40 }, () => 16);
    const r = evaluateStability({
      durationMs: 20000,
      requestedMs: 20000,
      samples,
      pageErrors: ["WebGL: CONTEXT_LOST_WEBGL"],
      frames,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "pageerror"));
  });

  it("fails page.close even if duration and frames look complete", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ mem: 70e6 + i }));
    const frames = Array.from({ length: 40 }, () => 16);
    const r = evaluateStability({
      durationMs: 600000,
      requestedMs: 600000,
      samples,
      pageErrors: [],
      frames,
      closeReason: { kind: "page.close", detail: "page.close event", message: "closed" },
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.id === "close"));
  });

  it("does not treat intentional teardown as a close failure", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ mem: 70e6 + i }));
    const frames = Array.from({ length: 40 }, () => 16);
    const r = evaluateStability({
      durationMs: 600000,
      requestedMs: 600000,
      samples,
      pageErrors: [],
      frames,
      closeReason: { kind: "intentional-teardown", detail: "harness closed after report" },
    });
    assert.equal(r.ok, true);
  });
});
