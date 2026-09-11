#!/usr/bin/env node
/**
 * Tiny HTTP fixture for lifecycle tests. Not the game server.
 *   QA_LISTEN_PORT=NNNN [QA_LISTEN_DELAY_MS=0] node scripts/qa/fixture-server.mjs
 */
import { createServer } from "node:http";

const port = Number(process.env.QA_LISTEN_PORT || process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("fixture-server: need QA_LISTEN_PORT or argv port");
  process.exit(2);
}

const delayMs = Math.max(0, Number(process.env.QA_LISTEN_DELAY_MS || 0) || 0);
const host = "127.0.0.1";

function listen() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("qa-owned-ok");
  });
  server.listen(port, host, () => {
    process.stdout.write(`listening ${host}:${port}\n`);
  });
  server.on("error", (err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

if (delayMs > 0) setTimeout(listen, delayMs);
else listen();
