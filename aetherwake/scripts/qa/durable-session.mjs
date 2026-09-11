/**
 * Single install entry for long-lived QA (stability + play-routes).
 *
 *   import { installHarnessLifetime } from "./qa/durable-session.mjs";
 *   const life = installHarnessLifetime({ lastNote: "boot" });
 *
 * Lead launches the harness via `scripts/qa/run-durable.mjs` so a short-lived
 * tool parent cannot SIGHUP/kill the session.
 */
export {
  assertOwnedHarnessPid,
  browserProcessInfo,
  compiledDistReady,
  exitEvidencePath,
  heartbeatPath,
  installHarnessLifetime,
  processIdentity,
  readHeartbeat,
  stopDurableHarness,
} from "./lifecycle.mjs";
