#!/usr/bin/env node
/**
 * Serve a FIXED compiled snapshot on an owned unique port.
 * Never points QA at live Vite HMR on :8080.
 * Never kills a process this CLI did not spawn.
 *
 *   node scripts/qa-preview.mjs start
 *   node scripts/qa-preview.mjs stop
 *   node scripts/qa-preview.mjs status
 *
 * Pid/log files: aetherwake/.grok/qa-preview-<pid>.{pid,log,json}
 * Latest pointer: aetherwake/.grok/qa-preview.json (stop uses this only if owned)
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SHARED_PORTS,
  compiledDistReady,
  isAlive,
  parsePid,
  pickFreePort,
  portFree,
  spawnOwnedServer,
  stopOwnedServer,
} from "./qa/lifecycle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = join(ROOT, ".grok");
const LATEST_FILE = join(STATE_DIR, "qa-preview.json");
const PREFERRED_PORTS = [8091, 8092, 8093];

function parseArgs(argv) {
  const [action] = argv;
  if (!action) return { error: "usage: node scripts/qa-preview.mjs start|stop|status" };
  if (!["start", "stop", "status"].includes(action)) return { error: `unknown action: ${action}` };
  return { action };
}

function readLatest() {
  try {
    return JSON.parse(readFileSync(LATEST_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function choosePort() {
  if (process.env.QA_PORT) return pickFreePort({ preferred: Number(process.env.QA_PORT) });
  for (const p of PREFERRED_PORTS) {
    if (await portFree(p)) return p;
  }
  return pickFreePort();
}

async function start() {
  const dist = compiledDistReady(ROOT);
  if (!dist.ok) return { ok: false, error: dist.error };
  const port = await choosePort();
  const handle = await spawnOwnedServer({
    kind: "preview",
    name: "qa-preview",
    port,
    detach: true,
    readyTimeoutMs: 60000,
    cwd: ROOT,
  });
  if (!handle.ok) {
    return { ok: false, error: handle.error, log: handle.logFile, pidFile: handle.pidFile };
  }
  const latest = {
    pid: handle.pid,
    port: handle.port,
    url: handle.url,
    log: handle.logFile,
    pidFile: handle.pidFile,
    jsonFile: handle.jsonFile,
    startedAt: handle.startedAt,
    ownerPid: handle.ownerPid,
    kind: handle.kind,
    sharedPortsAvoided: [...SHARED_PORTS],
  };
  writeFileSync(LATEST_FILE, JSON.stringify(latest, null, 2));
  return { ok: true, ...latest };
}

async function stop() {
  const latest = readLatest();
  if (!latest?.pid) {
    return { ok: true, stopped: [], detail: "no qa-preview latest pointer" };
  }
  const handle = {
    pid: latest.pid,
    pidFile: latest.pidFile || join(STATE_DIR, `qa-preview-${latest.pid}.pid`),
    jsonFile: latest.jsonFile || join(STATE_DIR, `qa-preview-${latest.pid}.json`),
    logFile: latest.log,
    kind: latest.kind || "preview",
    port: latest.port,
    owned: true,
  };
  if (!existsSync(handle.pidFile)) {
    return {
      ok: false,
      error: `refusing to kill pid ${latest.pid}: no owned pid file ${handle.pidFile}`,
      pid: latest.pid,
    };
  }
  const result = await stopOwnedServer(handle);
  if (result.ok) {
    try {
      rmSync(LATEST_FILE, { force: true });
    } catch {
      /* ignore */
    }
  }
  return result;
}

async function status() {
  const latest = readLatest();
  if (!latest) return { ok: false, error: "no qa-preview state" };
  const alive = isAlive(latest.pid);
  return { ok: alive, alive, pid: parsePid(String(latest.pid)), ...latest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(JSON.stringify({ ok: false, error: args.error }, null, 2));
    process.exit(1);
  }
  const out = args.action === "start" ? await start() : args.action === "stop" ? await stop() : await status();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

export { parseArgs, start, stop, status };
