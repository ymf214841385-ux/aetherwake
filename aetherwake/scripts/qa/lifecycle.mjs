/**
 * Owned QA process handles + Playwright close classification.
 *
 * Rules:
 * - Start/stop only the pid we spawned. Never kill pid<=1, self, parent, or a
 *   pid whose pid-file / cmdline does not match this handle.
 * - Pid file and log file are keyed on the child pid.
 * - Unique ports in 8101–8199 by default. Never steal 8080/8081/8091.
 * - page.close / browser close is classified (classifyClose) and is a failure
 *   unless the harness has entered intentional teardown.
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const AETHERWAKE_ROOT = join(QA_DIR, "..", "..");
const STATE_DIR = join(AETHERWAKE_ROOT, ".grok");

export const POINTER_LOCK_RE = /pointer lock/i;
export const CLOSED_PAGE_RE =
  /Target page, context or browser has been closed|Target closed|Target destroyed|has been closed/i;

export const PORT_MIN = 8101;
export const PORT_MAX = 8199;
/** Shared ports other workers / the live preview may own. Do not steal. */
export const SHARED_PORTS = new Set([8080, 8081, 8091]);

export function projectRoot() {
  return AETHERWAKE_ROOT;
}

export function stateDir() {
  return STATE_DIR;
}

export function isPointerLockNoise(msg) {
  return POINTER_LOCK_RE.test(String(msg ?? ""));
}

export function partitionPageErrors(errors) {
  const pointerLockNoise = [];
  const realErrors = [];
  for (const e of errors || []) {
    (isPointerLockNoise(e) ? pointerLockNoise : realErrors).push(e);
  }
  return { pointerLockNoise, realErrors };
}

export function isClosedPageMessage(msg) {
  return CLOSED_PAGE_RE.test(String(msg ?? ""));
}

/**
 * Classify a Playwright teardown from recorded events + the thrown message.
 * Never returns "oom" or "hmr" — those are not observed signals.
 *
 * @param {{
 *   pageClosed?: boolean,
 *   contextClosed?: boolean,
 *   browserDisconnected?: boolean,
 *   crashed?: boolean,
 *   inspector?: boolean,
 *   errorMessage?: string | null,
 *   intentionalTeardown?: boolean,
 * }} flags
 */
export function classifyClose(flags = {}) {
  const message = flags.errorMessage ? String(flags.errorMessage) : "";
  if (flags.intentionalTeardown) {
    return {
      kind: "intentional-teardown",
      detail: "harness closed the page/browser after writing the report",
      message,
    };
  }
  if (flags.crashed) {
    return { kind: "crash", detail: "page.crash event", message: message || "page.crash" };
  }
  if (flags.inspector || /Inspector/i.test(message)) {
    return { kind: "inspector", detail: "inspector", message: message || "inspector" };
  }
  if (flags.pageClosed) {
    return { kind: "page.close", detail: "page.close event", message };
  }
  if (flags.contextClosed) {
    return { kind: "context.close", detail: "context.close event", message };
  }
  if (flags.browserDisconnected) {
    return { kind: "browser.disconnected", detail: "browser disconnected", message };
  }
  if (isClosedPageMessage(message)) {
    return {
      kind: "target-destroyed",
      detail: "playwright target destroyed (no close/crash event recorded)",
      message,
    };
  }
  return null;
}

/** Unexpected close is a contract failure. Intentional teardown is not. */
export function unexpectedCloseFailure(closeReason) {
  if (!closeReason) return null;
  if (closeReason.kind === "intentional-teardown") return null;
  return {
    id: "close",
    expected: "session stays open until harness teardown",
    actual: closeReason.kind,
    detail: closeReason.detail || closeReason.message || closeReason.kind,
  };
}

export class ClosedPageError extends Error {
  /**
   * @param {{ kind: string, detail: string, message?: string }} reason
   */
  constructor(reason) {
    super(reason.message || reason.detail || "page closed");
    this.name = "ClosedPageError";
    this.closeReason = reason;
  }
}

