/** Frame-time and memory trend from recorded samples. Never invents numbers. */

import { unexpectedCloseFailure } from "./lifecycle.mjs";

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[i];
}

export function summarizeFrames(frames) {
  const nums = (frames || []).filter((n) => Number.isFinite(n) && n >= 0);
  if (!nums.length) {
    return { n: 0, p50: null, p95: null, p99: null, mean: null, max: null };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    mean: sum / sorted.length,
    max: sorted[sorted.length - 1],
  };
}

export function memoryTrend(samples) {
  const pts = (samples || [])
    .map((s, i) => ({ i, mem: s?.mem }))
    .filter((p) => Number.isFinite(p.mem));
  if (pts.length < 2) {
    return { n: pts.length, start: pts[0]?.mem ?? null, end: pts[0]?.mem ?? null, delta: null, slopePerSample: null };
  }
  const start = pts[0].mem;
  const end = pts[pts.length - 1].mem;
  const n = pts.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of pts) {
    sumX += p.i;
    sumY += p.mem;
    sumXY += p.i * p.mem;
    sumXX += p.i * p.i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slopePerSample = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  return { n, start, end, delta: end - start, slopePerSample };
}

export function evaluateStability({ durationMs, requestedMs, samples, pageErrors, frames, closeReason }) {
  const failures = [];
  const frameSum = summarizeFrames(frames);
  const mem = memoryTrend(samples);
  if (!samples?.length) {
    failures.push({ id: "samples", expected: ">0", actual: 0, detail: "no stability samples recorded" });
  }
  if (frameSum.n < 30) {
    failures.push({
      id: "frames",
      expected: ">=30 rAF deltas",
      actual: frameSum.n,
      detail: "not enough frame times to report percentiles",
    });
  }
  if (requestedMs > 0 && durationMs + 2000 < requestedMs * 0.8) {
    failures.push({
      id: "duration",
      expected: `~${requestedMs}ms`,
      actual: durationMs,
      detail: "run ended well short of requested duration",
    });
  }
  if ((pageErrors || []).length) {
    failures.push({
      id: "pageerror",
      expected: "no page errors",
      actual: pageErrors[0],
      detail: `${pageErrors.length} pageerror(s)`,
    });
  }
  const closeFail = unexpectedCloseFailure(closeReason);
  if (closeFail) failures.push(closeFail);
  return {
    ok: failures.length === 0,
    failures,
    frames: frameSum,
    memory: mem,
  };
}
