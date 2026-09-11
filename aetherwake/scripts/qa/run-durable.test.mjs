import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { compiledDistReady, heartbeatPath, isAlive, projectRoot } from "./lifecycle.mjs";
import { startDurable, stopDurable } from "./run-durable.mjs";

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = projectRoot();
const RUNNER = join(QA_DIR, "run-durable.mjs");
const CHILD = join(QA_DIR, "durable-child.mjs");

function runLauncher(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr, pid: child.pid }));
  });
}

async function waitAliveHeartbeat(pid, timeoutMs = 8000) {
  const hb = heartbeatPath(pid);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isAlive(pid) && existsSync(hb)) return JSON.parse(readFileSync(hb, "utf8"));
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`heartbeat-${pid}.json did not appear`);
}

describe("run-durable launcher", { concurrency: 1 }, () => {
  it("refuses stability/play-routes start when dist/ is missing", async () => {
    const dist = compiledDistReady(ROOT);
    if (dist.ok) {
      assert.equal(dist.ok, true);
      return;
    }
    const r = await startDurable({ name: "stability", cmd: ["scripts/stability.mjs"], cwd: ROOT });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /dist/);
    const play = await startDurable({ name: "play-routes", cmd: ["scripts/play-routes.mjs"], cwd: ROOT });
    assert.equal(play.ok, false);
    assert.match(String(play.error), /dist/);
  });

  it("child survives the launcher process exiting, then stop via pid file", { timeout: 20000 }, async () => {
    const launched = await runLauncher(
      [RUNNER, "--name", "durable-test", "--", CHILD],
      { QA_CHILD_MS: "20000" },
    );
    assert.equal(launched.code, 0, launched.stderr || launched.stdout);
    const json = JSON.parse(launched.stdout);
    assert.equal(json.ok, true, launched.stdout);
    assert.ok(json.pid > 1);
    assert.ok(json.pidFile);
    assert.equal(isAlive(launched.pid), false, "launcher should have exited");
    try {
      assert.equal(isAlive(json.pid), true, "child died with the launcher");
      const hb = await waitAliveHeartbeat(json.pid);
      assert.equal(hb.pid, json.pid);
      assert.ok(existsSync(json.logFile));
      const stopped = await stopDurable({ pidFile: json.pidFile });
      assert.equal(stopped.ok, true, stopped.error);
      assert.equal(isAlive(json.pid), false);
    } finally {
      if (isAlive(json.pid)) {
        await stopDurable({ pidFile: json.pidFile }).catch(() => {});
        try {
          process.kill(json.pid, "SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("stop refuses pid<=1 / mismatched pid file", async () => {
    const missing = await stopDurable({ pidFile: join(ROOT, ".grok", "no-such-durable.pid") });
    assert.equal(missing.ok, false);
  });

  it("play-routes startDurable defaults headed true when QA_HEADED is unset", async () => {
    const prev = process.env.QA_HEADED;
    const prevMs = process.env.QA_CHILD_MS;
    delete process.env.QA_HEADED;
    process.env.QA_CHILD_MS = "4000";
    let r;
    try {
      r = await startDurable({ name: "play-routes", cmd: [CHILD], cwd: ROOT });
      assert.equal(r.ok, true, r.error);
      assert.equal(r.headed, true);
    } finally {
      if (prev == null) delete process.env.QA_HEADED;
      else process.env.QA_HEADED = prev;
      if (prevMs == null) delete process.env.QA_CHILD_MS;
      else process.env.QA_CHILD_MS = prevMs;
      if (r?.pidFile) await stopDurable({ pidFile: r.pidFile }).catch(() => {});
    }
  });
});