export function bindCloseTracking(page, context, browser) {
  const flags = {
    pageClosed: false,
    contextClosed: false,
    browserDisconnected: false,
    crashed: false,
    inspector: false,
    intentionalTeardown: false,
    /** Ordered lifecycle events — do not collapse to page-close. */
    events: [],
    startedAt: Date.now(),
  };
  const push = (type, extra) => {
    flags.events.push({ t: Date.now(), type, intentional: Boolean(flags.intentionalTeardown), ...(extra || {}) });
  };
  if (page) {
    page.on("close", () => {
      flags.pageClosed = true;
      push("page-close");
    });
    page.on("crash", () => {
      flags.crashed = true;
      push("page-crash");
    });
  }
  if (context) {
    context.on("close", () => {
      flags.contextClosed = true;
      push("context-close");
    });
  }
  if (browser) {
    browser.on("disconnected", () => {
      flags.browserDisconnected = true;
      push("browser-disconnected");
    });
  }
  /** Snapshot flags + event order for JSON evidence. Call BEFORE context.close(). */
  flags.snapshot = () => ({
    pageClosed: flags.pageClosed,
    contextClosed: flags.contextClosed,
    browserDisconnected: flags.browserDisconnected,
    crashed: flags.crashed,
    inspector: flags.inspector,
    intentionalTeardown: flags.intentionalTeardown,
    events: flags.events.map((e) => ({ ...e })),
    elapsedMs: Date.now() - flags.startedAt,
    order: flags.events.map((e) => e.type).join(">"),
  });
  return flags;
}

