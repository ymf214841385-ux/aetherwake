#!/usr/bin/env node
/** Motion-only subset of capture-character.mjs (idle/walk/run/climb/glide/attack). */
import { runCapture } from "./capture-character.mjs";

await runCapture({ only: "motion" }).catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }, null, 2));
  process.exit(1);
});
