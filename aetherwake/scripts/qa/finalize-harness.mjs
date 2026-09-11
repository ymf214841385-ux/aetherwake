/**
 * D1.2/D1.3: single production finalize path for QA harnesses.
 * finalCode starts ok?0:1 and only escalates (never re-lowered to 0).
 * Report failure → 2; other cleanup/sample/timeout failures → 1.
 *
 * D1.3 A: cleanup-timeout may only SIGTERM a pid that is a live descendant
 * of this harness AND whose cmdline looks like Chromium. Unverified pids are
 * recorded and never signaled — cleanupExtraPids alone is not ownership.
 * D1.3 B: pre-cleanup code is a diag event only; final writeExit runs after
 * cleanup+dispose so recorded exitCode equals the process exit code.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { descendantPids, findChromiumPid, isAlive } from "./lifecycle.mjs";

/**
 * Prove a pid is this harness's Chromium (descendant + cmdline), not merely alive.
 * @param {number} pid
 * @param {number} [rootPid]
 * @returns {{ok:boolean, reason:string, pid:number, cmdline?:string|null}}
 */
export function isHarnessOwnedBrowserPid(pid, rootPid = process.pid) {
  if (!Number.isInteger(pid) || pid <= 1) return { ok: false, reason: "invalid-pid", pid };
  if (pid === process.pid || pid === process.ppid) {
    return { ok: false, reason: "self-or-parent", pid };
  }
  if (!isAlive(pid)) return { ok: false, reason: "not-alive", pid };
  let kids = [];
  try {
    kids = descendantPids(rootPid) || [];
  } catch {
    return { ok: false, reason: "descendant-scan-failed", pid };
  }
  if (!kids.includes(pid)) {
    // Also accept the known main chromium under this root.
    const main = findChromiumPid(rootPid);
    if (main !== pid) return { ok: false, reason: "unverified-not-descendant", pid };
  }
  let cmdline = "";
  try {
    cmdline = String(
      // readCmdline is not exported; findChromiumPid already used cmdline match.
      // Re-check via /proc-like ps is best-effort through child_process-free path:
      // lifecycle.findChromiumPid only returns chrome-like descendants.
      "",
    );
  } catch {
    cmdline = "";
  }
  // If findChromiumPid returned this pid, cmdline is chrome-like by definition.
  const main = findChromiumPid(rootPid);
  if (main === pid) return { ok: true, reason: "descendant-chromium", pid, cmdline: "chromium" };
  // Non-main descendant: still refuse unless chrome-like (no cmdline API exported).
  return { ok: false, reason: "unverified-cmdline", pid, cmdline: cmdline || null };
}

function withTimeout(promise, ms, onTimeout) {
  let timer = null;
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        /* ignore */
      }
      resolveTimeout({ __timeout: true });
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * @param {object} opts
 * @param {boolean} opts.ok
 * @param {string|null} [opts.detail]
 * @param {Error|null} [opts.workError]
 * @param {() => any} [opts.snapshot]
 * @param {object} [opts.result]
 * @param {any[]} [opts.log]
 * @param {() => Promise<void>} [opts.writeReport]
 * @param {() => Promise<any>} [opts.waitForSamples]
 * @param {() => Promise<void>} [opts.cleanup]
 * @param {(payload: object) => void} [opts.writeExit] final writeExit (after cleanup)
 * @param {() => void} [opts.dispose]
 * @param {number} [opts.sampleTimeoutMs]
 * @param {number} [opts.cleanupTimeoutMs]
 * @param {number[]} [opts.cleanupExtraPids] candidates only — still need ownership proof
 * @param {(pid:number) => {ok:boolean, reason:string}} [opts.verifyOwnedBrowser]
 * @param {(ev: object) => void} [opts.appendDiag]
 */