export function parsePid(text) {
  const pid = Number.parseInt(String(text ?? "").trim(), 10);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

export function isAlive(pid) {
  if (!pid || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * Parent liveness for heartbeat evidence. pid 1 is init/launchd — the
 * successful detach reaper — not a "dead parent" that caused page.close.
 * Never used as a kill target (assertOwned* still refuse pid<=1).
 */
export function parentAlive(ppid) {
  if (ppid === 1) return true;
  return isAlive(ppid);
}

export function qaHeaded() {
  return process.env.QA_HEADED === "1";
}

/** Same launch flags as play-routes / stability. Does not disable extra Chromium safety. */
export function qaChromiumLaunchOptions() {
  // Opt-in project-local persistent profile (QA_PROFILE=1). Default remains
  // ephemeral: userDataDir + headed launch hung (chromiumAlive=false, lastNote=boot).
  const opts = {
    headless: !qaHeaded(),
    timeout: 0,
    protocolTimeout: 3_600_000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu-watchdog",
      "--disable-hang-monitor",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--enable-unsafe-swiftshader",
    ],
  };
  if (process.env.QA_PROFILE === "1") {
    const profileDir = join(stateDir(), "chromium-profile");
    mkdirSync(profileDir, { recursive: true });
    opts.userDataDir = profileDir;
  }
  return opts;
}

export function pathsForPid(name, pid) {
  return {
    pidFile: join(STATE_DIR, `${name}-${pid}.pid`),
    logFile: join(STATE_DIR, `${name}-${pid}.log`),
    jsonFile: join(STATE_DIR, `${name}-${pid}.json`),
  };
}

export function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

/**
 * Pick a free loopback port. Will not steal 8080/8081/8091 unless `preferred`
 * is set explicitly (and even then, busy preferred ports are a hard fail).
 */
export async function pickFreePort({ preferred, min = PORT_MIN, max = PORT_MAX } = {}) {
  if (preferred != null) {
    const p = Number(preferred);
    if (!Number.isInteger(p) || p <= 0) throw new Error(`invalid preferred port: ${preferred}`);
    if (!(await portFree(p))) {
      throw new Error(`requested port ${p} is busy (will not steal)`);
    }
    return p;
  }
  for (let p = min; p <= max; p++) {
    if (SHARED_PORTS.has(p)) continue;
    if (await portFree(p)) return p;
  }
  throw new Error(`no free QA port in ${min}-${max}`);
}

export function readCmdline(pid) {
  if (!pid || pid <= 1) return "";
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function looksLikeOwnedServer(cmdline, handle = {}) {
  const cmd = String(cmdline ?? "");
  if (!cmd) return false;
  const kind = handle.kind || "fixture";
  if (kind === "fixture") return cmd.includes("fixture-server.mjs");
  if (kind === "preview") return /\bvite\b/.test(cmd) && /\bpreview\b/.test(cmd);
  if (kind === "dev") return /\bvite\b/.test(cmd) && /\bdev\b/.test(cmd);
  if (handle.port) return cmd.includes(String(handle.port));
  return false;
}

export function descendantPids(rootPid) {
  let text = "";
  try {
    text = execFileSync("ps", ["-axo", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const byParent = new Map();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    if (!byParent.has(ppid)) byParent.set(ppid, []);
    byParent.get(ppid).push(pid);
  }
  const out = [];
  const stack = [rootPid];
  const seen = new Set([rootPid]);
  while (stack.length) {
    const cur = stack.pop();
    for (const child of byParent.get(cur) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

function refuseKill(pid, reason) {
  return { ok: false, killed: false, pid, error: reason };
}

/**
 * Ownership gate. A pid is ours only if:
 * - pid > 1 and not this process / parent
 * - pid-file (when present) still contains this pid
 * - live cmdline still looks like the server we spawned
 */
export function assertOwnedPid(handle = {}) {
  const pid = Number(handle.pid);
  if (!Number.isInteger(pid) || pid <= 1) return refuseKill(pid, "refused pid<=1 or invalid");
  if (pid === process.pid) return refuseKill(pid, "refused to signal self");
  if (pid === process.ppid) return refuseKill(pid, "refused to signal parent");
  if (handle.pidFile) {
    if (!existsSync(handle.pidFile)) return refuseKill(pid, "pid file missing; refusing to kill");
    let onDisk = null;
    try {
      onDisk = parsePid(readFileSync(handle.pidFile, "utf8"));
    } catch {
      onDisk = null;
    }
    if (onDisk !== pid) return refuseKill(pid, `pid file mismatch (${onDisk} != ${pid}); refusing to kill`);
  } else {
    return refuseKill(pid, "no pid file; refusing to kill");
  }
  if (!isAlive(pid)) return { ok: true, alreadyDead: true, pid };
  const cmd = readCmdline(pid);
  if (!looksLikeOwnedServer(cmd, handle)) {
    return refuseKill(pid, `cmdline is not our server: ${cmd || "(empty)"}`);
  }
  return { ok: true, pid, cmdline: cmd };
}

function signalPid(pid, signal) {
  if (!pid || pid <= 1 || pid === process.pid || pid === process.ppid) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pids, timeoutMs, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let live = pids.filter(isAlive);
  while (live.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    live = live.filter(isAlive);
  }
  return live;
}

function cleanupStateFiles(handle) {
  for (const p of [handle.pidFile, handle.jsonFile]) {
    if (p) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Stop a server we spawned. Never kills a pid we do not own.
 * @param {object} handle from spawnOwnedServer
 */
export async function stopOwnedServer(handle = {}, { graceMs = 2500 } = {}) {
  if (!handle || handle.owned === false) {
    return { ok: true, skipped: true, detail: "handle is not owned by this harness" };
  }
  const gate = assertOwnedPid(handle);
  if (!gate.ok) return gate;
  const pid = handle.pid;
  if (gate.alreadyDead) {
    cleanupStateFiles(handle);
    return { ok: true, alreadyDead: true, pid };
  }

  const kids = descendantPids(pid).filter((p) => p > 1 && p !== process.pid && p !== process.ppid);
  const tree = [...kids, pid];
  for (const p of tree) signalPid(p, "SIGTERM");
  let live = await waitDead(tree, graceMs);
  for (const p of live) signalPid(p, "SIGKILL");
  live = await waitDead(live, Math.min(1500, graceMs));
  cleanupStateFiles(handle);
  if (handle.child && typeof handle.child.unref === "function") {
    try {
      handle.child.unref();
    } catch {
      /* ignore */
    }
  }
  return {
    ok: live.length === 0,
    pid,
    stopped: tree.filter((p) => !live.includes(p)),
    stubborn: live,
    error: live.length ? `still alive: ${live.join(",")}` : undefined,
  };
}

export async function waitHttpReady(url, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let failure = null;
  const onError = (err) => {
    failure = err?.message || String(err);
  };
  const onExit = (code, signal) => {
    failure = `exited early (${signal ?? `code ${code}`})`;
  };
  if (child) {
    child.once("error", onError);
    child.once("exit", onExit);
  }
  try {
    while (Date.now() < deadline && !failure) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
        if (res.ok || res.status === 404) return { ok: true, status: res.status };
      } catch {
        await new Promise((r) => setTimeout(r, 80));
      }
    }
    return { ok: false, error: failure ?? `nothing answered on ${url}` };
  } finally {
    if (child) {
      child.off("error", onError);
      child.off("exit", onExit);
    }
  }
}

function binPath(root) {
  return join(root, "node_modules", ".bin");
}

/**
 * Spawn a server this harness owns.
 *
 * @param {{
 *   kind?: "fixture" | "preview" | "dev",
 *   name?: string,
 *   port?: number,
 *   detach?: boolean,
 *   newSession?: boolean,
 *   readyTimeoutMs?: number,
 *   cwd?: string,
 *   delayMs?: number,
 * }} opts
 */
export async function spawnOwnedServer(opts = {}) {
  const kind = opts.kind || "fixture";
  const name = opts.name || `qa-${kind}`;
  const detach = Boolean(opts.detach);
  const newSession = Boolean(opts.newSession ?? detach);
  const cwd = opts.cwd || AETHERWAKE_ROOT;
  const readyTimeoutMs = opts.readyTimeoutMs ?? (kind === "fixture" ? 8000 : 60000);
  mkdirSync(STATE_DIR, { recursive: true });

  const port = await pickFreePort({ preferred: opts.port });
  const url = `http://127.0.0.1:${port}/`;
  const pendingLog = join(STATE_DIR, `${name}-pending-${process.pid}-${Date.now()}.log`);
  const logFd = openSync(pendingLog, "a");

  let command = process.execPath;
  let args;
  const env = {
    ...process.env,
    BROWSER: "none",
    QA_LISTEN_PORT: String(port),
    PATH: `${binPath(cwd)}:${process.env.PATH || ""}`,
  };
  if (opts.delayMs) env.QA_LISTEN_DELAY_MS = String(opts.delayMs);

  if (kind === "fixture") {
    args = [join(QA_DIR, "fixture-server.mjs"), String(port)];
  } else if (kind === "preview") {
    args = [
      join(cwd, "scripts", "with-app-env.mjs"),
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ];
  } else if (kind === "dev") {
    args = [
      join(cwd, "scripts", "with-app-env.mjs"),
      "vite",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ];
  } else {
    closeSync(logFd);
    throw new Error(`unknown server kind: ${kind}`);
  }

  const child = spawn(command, args, {
    cwd,
    detached: detach || newSession,
    stdio: ["ignore", logFd, logFd],
    env,
  });
  try {
    closeSync(logFd);
  } catch {
    /* already closed */
  }

  const pid = child.pid;
  if (!pid || pid <= 1) {
    try {
      rmSync(pendingLog, { force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, error: "spawn returned invalid pid", owned: false };
  }

  const paths = pathsForPid(name, pid);
  try {
    renameSync(pendingLog, paths.logFile);
  } catch {
    writeFileSync(paths.logFile, "");
  }
  writeFileSync(paths.pidFile, `${pid}\n`);
  const handle = {
    ok: true,
    owned: true,
    kind,
    name,
    pid,
    port,
    url,
    detach,
    newSession: detach || newSession,
    ownerPid: process.pid,
    startedAt: Date.now(),
    cmdline: [command, ...args],
    pidFile: paths.pidFile,
    logFile: paths.logFile,
    jsonFile: paths.jsonFile,
    child,
  };
  writeFileSync(paths.jsonFile, JSON.stringify({ ...handle, child: undefined }, null, 2));

  const ready = await waitHttpReady(url, child, readyTimeoutMs);
  if (!ready.ok) {
    const stopped = await stopOwnedServer(handle);
    return { ok: false, error: ready.error, stopped, pid, port, url, logFile: paths.logFile, pidFile: paths.pidFile };
  }

  // Detached CLI start: survive the start command exiting. In-process harness
  // (play-routes / stability) may still spawn the server in a new session
  // (setsid) so a dying tool TTY cannot SIGHUP it, but it keeps the child
  // handle and does NOT unref.
  if (detach) child.unref();

  return handle;
}

/**
 * Attach a Playwright browser process handle for logs. Does not unref.
 * `browser.process()` is often null in out-of-process Playwright; always
 * fall back to a descendant scan so logs never have to print chromium=?.
 */
export function browserProcessInfo(browser, { rootPid = process.pid } = {}) {
  let proc = null;
  try {
    proc = typeof browser?.process === "function" ? browser.process() : null;
  } catch {
    proc = null;
  }
  const fromApi = Number.isInteger(proc?.pid) && proc.pid > 1 ? proc.pid : null;
  const fromTree = fromApi ? null : findChromiumPid(rootPid);
  const chromiumPid = fromApi || fromTree;
  return {
    chromiumPid: chromiumPid ?? null,
    connected: typeof browser?.isConnected === "function" ? browser.isConnected() : null,
    via: fromApi ? "browser.process" : fromTree ? "descendant-scan" : "missing",
  };
}

/**
 * Start a compiled preview (or use E2E_URL). Never kills a stranger's server.
 *
 * Env:
 *   E2E_URL           — if set, do not spawn; use that URL
 *   QA_PORT           — preferred port when spawning
 *   QA_SERVER=preview|dev  — default preview
 */
export async function maybeStartQaServer(opts = {}) {
  const envUrl = process.env.E2E_URL;
  if (envUrl) {
    return {
      ok: true,
      owned: false,
      url: envUrl,
      pid: null,
      port: null,
      detail: "E2E_URL set; not spawning",
      async stop() {
        return { ok: true, skipped: true };
      },
    };
  }
  const kind = opts.kind || process.env.QA_SERVER || "preview";
  if (kind === "preview") {
    const dist = compiledDistReady(opts.cwd || AETHERWAKE_ROOT);
    if (!dist.ok) return { ok: false, owned: false, error: dist.error };
  }
  const preferred = process.env.QA_PORT ? Number(process.env.QA_PORT) : opts.port;
  const handle = await spawnOwnedServer({
    kind,
    name: opts.name || `qa-${kind}`,
    port: Number.isInteger(preferred) ? preferred : undefined,
    detach: false,
    // When the harness is already a durable session leader (run-durable), keep
    // the preview as a normal child. Double-detach made vite preview print
    // "Local: :port" then drop the listen before page.goto (ERR_CONNECTION_REFUSED).
    newSession: process.env.QA_DURABLE === "1" ? false : true,
    readyTimeoutMs: opts.readyTimeoutMs,
    cwd: opts.cwd,
  });
  if (!handle.ok) return handle;
  handle.stop = () => stopOwnedServer(handle);
  return handle;
}

const SIGNAL_STATUS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15, SIGKILL: 9 };
const HARNESS_CMDLINE_RE = /\b(stability|play-routes|durable-child)\.mjs\b/;

export function compiledDistReady(root = AETHERWAKE_ROOT) {
  const candidates = [
    join(root, "dist"),
    join(root, ".vercel", "output", "static"),
    join(root, ".output", "public"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    return {
      ok: false,
      dist: candidates[0],
      error:
        "compiled output missing (dist/ or .vercel/output/static). Lead must run `npm run build:app` (not `npm run build`, which runs db:migrate). Do not point QA at live :8080 HMR.",
    };
  }
  return { ok: true, dist: found };
}

export function heartbeatPath(pid = process.pid) {
  return join(STATE_DIR, `heartbeat-${pid}.json`);
}

export function exitEvidencePath(pid = process.pid) {
  return join(STATE_DIR, `exit-${pid}.json`);
}

export function evidenceRunLog(name) {
  return join(AETHERWAKE_ROOT, "..", "docs", "rebuild-evidence", `${name}-run.log`);
}

function parsePsLine(pid) {
  if (!pid || pid <= 1) return { pid: pid ?? null, ppid: null, pgid: null, sid: null };
  try {
    const text = execFileSync("ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid=,sess="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parts = text.split(/\s+/).map((n) => Number.parseInt(n, 10));
    return {
      pid: Number.isInteger(parts[0]) ? parts[0] : pid,
      ppid: Number.isInteger(parts[1]) ? parts[1] : null,
      pgid: Number.isInteger(parts[2]) ? parts[2] : null,
      sid: Number.isInteger(parts[3]) ? parts[3] : null,
    };
  } catch {
    return { pid, ppid: pid === process.pid ? process.ppid : null, pgid: null, sid: null };
  }
}

export function processIdentity(pid = process.pid) {
  const row = parsePsLine(pid);
  const ppid = row.ppid ?? (pid === process.pid ? process.ppid : null);
  return {
    pid: row.pid ?? pid,
    ppid,
    pgid: row.pgid,
    sid: row.sid ?? row.pgid,
    ppidAlive: isAlive(ppid),
    cmdline: readCmdline(pid),
    parentCmdline: readCmdline(ppid),
  };
}

export function waitpidStatus({ exitCode = null, signal = null } = {}) {
  const sigNum = typeof signal === "string" ? SIGNAL_STATUS[signal] ?? null : signal;
  if (sigNum != null) {
    return { signaled: true, signal: typeof signal === "string" ? signal : sigNum, code: 128 + sigNum, waitpid: sigNum };
  }
  if (exitCode != null) {
    return { signaled: false, signal: null, code: exitCode, waitpid: (exitCode & 0xff) << 8 };
  }
  return { signaled: false, signal: null, code: null, waitpid: null };
}

const CHROME_MAIN_RE = /Chromium\.app\/Contents\/MacOS\/Chromium|chrome-headless-shell|\bchrome\b|\bchromium\b/i;
const CHROME_HELPER_RE = /--type=|Chrome Helper|Chromium Helper/i;

export function findChromiumPid(rootPid = process.pid) {
  const kids = descendantPids(rootPid);
  const mains = [];
  const helpers = [];
  for (const pid of kids) {
    const cmd = readCmdline(pid);
    if (!cmd || !CHROME_MAIN_RE.test(cmd)) continue;
    (CHROME_HELPER_RE.test(cmd) ? helpers : mains).push(pid);
  }
  return mains[0] ?? helpers[0] ?? null;
}

export function looksLikeOwnedHarness(cmdline) {
  return HARNESS_CMDLINE_RE.test(String(cmdline ?? ""));
}

export function assertOwnedHarnessPid(handle = {}) {
  const pid = Number(handle.pid);
  if (!Number.isInteger(pid) || pid <= 1) return refuseKill(pid, "refused pid<=1 or invalid");
  if (pid === process.pid) return refuseKill(pid, "refused to signal self");
  if (pid === process.ppid) return refuseKill(pid, "refused to signal parent");
  if (handle.pidFile) {
    if (!existsSync(handle.pidFile)) return refuseKill(pid, "pid file missing; refusing to kill");
    let onDisk = null;
    try {
      onDisk = parsePid(readFileSync(handle.pidFile, "utf8"));
    } catch {
      onDisk = null;
    }
    if (onDisk !== pid) return refuseKill(pid, `pid file mismatch (${onDisk} != ${pid}); refusing to kill`);
  } else {
    return refuseKill(pid, "no pid file; refusing to kill");
  }
  if (!isAlive(pid)) return { ok: true, alreadyDead: true, pid };
  const cmd = readCmdline(pid);
  if (!looksLikeOwnedHarness(cmd)) {
    return refuseKill(pid, `cmdline is not our harness: ${cmd || "(empty)"}`);
  }
  return { ok: true, pid, cmdline: cmd };
}

function readJsonSilent(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function readHeartbeat(pid = process.pid) {
  return readJsonSilent(heartbeatPath(pid));
}

function writeJsonAtomic(path, body) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(body, null, 2));
  renameSync(tmp, path);
}

/**
 * Ignore SIGHUP so a dying tool TTY / wrapper cannot take the harness with it.
 * SIGINT/SIGTERM stay fatal unless QA_IGNORE_HANGUP=1 (stop then uses SIGKILL).
 *
 * Heartbeat: aetherwake/.grok/heartbeat-<pid>.json every 5s.
 * Exit evidence: aetherwake/.grok/exit-<pid>.json on close/exit/signal.
 */
export function installHarnessLifetime(opts = {}) {
  mkdirSync(STATE_DIR, { recursive: true });
  const startedAt = opts.startedAt || Date.now();
  const identity = processIdentity();
  const state = {
    pid: process.pid,
    ppid: identity.ppid,
    pgid: identity.pgid,
    sid: identity.sid,
    chromiumPid: opts.chromiumPid ?? null,
    serverPid: opts.serverPid ?? null,
    lastNote: opts.lastNote || "boot",
    startedAt,
    closeReason: null,
    signals: [],
    parentCmdline: identity.parentCmdline,
  };
  const hbFile = heartbeatPath(process.pid);
  const exitFile = exitEvidencePath(process.pid);
  let lastHeartbeat = null;
  let exitWritten = false;
  const ignoreHangup = process.env.QA_IGNORE_HANGUP === "1";
  const ignoreSIGHUP = true;
  const headed = process.env.QA_HEADED === "1";
  const evidenceLog = opts.evidenceLog || process.env.QA_EVIDENCE_LOG || null;

  if (evidenceLog) {
    try {
      mkdirSync(dirname(evidenceLog), { recursive: true });
      const fd = openSync(evidenceLog, "a");
      const origOut = process.stdout.write.bind(process.stdout);
      const origErr = process.stderr.write.bind(process.stderr);
      const fan = (chunk) => {
        try {
          writeSync(fd, chunk);
        } catch {
          /* ignore */
        }
      };
      process.stdout.write = (chunk, enc, cb) => {
        fan(typeof chunk === "string" ? chunk : chunk);
        return origOut(chunk, enc, cb);
      };
      process.stderr.write = (chunk, enc, cb) => {
        fan(typeof chunk === "string" ? chunk : chunk);
        return origErr(chunk, enc, cb);
      };
    } catch {
      /* evidence log is best-effort */
    }
  }

  function snapshot(extra = {}) {
    const chromiumPid = state.chromiumPid && isAlive(state.chromiumPid) ? state.chromiumPid : findChromiumPid(process.pid);
    if (chromiumPid) state.chromiumPid = chromiumPid;
    const now = Date.now();
    const ppidAlive = parentAlive(state.ppid);
    const chromiumAlive = state.chromiumPid ? isAlive(state.chromiumPid) : false;
    return {
      pid: state.pid,
      ppid: state.ppid,
      pgid: state.pgid,
      sid: state.sid,
      psSess: state.sid,
      newProcessGroup: state.pgid === state.pid,
      chromiumPid: state.chromiumPid,
      chromiumAlive,
      serverPid: state.serverPid,
      t: now,
      elapsedMs: now - startedAt,
      lastNote: state.lastNote,
      ppidAlive,
      parentCmdline: state.parentCmdline,
      argv: process.argv,
      closeReason: state.closeReason,
      signals: state.signals,
      ignoreHangup,
      ignoreSIGHUP,
      headed,
      qaDurable: process.env.QA_DURABLE === "1",
      ...extra,
    };
  }

  function writeHeartbeat(note) {
    if (note) state.lastNote = note;
    const body = snapshot();
    lastHeartbeat = body;
    try {
      writeJsonAtomic(hbFile, body);
    } catch {
      /* ignore */
    }
    return body;
  }

  function writeExit(extra = {}) {
    const body = {
      ...snapshot(),
      exitCode: extra.exitCode ?? extra.code ?? null,
      signal: extra.signal ?? null,
      closeReason: extra.closeReason ?? state.closeReason,
      waitpid: waitpidStatus({ exitCode: extra.exitCode ?? extra.code ?? null, signal: extra.signal ?? null }),
      lastHeartbeat,
      stack: extra.stack || extra.errorStack || new Error("harness-exit").stack,
      error: extra.error ?? null,
      ...extra,
    };
    try {
      writeJsonAtomic(exitFile, body);
      exitWritten = true;
    } catch {
      /* ignore */
    }
    return body;
  }

  writeHeartbeat(state.lastNote);

  const timer = setInterval(() => {
    const ppidAlive = parentAlive(state.ppid);
    writeHeartbeat(ppidAlive ? state.lastNote : "ppid-dead");
  }, 5000);

  function attachSignal(signal, { ignore }) {
    const handler = () => {
      state.signals.push({ t: Date.now(), signal });
      state.lastNote = `${ignore ? "ignored" : "received"} ${signal}`;
      writeHeartbeat(state.lastNote);
      writeExit({ signal, exitCode: null });
      if (ignore) return;
      process.removeListener(signal, handler);
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exit(128 + (SIGNAL_STATUS[signal] || 1));
      }
    };
    process.on(signal, handler);
    return handler;
  }

  attachSignal("SIGHUP", { ignore: ignoreSIGHUP });
  attachSignal("SIGINT", { ignore: ignoreHangup });
  attachSignal("SIGTERM", { ignore: ignoreHangup });

  process.on("exit", (code) => {
    if (!exitWritten) writeExit({ exitCode: code, signal: null });
  });
  process.on("uncaughtException", (err) => {
    writeExit({ exitCode: 1, error: err?.message || String(err), stack: err?.stack });
  });

  return {
    state,
    heartbeatFile: hbFile,
    exitFile,
    identity,
    writeHeartbeat,
    writeExit,
    setChromiumPid(pid) {
      state.chromiumPid = pid ?? findChromiumPid(process.pid);
      writeHeartbeat(state.lastNote);
      return state.chromiumPid;
    },
    setServerPid(pid) {
      state.serverPid = pid ?? null;
      writeHeartbeat(state.lastNote);
    },
    setCloseReason(reason) {
      state.closeReason = reason ?? null;
    },
    setLastNote(note) {
      writeHeartbeat(note);
    },
    dispose() {
      clearInterval(timer);
    },
  };
}

/**
 * Stop a durable harness started by run-durable.mjs. Never kills by port.
 */
export async function stopDurableHarness(handle = {}, { graceMs = 2500 } = {}) {
  const gate = assertOwnedHarnessPid(handle);
  if (!gate.ok) return gate;
  const pid = handle.pid;
  const hb = readHeartbeat(pid);
  const extraPids = [hb?.serverPid, hb?.chromiumPid].filter((p) => Number.isInteger(p) && p > 1 && p !== process.pid && p !== process.ppid);

  async function stopExtras() {
    const results = [];
    for (const extra of extraPids) {
      if (!isAlive(extra)) continue;
      const cmd = readCmdline(extra);
      if (looksLikeOwnedServer(cmd, { kind: "preview" }) || looksLikeOwnedServer(cmd, { kind: "fixture" }) || looksLikeOwnedServer(cmd, { kind: "dev" })) {
        const pidFileGuess = [
          join(STATE_DIR, `stability-${extra}.pid`),
          join(STATE_DIR, `play-routes-${extra}.pid`),
          join(STATE_DIR, `qa-preview-${extra}.pid`),
        ].find((p) => existsSync(p) && parsePid(readFileSync(p, "utf8")) === extra);
        if (pidFileGuess) {
          results.push(
            await stopOwnedServer({
              pid: extra,
              pidFile: pidFileGuess,
              kind: looksLikeOwnedServer(cmd, { kind: "fixture" }) ? "fixture" : "preview",
              owned: true,
            }),
          );
        }
      }
    }
    return results;
  }

  if (gate.alreadyDead) {
    const extras = await stopExtras();
    cleanupStateFiles(handle);
    return { ok: true, alreadyDead: true, pid, extras };
  }

  const kids = descendantPids(pid).filter((p) => p > 1 && p !== process.pid && p !== process.ppid);
  const tree = [...new Set([...kids, pid])];
  for (const p of tree) signalPid(p, "SIGTERM");
  let live = await waitDead(tree, graceMs);
  for (const p of live) signalPid(p, "SIGKILL");
  live = await waitDead(live, Math.min(1500, graceMs));
  const extras = await stopExtras();
  cleanupStateFiles(handle);
  return {
    ok: live.length === 0,
    pid,
    stopped: tree.filter((p) => !live.includes(p)),
    stubborn: live,
    extras,
    error: live.length ? `still alive: ${live.join(",")}` : undefined,
  };
}

