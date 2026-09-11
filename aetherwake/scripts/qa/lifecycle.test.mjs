import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ClosedPageError,
  SHARED_PORTS,
  assertOwnedHarnessPid,
  assertOwnedPid,
  bindCloseTracking,
  browserProcessInfo,
  classifyClose,
  heartbeatPath,
  isAlive,
  isClosedPageMessage,
  isPointerLockNoise,
  partitionPageErrors,
  pickFreePort,
  portFree,
  parentAlive,
  processIdentity,
  qaChromiumLaunchOptions,
  qaHeaded,
  spawnOwnedServer,
  stateDir,
  stopOwnedServer,
  unexpectedCloseFailure,
  waitpidStatus,
} from "./lifecycle.mjs";

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const CHILD = join(QA_DIR, "durable-child.mjs");

describe("lifecycle close classification", () => {
  it("treats headless pointer-lock exceptions as noise, not contract failures", () => {
    const { pointerLockNoise, realErrors } = partitionPageErrors([
      "The root document of this element is not valid for pointer lock.",
      "Unable to acquire pointer lock",
      "WebGL: CONTEXT_LOST_WEBGL",
    ]);
    assert.equal(pointerLockNoise.length, 2);
    assert.deepEqual(realErrors, ["WebGL: CONTEXT_LOST_WEBGL"]);
    assert.equal(isPointerLockNoise("pointer lock"), true);
  });

  it("records page.close / crash / target-destroyed without guessing OOM", () => {
    assert.equal(classifyClose({ pageClosed: true, errorMessage: "wait" }).kind, "page.close");
    assert.equal(classifyClose({ crashed: true }).kind, "crash");
    assert.equal(
      classifyClose({
        errorMessage: "page.waitForTimeout: Target page, context or browser has been closed",
      }).kind,
      "target-destroyed",
    );
    const r = classifyClose({
      errorMessage: "page.waitForTimeout: Target page, context or browser has been closed",
    });
    assert.equal(/oom|hmr/i.test(r.kind + r.detail), false);
    const fail = unexpectedCloseFailure(r);
    assert.equal(fail.id, "close");
  });

  it("intentional teardown is classified and is not a contract failure", () => {
    const r = classifyClose({ pageClosed: true, intentionalTeardown: true, errorMessage: "page.close" });
    assert.equal(r.kind, "intentional-teardown");
    assert.equal(unexpectedCloseFailure(r), null);
  });

  it("ClosedPageError carries closeReason for JSON", () => {
    const err = new ClosedPageError({ kind: "page.close", detail: "page.close event", message: "gone" });
    assert.equal(err.closeReason.kind, "page.close");
    assert.equal(isClosedPageMessage(err.message), false);
    assert.equal(isClosedPageMessage("Target destroyed"), true);
  });

  it("bindCloseTracking records page.close as a flag", () => {
    const flags = bindCloseTracking(null, null, null);
    assert.equal(flags.pageClosed, false);
    assert.equal(flags.intentionalTeardown, false);
  });

  it("bindCloseTracking snapshot records ordered events and intentional teardown", () => {
    const listeners = { page: {}, context: {}, browser: {} };
    const page = { on: (ev, fn) => (listeners.page[ev] = fn) };
    const context = { on: (ev, fn) => (listeners.context[ev] = fn) };
    const browser = { on: (ev, fn) => (listeners.browser[ev] = fn) };
    const flags = bindCloseTracking(page, context, browser);

    // Unexpected crash path: page crash then close, then browser disconnect
    listeners.page.crash();
    listeners.page.close();
    listeners.browser.disconnected();
    let snap = flags.snapshot();
    assert.equal(snap.crashed, true);
    assert.equal(snap.pageClosed, true);
    assert.equal(snap.browserDisconnected, true);
    assert.equal(snap.intentionalTeardown, false);
    assert.deepEqual(
      snap.events.map((e) => e.type),
      ["page-crash", "page-close", "browser-disconnected"],
    );
    assert.equal(snap.order, "page-crash>page-close>browser-disconnected");
    assert.ok(snap.events.every((e) => e.intentional === false));
    assert.ok(snap.elapsedMs >= 0);

    // Deliberate cleanup: mark teardown first, then close — events must say intentional
    const p2 = {};
    const f2 = bindCloseTracking({ on: (ev, fn) => (p2[ev] = fn) }, null, null);
    f2.intentionalTeardown = true;
    p2.close();
    const snap2 = f2.snapshot();
    assert.equal(snap2.intentionalTeardown, true);
    assert.equal(snap2.events[0].type, "page-close");
    assert.equal(snap2.events[0].intentional, true);
  });
});

