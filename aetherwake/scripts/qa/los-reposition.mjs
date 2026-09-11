/**
 * D3.1/D3.2: shared citadel LOS reposition executor.
 * Segment 1: (6,-4) arrive 0.5 sprint false.
 * Segment 2 (same budget): if still east/west wing blocked AND boss.z>-0.3,
 * walk gate-center (6,2). Fresh read per segment. No distance-arrive fallback;
 * clear requires valid snapshot, live boss, bossMeleeBlocked === false, nav.arrived.
 */
import { navigationOutcome } from "./shrine-steer.mjs";

export const LOS_REPOSITION_TARGET = { x: 6, z: -4 };
export const LOS_REPOSITION_GATE_CENTER = { x: 6, z: 2 };
export const LOS_REPOSITION_ARRIVE = 0.5;
export const LOS_REPOSITION_SPRINT = false;
export const LOS_REPOSITION_TIMEOUT_MS = 12000;
/** Wing walls that (6,-4) does not always clear; (6,2) does for boss.z>-0.3. */
export const WING_WALL_IDS = ["citadel-wall-0-11-e", "citadel-wall-0-11-w"];
export const BOSS_Z_CONTINUE = -0.3;

export function losRepositionNav(dist, { timedOut = false, climbing = false } = {}) {
  return navigationOutcome({
    dist,
    arrive: LOS_REPOSITION_ARRIVE,
    timedOut,
    climbing,
  });
}

/** Strict: only bossMeleeBlocked === false counts as clear (undefined ≠ clear). */
export function losCleared(snapshot) {
  if (!snapshot) return false;
  if (!snapshot.boss) return false;
  if (snapshot.bossMeleeBlocked !== false) return false;
  return true;
}

function isWingBlocked(snapshot) {
  const id = snapshot?.blockerId;
  return WING_WALL_IDS.includes(id);
}

function snapshotPose(s) {
  if (!s) return null;
  return {
    x: +s.x.toFixed(2),
    y: +s.y.toFixed(2),
    z: +s.z.toFixed(2),
  };
}

async function walkSegment({ goTo, read, note, target, label, prev }) {
  const s0 = prev ?? (await read());
  if (!s0) {
    return {
      rec: { ok: false, reason: "no-start-snapshot", label },
      s: null,
      arrived: false,
      clear: false,
    };
  }
  const targetDist0 = Math.hypot(target.x - s0.x, target.z - s0.z);
  const end = await goTo(target.x, target.z, LOS_REPOSITION_TIMEOUT_MS, {
    arrive: LOS_REPOSITION_ARRIVE,
    sprint: LOS_REPOSITION_SPRINT,
    label,
  });
  // D3.2: always fresh read after walk — do not trust stale end snapshot alone.
  const s1 = (await read()) ?? end;
  const targetDist1 = s1 ? Math.hypot(target.x - s1.x, target.z - s1.z) : null;
  const nav = s1?.nav ?? end?.nav ?? null;
  // Strict: only nav.arrived, no distance fallback.
  const arrived = nav?.arrived === true;
  const clear = losCleared(s1);
  const rec = {
    ok: arrived && clear,
    label,
    elapsedMs: 0,
    start: snapshotPose(s0),
    end: snapshotPose(s1),
    target: { ...target },
    targetDist0: +targetDist0.toFixed(2),
    targetDist1: targetDist1 == null ? null : +targetDist1.toFixed(2),
    displacement:
      s0 && s1 ? +Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(2) : null,
    navStatus: nav?.status ?? null,
    arrived,
    clear,
    blocked: s1 ? s1.bossMeleeBlocked === true : null,
    blocker: s1?.blockerId ?? null,
    bossZ: s1?.boss?.z ?? null,
  };
  return { rec, s: s1, arrived, clear };
}

/**
 * @param {object} deps
 * @param {(x:number,z:number,ms:number,opts:object)=>Promise<any>} deps.goTo
 * @param {()=>Promise<any>} deps.read
 * @param {(m:string)=>void} [deps.note]
 * @param {any} [deps.start]
 */
export async function executeLosReposition({ goTo, read, note, start }) {
  const t0 = Date.now();
  const segments = [];

  // Segment 1: gate interior (6,-4)
  const a = await walkSegment({
    goTo,
    read,
    note,
    target: LOS_REPOSITION_TARGET,
    label: "citadel-los-reposition",
    prev: start,
  });
  segments.push(a.rec);

  let s = a.s;
  let ok = a.arrived && a.clear;
  let reason = ok
    ? "clear-at-gate-interior"
    : a.rec?.reason ||
      (!a.arrived
        ? "seg1-nav-not-arrived"
        : !a.s
          ? "seg1-no-snapshot"
          : !a.s.boss
            ? "seg1-no-boss"
            : a.s.bossMeleeBlocked !== false
              ? "seg1-still-blocked"
              : "seg1-invalid");

  // Segment 2 (same budget): only after a real arrive on seg1.
  if (
    !ok &&
    a.arrived &&
    a.s &&
    isWingBlocked(a.s) &&
    Number.isFinite(a.s.boss?.z) &&
    a.s.boss.z > BOSS_Z_CONTINUE
  ) {
    const b = await walkSegment({
      goTo,
      read,
      note,
      target: LOS_REPOSITION_GATE_CENTER,
      label: "citadel-los-gate-center",
      prev: a.s,
    });
    segments.push(b.rec);
    s = b.s;
    ok = b.arrived && b.clear;
    reason = ok
      ? "clear-at-gate-center"
      : !b.arrived
        ? "seg2-nav-not-arrived"
        : !b.s
          ? "seg2-no-snapshot"
          : !b.s.boss
            ? "seg2-no-boss"
            : b.s.bossMeleeBlocked !== false
              ? "seg2-still-blocked"
              : "seg2-invalid";
  } else if (!ok && a.s && isWingBlocked(a.s)) {
    reason = "boss-z-condition-not-met";
  }

  const rec = {
    ok,
    reason,
    elapsedMs: Date.now() - t0,
    segments,
    start: segments[0]?.start ?? null,
    end: segments[segments.length - 1]?.end ?? null,
    blockerAfter: segments[segments.length - 1]?.blocker ?? null,
    blockedAfter: segments[segments.length - 1]?.blocked ?? null,
  };
  note?.(`citadel reposition ${ok ? "ok" : "fail"} ${JSON.stringify(rec)}`);
  return { rec, s, ok };
}
