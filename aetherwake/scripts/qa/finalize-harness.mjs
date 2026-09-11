/**
 * D1.2: single production finalize path for QA harnesses.
 * finalCode starts ok?0:1 and only escalates (never re-lowered to 0).
 * Report failure → 2; other cleanup/sample/timeout failures → 1.
 * Cleanup timeout only force-stops browsers that pass owned-pid check.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function ownedPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (pid === process.pid || pid === process.ppid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
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
 * @param {boolean} opts.ok work-level success flag (does not force exit 0)
 * @param {string|null} [opts.detail]
 * @param {Error|null} [opts.workError] original thrown error — stack preserved
 * @param {() => any} [opts.snapshot] lifecycle snapshot
 * @param {object} [opts.result] payload fields to merge into report
 * @param {any[]} [opts.log]
 * @param {() => Promise<void>} [opts.writeReport] async report writer
 * @param {() => Promise<any>} [opts.waitForSamples] unexpected-close sample await
 * @param {() => Promise<void>} [opts.cleanup] bounded resource cleanup
 * @param {(payload: object) => void} [opts.writeExit]
 * @param {() => void} [opts.dispose]
 * @param {number} [opts.sampleTimeoutMs]
 * @param {number} [opts.cleanupTimeoutMs]
 * @param {number[]} [opts.cleanupExtraPids] extra pids this run owns
 * @param {(ev: object) => void} [opts.appendDiag]
 * @returns {Promise<{finalCode:number, reportErr:string|null, sampleErr:string|null, cleanupErr:string|null, stack:string|null}>}
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
    appendDiag,
  } = opts;

  // D1.2: start from ok; only escalate.
  let finalCode = ok ? 0 : 1;
  const escalate = (code) => {
    if (code > finalCode) finalCode = code;
  };
  const stack = workError?.stack || null;
  let reportErr = null;
  let sampleErr = null;
  let cleanupErr = null;

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
    if (raced && raced.__timeout) {
      diag({ type: "sample-timeout-reached" });
    }
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

  // 3) writeExit — must record the pre-cleanup code, not a later ok
  const exitPayload = {
    exitCode: finalCode,
    error: detail || reportErr || sampleErr || workError?.message || null,
    stack: workError?.stack || (reportErr ? new Error(reportErr).stack : null),
    reportErr,
    sampleErr,
  };
  try {
    writeExit?.(exitPayload);
  } catch (we) {
    escalate(1);
    diag({ type: "write-exit-error", error: String(we?.message || we) });
  }

  // 4) bounded cleanup
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
        // Only stop pids this run owns (not self/parent/init).
        for (const pid of cleanupExtraPids) {
          if (!ownedPidAlive(pid)) continue;
          try {
            process.kill(pid, "SIGTERM");
            diag({ type: "cleanup-timeout-sigterm", pid });
          } catch {
            /* ignore */
          }
        }
      },
    );
    if (raced && raced.__timeout) {
      diag({ type: "cleanup-timeout-reached" });
    }
  }

  try {
    dispose?.();
  } catch {
    escalate(1);
  }

  return { finalCode, reportErr, sampleErr, cleanupErr, stack };
}

/** Convenience: write JSON report to a run dir (throws on EISDIR if path is a directory). */
export function writeJsonReport(runDir, payload) {
  mkdirSync(dirname(runDir), { recursive: true });
  writeFileSync(resolve(runDir), JSON.stringify(payload, null, 2));
}
