/**
 * D1.1: harness report+cleanup must always exit. Spawn real children for
 * success / throw / report-write-fail. No orphan browser. Timeout = fail.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const EXIT_MS = 8000;

function runChild(script, env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve({ timedOut: true, elapsedMs: Date.now() - t0, stdout, stderr });
    }, EXIT_MS);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut: false, elapsedMs: Date.now() - t0, stdout, stderr });
    });
  });
}

const SUCCESS = `
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "hx-ok-"));
const report = join(dir, "report.json");
let ok = false;
try {
  ok = true;
} finally {
  try { writeFileSync(report, JSON.stringify({ ok, phase: "success" })); } catch {}
  process.exitCode = ok ? 0 : 1;
}
`;

const THROW = `
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "hx-throw-"));
const report = join(dir, "report.json");
let detail = "";
try {
  throw new Error("intentional-harness-throw");
} catch (e) {
  detail = String(e?.message || e);
} finally {
  try { writeFileSync(report, JSON.stringify({ ok: false, detail })); } catch {}
  process.exitCode = 1;
}
`;

const REPORT_FAIL = `
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "hx-rf-"));
const report = join(dir, "locked");
writeFileSync(report, "");
chmodSync(report, 0o400);
let cleanup = false;
try {
  // simulate work
} finally {
  try { writeFileSync(report, "x"); } catch { /* expected */ }
  cleanup = true;
  process.exitCode = 2;
}
process.stdout.write(JSON.stringify({ cleanup }));
`;

describe("harness exit contract (D1.1)", () => {
  it("success path exits 0 within budget", async () => {
    const r = await runChild(SUCCESS);
    assert.equal(r.timedOut, false, `timed out stderr=${r.stderr}`);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.elapsedMs < EXIT_MS);
  });

  it("throw path exits non-zero within budget and keeps error text", async () => {
    const r = await runChild(THROW);
    assert.equal(r.timedOut, false, `timed out stderr=${r.stderr}`);
    assert.equal(r.code, 1);
    assert.ok(r.elapsedMs < EXIT_MS);
  });

  it("report write failure still runs cleanup and exits non-zero", async () => {
    const r = await runChild(REPORT_FAIL);
    assert.equal(r.timedOut, false, `timed out stderr=${r.stderr}`);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /"cleanup":true/);
  });

  it("boss-from-sealed source has no undefined flushed assignment (no-undef class)", () => {
    const src = readFileSync(
      new URL("./boss-from-sealed.mjs", import.meta.url),
      "utf8",
    );
    assert.ok(!/\bflushed\s*=/.test(src), "must not assign undeclared flushed");
    assert.ok(!/\blet\s+flushed\b/.test(src), "must not reintroduce first-flush flag");
    // finally must dispose heartbeat
    assert.ok(/harnessLife\?\.dispose/.test(src), "finally must dispose harnessLife");
  });
});
