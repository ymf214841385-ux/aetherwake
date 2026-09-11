/**
 * D1.2: real child-process + Playwright browser finalizeHarness contract.
 * Imports the production finalizeHarness — not inline demos, not source regex.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isAlive } from "./lifecycle.mjs";

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const FINALIZE = resolve(QA_DIR, "finalize-harness.mjs");
const EXIT_MS = 25000;

function childScript(caseName) {
  // Production import; real chromium; real setInterval heartbeat.
  return `
import { chromium } from "playwright";
import { finalizeHarness } from ${JSON.stringify(FINALIZE)};
import { browserProcessInfo } from ${JSON.stringify(resolve(QA_DIR, "lifecycle.mjs"))};
import { writeFileSync, mkdirSync } from "node:fs";

const caseName = ${JSON.stringify(caseName)};
const runDir = process.env.HX_RUN_DIR;
mkdirSync(runDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const browserPid = browserProcessInfo(browser, { rootPid: process.pid }).chromiumPid ?? null;
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("about:blank");
const hb = setInterval(() => {
  process.stdout.write(JSON.stringify({ type: "hb", t: Date.now() }) + "\\n");
}, 200);
let samplesAwaited = false;
let cleanupRan = false;

const workError =
  caseName === "throw" ? new Error("work-throw-d12") : null;
const ok = caseName === "ok-report-fail" ? true : caseName !== "throw";

const fin = await finalizeHarness({
  ok,
  detail: workError ? String(workError.message) : null,
  workError,
  result: { caseName, browserPid },
  log: [{ t: Date.now(), m: "case " + caseName }],
  writeReport: async (payload) => {
    if (caseName === "ok-report-fail") {
      // Path is a directory → EISDIR. Must escalate to 2, not exit 0.
      writeFileSync(runDir, JSON.stringify(payload));
      return;
    }
    writeFileSync(runDir + "/report.json", JSON.stringify({ ...payload, browserPid }, null, 2));
  },
  waitForSamples: async () => {
    samplesAwaited = true;
    return { reason: { kind: "tab-only", observed: true }, samples: [{ offsetMs: 0 }] };
  },
  cleanup: async () => {
    cleanupRan = true;
    await context.close();
    await browser.close();
  },
  writeExit: (p) => {
    writeFileSync(runDir + "/write-exit.json", JSON.stringify(p));
  },
  dispose: () => clearInterval(hb),
  sampleTimeoutMs: 3000,
  cleanupTimeoutMs: 4000,
  cleanupExtraPids: browserPid ? [browserPid] : [],
});

process.stdout.write(
  JSON.stringify({
    type: "done",
    caseName,
    browserPid,
    finalCode: fin.finalCode,
    reportErr: fin.reportErr,
    samplesAwaited,
    cleanupRan,
  }) + "\\n",
);
process.exit(fin.finalCode);
`;
}

function runCase(caseName) {
  const runDir = mkdtempSync(join(tmpdir(), `hx12-${caseName}-`));
  return new Promise((resolvePromise) => {
    const script = childScript(caseName);
    const t0 = Date.now();
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HX_RUN_DIR: runDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolvePromise({ timedOut: true, runDir, stdout, stderr, elapsedMs: Date.now() - t0 });
    }, EXIT_MS);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const doneLine = stdout
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .find((o) => o && o.type === "done");
      resolvePromise({
        code,
        signal,
        timedOut: false,
        runDir,
        stdout,
        stderr,
        done: doneLine || null,
        elapsedMs: Date.now() - t0,
      });
    });
  });
}

describe("finalizeHarness real browser contract (D1.2)", () => {
  it("success path: exit 0, browser closed", async () => {
    const r = await runCase("ok");
    assert.equal(r.timedOut, false, r.stderr);
    assert.ok(r.done, `no done line stdout=${r.stdout} stderr=${r.stderr}`);
    assert.equal(r.done.samplesAwaited, true);
    assert.equal(r.done.cleanupRan, true);
    assert.equal(r.code, 0, `want 0 got ${r.code} report=${r.done.reportErr} stderr=${r.stderr}`);
    assert.ok(Number.isInteger(r.done.browserPid));
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(isAlive(r.done.browserPid), false, `browser pid ${r.done.browserPid} still alive`);
    assert.ok(existsSync(join(r.runDir, "report.json")));
    rmSync(r.runDir, { recursive: true, force: true });
  });

  it("work throw: non-zero, stack kept, browser closed", async () => {
    const r = await runCase("throw");
    assert.equal(r.timedOut, false, r.stderr);
    assert.ok(r.done, r.stdout);
    assert.notEqual(r.code, 0);
    assert.ok(r.done.browserPid);
    const exitRaw = JSON.parse(
      await import("node:fs").then((fs) => fs.readFileSync(join(r.runDir, "write-exit.json"), "utf8")),
    );
    assert.match(String(exitRaw.stack || ""), /work-throw-d12/);
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(isAlive(r.done.browserPid), false);
    rmSync(r.runDir, { recursive: true, force: true });
  });

  it("ok=true but report write EISDIR: still non-zero (2), browser closed", async () => {
    const r = await runCase("ok-report-fail");
    assert.equal(r.timedOut, false, r.stderr);
    assert.ok(r.done, r.stdout);
    // D1.2: must NOT be 0 when ok=true and report failed
    assert.equal(r.code, 2, `want 2 got ${r.code} reportErr=${r.done.reportErr}`);
    assert.ok(r.done.cleanupRan, "cleanup must run after report fail");
    assert.ok(Number.isInteger(r.done.browserPid));
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(isAlive(r.done.browserPid), false);
    rmSync(r.runDir, { recursive: true, force: true });
  });

  it("sample await runs before cleanup (order flag in report)", async () => {
    const r = await runCase("ok");
    assert.equal(r.timedOut, false);
    const report = JSON.parse(
      await import("node:fs").then((fs) => fs.readFileSync(join(r.runDir, "report.json"), "utf8")),
    );
    assert.equal(report.caseName, "ok");
    assert.ok(r.done.samplesAwaited);
    rmSync(r.runDir, { recursive: true, force: true });
  });

  it("boss-from-sealed calls finalizeHarness and exits fin.finalCode; no flushed=", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(resolve(QA_DIR, "boss-from-sealed.mjs"), "utf8");
    assert.ok(!/\bflushed\s*=/.test(src), "must not assign flushed");
    assert.ok(/finalizeHarness\(/.test(src), "must call production finalizeHarness");
    assert.ok(/process\.exit\(fin\.finalCode\)/.test(src), "must exit with finalize code");
  });
});