describe("owned server lifecycle", { concurrency: 1 }, () => {
  it("refuses to steal shared ports unless explicitly requested", async () => {
    const p = await pickFreePort();
    assert.ok(p >= 8101 && p <= 8199);
    assert.equal(SHARED_PORTS.has(p), false);
  });

  it("refuses pid<=1 / self / parent / missing pid file", () => {
    assert.equal(assertOwnedPid({ pid: 1, pidFile: "/tmp/nope" }).ok, false);
    assert.equal(assertOwnedPid({ pid: process.pid, pidFile: "/tmp/nope" }).ok, false);
    assert.equal(assertOwnedPid({ pid: 999999, pidFile: undefined }).ok, false);
    const parentFile = join(stateDir(), `qa-life-parent-${process.ppid}.pid`);
    writeFileSync(parentFile, `${process.ppid}\n`);
    try {
      const r = assertOwnedPid({ pid: process.ppid, pidFile: parentFile, kind: "fixture" });
      assert.equal(r.ok, false);
      assert.match(String(r.error), /parent/);
      const harness = assertOwnedHarnessPid({ pid: process.ppid, pidFile: parentFile });
      assert.equal(harness.ok, false);
      assert.match(String(harness.error), /parent/);
    } finally {
      rmSync(parentFile, { force: true });
    }
  });

  it("spawn → ready → stop is owned and does not race", { timeout: 15000 }, async () => {
    const handle = await spawnOwnedServer({ kind: "fixture", name: "qa-life", delayMs: 120 });
    assert.equal(handle.ok, true, handle.error);
    assert.ok(handle.pid > 1);
    assert.ok(handle.port >= 8101 && handle.port <= 8199);
    assert.equal(handle.detach, false);
    assert.equal(SHARED_PORTS.has(handle.port), false);
    assert.ok(existsSync(handle.pidFile));
    assert.ok(existsSync(handle.logFile));
    assert.ok(existsSync(handle.jsonFile));
    assert.match(handle.pidFile, new RegExp(`qa-life-${handle.pid}\\.pid$`));
    assert.match(handle.logFile, new RegExp(`qa-life-${handle.pid}\\.log$`));
    assert.equal(parseInt(readFileSync(handle.pidFile, "utf8").trim(), 10), handle.pid);
    assert.equal(isAlive(handle.pid), true);

    const res = await fetch(handle.url);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "qa-owned-ok");

    const stranger = await stopOwnedServer({
      pid: 1,
      pidFile: handle.pidFile,
      kind: "fixture",
    });
    assert.equal(stranger.ok, false);
    assert.equal(isAlive(handle.pid), true);

    const mismatch = await stopOwnedServer({
      pid: handle.pid + 1,
      pidFile: handle.pidFile,
      kind: "fixture",
    });
    assert.equal(mismatch.ok, false);
    assert.equal(isAlive(handle.pid), true);

    const stopped = await stopOwnedServer(handle);
    assert.equal(stopped.ok, true, stopped.error);
    assert.equal(isAlive(handle.pid), false);
    assert.equal(existsSync(handle.pidFile), false);
    assert.equal(await portFree(handle.port), true);
    assert.equal(SHARED_PORTS.has(8080), true);
    assert.equal(SHARED_PORTS.has(8081), true);
    assert.equal(SHARED_PORTS.has(8091), true);
  });

  it("does not kill a pid whose cmdline no longer matches", { timeout: 15000 }, async () => {
    const handle = await spawnOwnedServer({ kind: "fixture", name: "qa-life-cmd" });
    assert.equal(handle.ok, true, handle.error);
    try {
      const fake = { ...handle, kind: "preview" };
      const refused = await stopOwnedServer(fake);
      assert.equal(refused.ok, false);
      assert.equal(isAlive(handle.pid), true);
    } finally {
      const stopped = await stopOwnedServer(handle);
      assert.equal(stopped.ok, true, stopped.error);
    }
  });

  it("stop is a no-op when the pid file was tampered to another pid", { timeout: 15000 }, async () => {
    const handle = await spawnOwnedServer({ kind: "fixture", name: "qa-life-tamper" });
    assert.equal(handle.ok, true, handle.error);
    try {
      writeFileSync(handle.pidFile, "999999\n");
      const refused = await stopOwnedServer(handle);
      assert.equal(refused.ok, false);
      assert.match(String(refused.error), /mismatch/);
      writeFileSync(handle.pidFile, `${handle.pid}\n`);
    } finally {
      await stopOwnedServer(handle);
    }
  });
});

