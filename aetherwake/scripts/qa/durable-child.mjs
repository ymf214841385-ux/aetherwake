#!/usr/bin/env node
/**
 * Test stand-in for a long-lived QA harness. Stays alive until SIGTERM/SIGKILL
 * or QA_CHILD_MS (default 30000). Used by run-durable tests; not the game.
 */
import { installHarnessLifetime } from "./lifecycle.mjs";

const ms = Math.max(200, Number(process.env.QA_CHILD_MS || 30000) || 30000);
const life = installHarnessLifetime({ lastNote: "durable-child" });
process.stdout.write(
  JSON.stringify({
    ok: true,
    pid: process.pid,
    ppid: process.ppid,
    heartbeatFile: life.heartbeatFile,
    exitFile: life.exitFile,
  }) + "\n",
);

await new Promise((resolve) => setTimeout(resolve, ms));
life.writeExit({ exitCode: 0 });
life.dispose();
process.exit(0);
