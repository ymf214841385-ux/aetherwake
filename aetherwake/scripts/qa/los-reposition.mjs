/**
 * D3.1: shared citadel LOS reposition executor.
 * arrive=0.5 so navigationOutcome cannot "arrive" from 2.6m short of (6,-4).
 * Never mutates game state; only reports nav + read-only bossMeleeBlocked.
 */
import { navigationOutcome } from "./shrine-steer.mjs";

export const LOS_REPOSITION_TARGET = { x: 6, z: -4 };
export const LOS_REPOSITION_ARRIVE = 0.5;
export const LOS_REPOSITION_SPRINT = false;
export const LOS_REPOSITION_TIMEOUT_MS = 12000;

/** Production navigationOutcome with the reposition arrive radius. */
export function losRepositionNav(dist, { timedOut = false, climbing = false } = {}) {
  return navigationOutcome({
    dist,
    arrive: LOS_REPOSITION_ARRIVE,
    timedOut,
    climbing,
  });
}

/**
 * @param {object} deps
 * @param {(x:number,z:number,ms:number,opts:object)=>Promise<any>} deps.goTo
 * @param {()=>Promise<any>} deps.read
 * @param {(m:string)=>void} [deps.note]
 * @param {any} [deps.start] optional starting snapshot
 */
export async function executeLosReposition({ goTo, read, note, start }) {
  const t0 = Date.now();
  const s0 = start ?? (await read());
  if (!s0) {
    const rec = { ok: false, reason: "no-start-snapshot", elapsedMs: Date.now() - t0 };
    note?.(`citadel reposition fail ${JSON.stringify(rec)}`);
    return { rec, s: null, ok: false };
  }
  const targetDist0 = Math.hypot(LOS_REPOSITION_TARGET.x - s0.x, LOS_REPOSITION_TARGET.z - s0.z);
  const end = await goTo(
    LOS_REPOSITION_TARGET.x,
    LOS_REPOSITION_TARGET.z,
    LOS_REPOSITION_TIMEOUT_MS,
    {
      arrive: LOS_REPOSITION_ARRIVE,
      sprint: LOS_REPOSITION_SPRINT,
      label: "citadel-los-reposition",
    },
  );
  const s1 = end ?? (await read());
  const targetDist1 = s1
    ? Math.hypot(LOS_REPOSITION_TARGET.x - s1.x, LOS_REPOSITION_TARGET.z - s1.z)
    : null;
  const displacement = s0 && s1 ? Math.hypot(s1.x - s0.x, s1.z - s0.z) : null;
  const nav = s1?.nav ?? null;
  const arrived = Boolean(nav?.arrived) || (targetDist1 != null && targetDist1 <= LOS_REPOSITION_ARRIVE);
  const rec = {
    ok: false,
    elapsedMs: Date.now() - t0,
    start: { x: +s0.x.toFixed(2), y: +s0.y.toFixed(2), z: +s0.z.toFixed(2) },
    end: s1 ? { x: +s1.x.toFixed(2), y: +s1.y.toFixed(2), z: +s1.z.toFixed(2) } : null,
    target: { ...LOS_REPOSITION_TARGET },
    targetDist0: +targetDist0.toFixed(2),
    targetDist1: targetDist1 == null ? null : +targetDist1.toFixed(2),
    displacement: displacement == null ? null : +displacement.toFixed(2),
    navStatus: nav?.status ?? null,
    arrived,
    blockedBefore: Boolean(s0.bossMeleeBlocked),
    blockerBefore: s0.blockerId ?? null,
    blockedAfter: Boolean(s1?.bossMeleeBlocked),
    blockerAfter: s1?.blockerId ?? null,
  };
  rec.ok = arrived && rec.blockedAfter === false;
  note?.(`citadel reposition ${rec.ok ? "ok" : "fail"} ${JSON.stringify(rec)}`);
  return { rec, s: s1, ok: rec.ok };
}