describe("harness identity and close evidence", () => {
  it("browserProcessInfo always has a chromiumPid field (never undefined)", () => {
    const info = browserProcessInfo({ process: () => ({ pid: 4242 }), isConnected: () => true });
    assert.equal(info.chromiumPid, 4242);
    assert.equal(info.via, "browser.process");
    const missing = browserProcessInfo({ process: () => null });
    assert.equal(Object.hasOwn(missing, "chromiumPid"), true);
    assert.ok(missing.chromiumPid === null || (Number.isInteger(missing.chromiumPid) && missing.chromiumPid > 1));
  });

  it("waitpid-style status distinguishes signal from exit code", () => {
    assert.equal(waitpidStatus({ exitCode: 1 }).code, 1);
    assert.equal(waitpidStatus({ exitCode: 1 }).signaled, false);
    assert.equal(waitpidStatus({ signal: "SIGTERM" }).signaled, true);
    assert.equal(waitpidStatus({ signal: "SIGTERM" }).code, 143);
    assert.equal(waitpidStatus({ signal: "SIGHUP" }).code, 129);
  });

  it("processIdentity records pid/ppid and whether the parent is alive", () => {
    const id = processIdentity();
    assert.equal(id.pid, process.pid);
    assert.equal(id.ppid, process.ppid);
    assert.equal(id.ppidAlive, true);
  });

  it("pid 1 is a living reaper, not a dead parent; isAlive(1) stays false so we never signal init", () => {
    assert.equal(isAlive(1), false);
    assert.equal(parentAlive(1), true);
    assert.equal(parentAlive(process.ppid), true);
    assert.equal(parentAlive(999999999), false);
  });

  it("qaChromiumLaunchOptions keep handleSIGHUP false and do not add extra disable flags", () => {
    const opts = qaChromiumLaunchOptions();
    assert.equal(opts.handleSIGHUP, false);
    assert.equal(opts.handleSIGINT, false);
    assert.equal(opts.handleSIGTERM, false);
    assert.equal(typeof qaHeaded(), "boolean");
    assert.equal(opts.headless, !qaHeaded());
    assert.equal(
      opts.args.some((a) => /disable-features|no-zygote|single-process/i.test(a)),
      false,
    );
  });

  it("SIGHUP is ignored and heartbeat appears", { timeout: 15000 }, async () => {
    const child = spawn(process.execPath, [CHILD], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, QA_CHILD_MS: "12000" },
    });
    const pid = child.pid;
    assert.ok(pid > 1);
    const closed = new Promise((resolve) => child.once("close", resolve));
    try {
      const hb = heartbeatPath(pid);
      const deadline = Date.now() + 8000;
      while (!existsSync(hb) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(existsSync(hb), true, "heartbeat file missing");
      const before = JSON.parse(readFileSync(hb, "utf8"));
      assert.equal(before.pid, pid);
      process.kill(pid, "SIGHUP");
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(isAlive(pid), true, "SIGHUP killed the harness");
    } finally {
      if (isAlive(pid)) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
      await Promise.race([closed, new Promise((r) => setTimeout(r, 4000))]);
      if (isAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
    assert.equal(isAlive(pid), false);
  });
});

