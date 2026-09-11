#!/usr/bin/env node
/**
 * Detached QA launcher. The tool parent prints JSON and exits 0; the child
 * keeps running in a new session (setsid). A dying Grok/OpenCode command
 * must not take Chromium with it.
 *
 *   node scripts/qa/run-durable.mjs --name stability -- scripts/stability.mjs
 *   node scripts/qa/run-durable.mjs --name play-routes -- scripts/play-routes.mjs
 *   node scripts/qa/run-durable.mjs --stop --pidFile .grok/durable-stability-<pid>.pid
 *
 * Never kills by port. Stop only if the pid file still matches and cmdline
 * looks like node …stability.mjs / play-routes.mjs / durable-child.mjs.
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  compiledDistReady,
  evidenceRunLog,
  heartbeatPath,
  parsePid,
  projectRoot,
  stateDir,
  stopDurableHarness,
} from "./lifecycle.mjs";

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = projectRoot();

function usageError(msg) {
  return {
    ok: false,
    error: msg,
    usage:
      "node scripts/qa/run-durable.mjs --name <stability|play-routes> -- scripts/<harness>.mjs | --stop --pidFile <path>",
  };
}

export function parseDurableArgs(argv) {
  const out = { stop: false, pidFile: null, name: null, cmd: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stop") out.stop = true;
    else if (a === "--pidFile" || a === "--pid-file") out.pidFile = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--") {
      out.cmd = argv.slice(i + 1);
      break;
    } else if (a.startsWith("-")) {
      return { error: `unknown flag: ${a}` };
    } else {
      out.cmd = argv.slice(i);
      break;
    }
  }
  return out;
}

function needsCompiledDist(cmd) {
  return cmd.some((c) => /(?:^|\/)(stability|play-routes)\.mjs$/.test(String(c)));
}

/** D2: long-QA names that default QA_HEADED=1 (cron kills headless chromium >300s). */
export const DEFAULT_HEADED_NAMES = ["play-routes", "stability", "boss-sealed", "boss-resume"];

/** Explicit env always wins; otherwise long QA defaults headed. */
export function resolveQaHeaded(name, env = process.env) {
  if (env.QA_HEADED != null && env.QA_HEADED !== "") return String(env.QA_HEADED);
  if (DEFAULT_HEADED_NAMES.includes(name)) return "1";
  return null;
}

function resolveHarness(cmd, cwd) {
  if (!cmd.length) return { error: "missing command after --" };
  let command = cmd[0];
  let args = cmd.slice(1);
  if (command === "node" || command === process.execPath) {
    command = process.execPath;
    if (!args.length) return { error: "node command missing script" };
    if (!isAbsolute(args[0]) && args[0].endsWith(".mjs")) args = [resolve(cwd, args[0]), ...args.slice(1)];
  } else if (command.endsWith(".mjs") || command.endsWith(".js")) {
    args = [isAbsolute(command) ? command : resolve(cwd, command), ...args];
    command = process.execPath;
  }
  return { command, args };
}

export async function startDurable({ name, cmd, cwd = ROOT } = {}) {
  if (!name) return usageError("need --name (stability, play-routes, …)");
  if (!/^[a-z0-9-]+$/i.test(name)) return { ok: false, error: `invalid name: ${name}` };
  const resolved = resolveHarness(cmd, cwd);
  if (resolved.error) return { ok: false, error: resolved.error };

  if (needsCompiledDist(cmd) && (process.env.QA_SERVER || "preview") !== "dev") {
    const dist = compiledDistReady(cwd);
    if (!dist.ok) return { ok: false, error: dist.error };
  }

  mkdirSync(stateDir(), { recursive: true });
  const evidenceLog = evidenceRunLog(name);
  mkdirSync(dirname(evidenceLog), { recursive: true });
  const pendingLog = join(stateDir(), `durable-${name}-pending-${process.pid}-${Date.now()}.log`);
  const logFd = openSync(pendingLog, "a");

  const env = {
    ...process.env,
    QA_SERVER: process.env.QA_SERVER || "preview",
    QA_DURABLE: "1",
    QA_HARNESS_NAME: name,
    QA_EVIDENCE_LOG: evidenceLog,
    BROWSER: "none",
  };
  // D2: long QA default headed so external cleanup-browser cron (kills
  // chrome.*--headless age>300s) cannot SIGTERM our Chromium mid-route.
  // Explicit QA_HEADED=0 still forces headless for short diagnostics.
  const headedDefault = resolveQaHeaded(name, process.env);
  if (headedDefault != null) env.QA_HEADED = headedDefault;

  const child = spawn(resolved.command, resolved.args, {
    cwd,
    detached: true,
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
    return { ok: false, error: "spawn returned invalid pid" };
  }

  const pidFile = join(stateDir(), `durable-${name}-${pid}.pid`);
  const logFile = join(stateDir(), `durable-${name}-${pid}.log`);
  try {
    renameSync(pendingLog, logFile);
  } catch {
    writeFileSync(logFile, "");
  }
  writeFileSync(pidFile, `${pid}\n`);
  const header = `# durable start ${new Date().toISOString()} launcher=${process.pid} child=${pid} name=${name} log=${logFile} pidFile=${pidFile}\n`;
  try {
    writeFileSync(evidenceLog, header, { flag: "a" });
  } catch {
    /* ignore */
  }

  child.unref();

  return {
    ok: true,
    pid,
    name,
    logFile,
    pidFile,
    evidenceLog,
    heartbeatFile: heartbeatPath(pid),
    exitFile: join(stateDir(), `exit-${pid}.json`),
    argv: [resolved.command, ...resolved.args],
    qaServer: env.QA_SERVER,
    headed: env.QA_HEADED === "1",
  };
}

export async function stopDurable({ pidFile } = {}) {
  if (!pidFile) return usageError("need --stop --pidFile <path>");
  if (!existsSync(pidFile)) return { ok: false, error: `pid file missing: ${pidFile}` };
  const pid = parsePid(readFileSync(pidFile, "utf8"));
  if (!pid) return { ok: false, error: `pid file did not contain a pid>1: ${pidFile}` };
  return stopDurableHarness({ pid, pidFile, owned: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseDurableArgs(process.argv.slice(2));
  if (args.error) {
    console.error(JSON.stringify(usageError(args.error), null, 2));
    process.exit(1);
  }
  const out = args.stop ? await stopDurable(args) : await startDurable(args);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
