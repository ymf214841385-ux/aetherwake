#!/usr/bin/env node
/**
 * Short failure-oriented browser lifecycle repro.
 * Does not disable extra Chromium safety. Does not claim a root cause for 94375.
 *
 * Cases:
 *   watcher-kill   — SIGTERM a sibling watcher; page must stay
 *   node-sighup    — SIGHUP the Node harness; page must stay (handleSIGHUP=false + ignore)
 *   chromium-hup   — SIGHUP the Chromium pid; expect page.close while Node still alive
 *   parent-exit    — non-detached child Node exits without teardown; record whether Chromium dies
 *
 * Output: JSON on stdout. Exit 0 even when a case reproduces page.close (that is the point).
 */
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import {
  bindCloseTracking,
  classifyClose,
  installHarnessLifetime,
  isAlive,
  parentAlive,
  processIdentity,
  qaChromiumLaunchOptions,
  qaHeaded,
  stateDir,
} from "./lifecycle.mjs";

const CASE = process.env.QA_LIFE_CASE || "all";
const HOLD_MS = Math.max(800, Number(process.env.QA_LIFE_HOLD_MS || 2500) || 2500);

function psRow(pid) {
  if (!pid || pid <= 1) return null;
  try {
    const text = execFileSync("ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid=,sess="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parts = text.split(/\s+/).map((n) => Number.parseInt(n, 10));
    return { pid: parts[0], ppid: parts[1], pgid: parts[2], sess: parts[3] };
  } catch {
    return { pid, dead: true };
  }
}

async function withBrowser(fn) {
  const life = installHarnessLifetime({ lastNote: "lifecycle-repro" });
  const browser = await chromium.launch(qaChromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const flags = bindCloseTracking(page, page.context(), browser);
  await page.goto("data:text/html,<html><body>qa-life</body></html>");
  const proc = browser.process();
  const chromiumPid = proc?.pid ?? null;
  life.setChromiumPid(chromiumPid);
  const started = {
    headed: qaHeaded(),
    harness: processIdentity(),
    chromium: psRow(chromiumPid),
    parentAlive: parentAlive(process.ppid),
    handleSIGHUP: false,
  };
  try {
    const result = await fn({ browser, page, flags, chromiumPid, life });
    return { started, flags: { ...flags }, result };
  } finally {
    flags.intentionalTeardown = true;
    try {
      await browser.close();
    } catch {
      /* already gone */
    }
    life.dispose();
  }
}

async function holdKeys(page, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (page.isClosed()) return { closedDuringHold: true };
    try {
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(120);
      await page.keyboard.up("KeyW");
    } catch (err) {
      return { closedDuringHold: true, error: err?.message || String(err) };
    }
  }
  return { closedDuringHold: page.isClosed() };
}

async function caseWatcherKill() {
  return withBrowser(async ({ page, flags, chromiumPid }) => {
    const watcher = spawn(process.execPath, ["-e", "setInterval(()=>{}, 200)"], {
      stdio: "ignore",
    });
    const wpid = watcher.pid;
    await holdKeys(page, HOLD_MS);
    const before = { pageClosed: flags.pageClosed, chromiumAlive: isAlive(chromiumPid), watcherAlive: isAlive(wpid) };
    try {
      process.kill(wpid, "SIGTERM");
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
    const afterHold = await holdKeys(page, HOLD_MS);
    return {
      case: "watcher-kill",
      before,
      after: {
        pageClosed: flags.pageClosed,
        chromiumAlive: isAlive(chromiumPid),
        watcherAlive: isAlive(wpid),
        pageIsClosed: page.isClosed(),
        hold: afterHold,
      },
      pageStayedOpen: !flags.pageClosed && !page.isClosed() && isAlive(chromiumPid),
    };
  });
}

async function caseNodeSighup() {
  return withBrowser(async ({ page, flags, chromiumPid, life }) => {
    await holdKeys(page, HOLD_MS);
    process.kill(process.pid, "SIGHUP");
    await new Promise((r) => setTimeout(r, 300));
    const hold = await holdKeys(page, HOLD_MS);
    return {
      case: "node-sighup",
      signals: life.state.signals,
      pageClosed: flags.pageClosed,
      chromiumAlive: isAlive(chromiumPid),
      pageIsClosed: page.isClosed(),
      hold,
      pageStayedOpen: !flags.pageClosed && !page.isClosed() && isAlive(chromiumPid),
      nodeStillAlive: true,
    };
  });
}

async function caseChromiumHup() {
  return withBrowser(async ({ page, flags, chromiumPid }) => {
    await holdKeys(page, 800);
    const before = {
      pageClosed: flags.pageClosed,
      chromiumAlive: isAlive(chromiumPid),
      chromium: psRow(chromiumPid),
    };
    if (chromiumPid && isAlive(chromiumPid)) {
      try {
        process.kill(chromiumPid, "SIGHUP");
      } catch (err) {
        return { case: "chromium-hup", error: err?.message || String(err), before };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
    let hold = null;
    try {
      hold = await holdKeys(page, 800);
    } catch (err) {
      hold = { error: err?.message || String(err) };
    }
    const reason = classifyClose({
      ...flags,
      errorMessage: hold?.error || "keyboard after chromium SIGHUP",
    });
    return {
      case: "chromium-hup",
      before,
      after: {
        pageClosed: flags.pageClosed,
        crashed: flags.crashed,
        browserDisconnected: flags.browserDisconnected,
        chromiumAlive: isAlive(chromiumPid),
        pageIsClosed: page.isClosed(),
        hold,
        closeReason: reason,
      },
      matches94375Fingerprint:
        Boolean(flags.pageClosed || reason?.kind === "page.close" || /has been closed/i.test(hold?.error || "")) &&
        isAlive(process.pid),
      nodeStillAlive: true,
    };
  });
}

async function caseParentExit() {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
      import { chromium } from "playwright";
      import { writeFileSync } from "node:fs";
      import { qaChromiumLaunchOptions } from ${JSON.stringify(new URL("./lifecycle.mjs", import.meta.url).pathname)};
      const browser = await chromium.launch(qaChromiumLaunchOptions());
      const page = await browser.newPage();
      await page.goto("data:text/html,ok");
      const pid = browser.process()?.pid;
      writeFileSync(process.env.QA_LIFE_PIDS, JSON.stringify({ node: process.pid, chromium: pid, ppid: process.ppid }));
      setInterval(() => {}, 1000);
      `,
    ],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      env: { ...process.env, QA_LIFE_PIDS: `${stateDir()}/life-parent-exit-pids.json` },
    },
  );
  const nodePid = child.pid;
  const pidFile = `${stateDir()}/life-parent-exit-pids.json`;
  const deadline = Date.now() + 12000;
  let pids = null;
  while (Date.now() < deadline) {
    try {
      pids = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(pidFile, "utf8")));
      if (pids?.chromium) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const beforeKill = { nodeAlive: isAlive(nodePid), chromiumAlive: isAlive(pids?.chromium), pids, node: psRow(nodePid), chromium: psRow(pids?.chromium) };
  try {
    process.kill(nodePid, "SIGKILL");
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 800));
  const after = {
    nodeAlive: isAlive(nodePid),
    chromiumAlive: isAlive(pids?.chromium),
    chromium: psRow(pids?.chromium),
  };
  if (after.chromiumAlive && pids?.chromium) {
    try {
      process.kill(pids.chromium, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
  return {
    started: { headed: qaHeaded(), parent: processIdentity() },
    result: {
      case: "parent-exit",
      beforeKill,
      after,
      chromiumDiedWithNonDetachedParent: beforeKill.chromiumAlive && !after.chromiumAlive,
    },
  };
}

const out = { t: Date.now(), headed: qaHeaded(), cases: {} };
if (CASE === "all" || CASE === "watcher-kill") out.cases.watcherKill = await caseWatcherKill();
if (CASE === "all" || CASE === "node-sighup") out.cases.nodeSighup = await caseNodeSighup();
if (CASE === "all" || CASE === "chromium-hup") out.cases.chromiumHup = await caseChromiumHup();
if (CASE === "all" || CASE === "parent-exit") out.cases.parentExit = await caseParentExit();

const jsonPath = `${stateDir()}/lifecycle-browser-repro.json`;
writeFileSync(jsonPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: true, json: jsonPath, headed: out.headed, summary: {
  watcherPageStayed: out.cases.watcherKill?.result?.pageStayedOpen ?? null,
  nodeSighupPageStayed: out.cases.nodeSighup?.result?.pageStayedOpen ?? null,
  chromiumHupMatches94375: out.cases.chromiumHup?.result?.matches94375Fingerprint ?? null,
  parentExitKillsChromium: out.cases.parentExit?.result?.chromiumDiedWithNonDetachedParent ?? null,
} }, null, 2));
