/**
 * D1: close diagnostics. Append-only run evidence. Thin wrappers around
 * page/context/browser.close record timestamp, reason, stack without changing
 * call behavior. After first unexpected page-close, sample browser liveness
 * at 0/1/5/10s then diagnostic-cleanup owned resources only.
 *
 * Root cause fields are observed|unknown — never guessed.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function diagPath(runDir) {
  return resolve(runDir, "close-diag.jsonl");
}

/** Append one JSONL event. Never first-flush-and-drop. */
export function appendDiag(runDir, event) {
  mkdirSync(runDir, { recursive: true });
  const row = { t: Date.now(), ...event };
  try {
    appendFileSync(diagPath(runDir), JSON.stringify(row) + "\n");
  } catch {
    /* ignore */
  }
  return row;
}

/**
 * Thin wrapper: same await/return as the original close, plus evidence.
 * Does not swallow errors.
 */
export function wrapClose(fn, label, runDir, getFlags) {
  return async function wrappedClose(...args) {
    const stack = new Error(`close-${label}`).stack;
    appendDiag(runDir, {
      type: "harness-close-call",
      target: label,
      reason: "active-close",
      intentional: Boolean(getFlags?.()?.intentionalTeardown),
      stack,
    });
    try {
      return await fn.apply(this, args);
    } catch (err) {
      appendDiag(runDir, {
        type: "harness-close-error",
        target: label,
        error: String(err?.message || err),
        stack: err?.stack || stack,
      });
      throw err;
    }
  };
}

export function instrumentClosers(page, context, browser, runDir, getFlags) {
  if (page && typeof page.close === "function") {
    page.close = wrapClose(page.close.bind(page), "page.close", runDir, getFlags);
  }
  if (context && typeof context.close === "function") {
    context.close = wrapClose(context.close.bind(context), "context.close", runDir, getFlags);
  }
  if (browser && typeof browser.close === "function") {
    browser.close = wrapClose(browser.close.bind(browser), "browser.close", runDir, getFlags);
  }
  return { page, context, browser };
}

export function chromiumPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * After first unexpected page-close: stop input, sample at 0,1,5,10s.
 * Returns samples. Caller then diagnostic-cleanup.
 */
export async function sampleAfterUnexpectedClose(
  { browser, context, page, chromiumPid, runDir },
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const marks = [0, 1000, 5000, 10000];
  const samples = [];
  const t0 = Date.now();
  for (const ms of marks) {
    const waitMs = ms - (Date.now() - t0);
    if (waitMs > 0) await wait(waitMs);
    let connected = false;
    let pages = null;
    try {
      connected = Boolean(browser?.isConnected?.());
    } catch {
      connected = false;
    }
    try {
      pages = context?.pages?.()?.length ?? null;
    } catch {
      pages = null;
    }
    const alive = chromiumPidAlive(chromiumPid);
    const row = {
      type: "post-close-sample",
      offsetMs: ms,
      elapsedMs: Date.now() - t0,
      browserConnected: connected,
      contextPageCount: pages,
      chromiumPid,
      chromiumPidAlive: alive,
      pageClosed: Boolean(page && page.isClosed && page.isClosed()),
    };
    samples.push(row);
    appendDiag(runDir, row);
  }
  return samples;
}

/**
 * Classify first unexpected close from observed flags only.
 * kind: tab-only | browser-lost | crash | unknown
 */
export function classifyUnexpectedClose(flags, samples) {
  const crashed = Boolean(flags?.crashed);
  const browserGone = Boolean(flags?.browserDisconnected) ||
    (samples && samples.length && samples[samples.length - 1].browserConnected === false);
  const chromiumDead = samples && samples.length && samples[samples.length - 1].chromiumPidAlive === false;
  if (crashed) return { kind: "crash", observed: true };
  if (browserGone || chromiumDead) return { kind: "browser-lost", observed: true };
  if (flags?.pageClosed && samples?.[0]?.browserConnected) {
    // browser still connected at 0ms after page-close
    const stillAtEnd = samples[samples.length - 1]?.browserConnected;
    if (stillAtEnd) return { kind: "tab-only", observed: true };
  }
  return { kind: "unknown", observed: true };
}

export async function diagnosticCleanup(
  { context, browser, runDir, flags, closeReason },
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  appendDiag(runDir, {
    type: "diagnostic-cleanup-start",
    closeReason: closeReason || null,
    flags: flags?.snapshot ? flags.snapshot() : flags,
  });
  if (flags) flags.intentionalTeardown = true;
  try {
    if (context && !context._closed) await context.close();
  } catch (err) {
    appendDiag(runDir, { type: "cleanup-error", target: "context", error: String(err?.message || err) });
  }
  try {
    if (browser?.isConnected?.()) await browser.close();
  } catch (err) {
    appendDiag(runDir, { type: "cleanup-error", target: "browser", error: String(err?.message || err) });
  }
  await wait(200);
  appendDiag(runDir, { type: "diagnostic-cleanup-done" });
}