export async function finalizeHarness(opts) {
  const {
    ok = false,
    detail = null,
    workError = null,
    snapshot,
    result = {},
    log = [],
    writeReport,
    waitForSamples,
    cleanup,
    writeExit,
    dispose,
    sampleTimeoutMs = 12000,
    cleanupTimeoutMs = 5000,
    cleanupExtraPids = [],
    verifyOwnedBrowser = (pid) => isHarnessOwnedBrowserPid(pid),
    appendDiag,
  } = opts;

  let finalCode = ok ? 0 : 1;
  const escalate = (code) => {
    if (code > finalCode) finalCode = code;
  };
  const stack = workError?.stack || null;
  let reportErr = null;
  let sampleErr = null;
  let cleanupErr = null;
  let disposeErr = null;

  const diag = (event) => {
    try {
      appendDiag?.(event);
    } catch {
      /* ignore */
    }
  };

  // 1) await unexpected-close samples (cancelable timeout)
  if (waitForSamples) {
    const raced = await withTimeout(
      Promise.resolve()
        .then(() => waitForSamples())
        .catch((e) => {
          sampleErr = String(e?.message || e);
          escalate(1);
          return { __sampleFailed: true, error: sampleErr };
        }),
      sampleTimeoutMs,
      () => {
        sampleErr = `sample-timeout-${sampleTimeoutMs}ms`;
        escalate(1);
        diag({ type: "sample-timeout", ms: sampleTimeoutMs });
      },
    );
    if (raced && raced.__timeout) diag({ type: "sample-timeout-reached" });
  }

  // 2) write report — failure escalates to 2, never blocks cleanup
  let life = null;
  try {
    life = typeof snapshot === "function" ? snapshot() : snapshot || null;
    if (writeReport) {
      await writeReport({ ...result, lifecycle: life, log, detail, stack });
    }
  } catch (we) {
    reportErr = String(we?.message || we);
    escalate(2);
    diag({ type: "report-write-error", error: reportErr, stack: we?.stack || null });
  }

  // D1.3 B: pre-cleanup snapshot is diag only — not the process exit record.
  diag({
    type: "pre-cleanup-exit-code",
    exitCode: finalCode,
    reportErr,
    sampleErr,
  });

  // 3) bounded cleanup — ownership required before any force-kill
  if (cleanup) {
    const raced = await withTimeout(
      Promise.resolve()
        .then(() => cleanup())
        .catch((e) => {
          cleanupErr = String(e?.message || e);
          escalate(1);
        }),
      cleanupTimeoutMs,
      () => {
        cleanupErr = `cleanup-timeout-${cleanupTimeoutMs}ms`;
        escalate(1);
        for (const pid of cleanupExtraPids) {
          const check = verifyOwnedBrowser(pid);
          if (!check?.ok) {
            diag({ type: "cleanup-kill-refused", pid, reason: check?.reason || "unverified" });
            continue;
          }
          try {
            process.kill(pid, "SIGTERM");
            diag({ type: "cleanup-timeout-sigterm", pid, reason: check.reason });
          } catch {
            /* ignore */
          }
        }
      },
    );
    if (raced && raced.__timeout) diag({ type: "cleanup-timeout-reached" });
  }

  // 4) dispose heartbeat — failure also escalates
  try {
    dispose?.();
  } catch (e) {
    disposeErr = String(e?.message || e);
    escalate(1);
    diag({ type: "dispose-error", error: disposeErr });
  }

  // D1.3 B: final writeExit AFTER cleanup+dispose so record == process code.
  const exitPayload = {
    exitCode: finalCode,
    error: detail || reportErr || sampleErr || cleanupErr || disposeErr || workError?.message || null,
    stack: workError?.stack || (reportErr ? new Error(reportErr).stack : null),
    reportErr,
    sampleErr,
    cleanupErr,
    disposeErr,
    phase: "final",
  };
  try {
    writeExit?.(exitPayload);
  } catch (we) {
    escalate(1);
    diag({ type: "write-exit-error", error: String(we?.message || we) });
  }

  return { finalCode, reportErr, sampleErr, cleanupErr, disposeErr, stack };
}

export function writeJsonReport(runDir, payload) {
  mkdirSync(dirname(runDir), { recursive: true });
  writeFileSync(resolve(runDir), JSON.stringify(payload, null, 2));
}
