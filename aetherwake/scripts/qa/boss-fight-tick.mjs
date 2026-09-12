/**
 * Review19: the exact pre-decision branches boss-resume runs before
 * bossFightDecision — extracted so trajectory tests cannot pass while the
 * harness still takes a different outer path (off-arena, stall, far-respawn).
 */
import { bossFightDecision } from "./boss-fight-policy.mjs";
import { citadelOffArena, citadelReturnWaypoints } from "./citadel-steer.mjs";

/**
 * @param {object} s snapshot from boss-resume read()
 * @param {object} [opts]
 * @param {number} [opts.stall] consecutive ticks distance did not close
 * @param {number} [opts.lastDist]
 * @param {number} [opts.now] ms clock
 * @param {number} [opts.sidestepUntil]
 * @returns {{kind:string, reason?:string, action?:string, dist?:number, wps?:Array, far?:boolean, stall?:number}}
 */
export function planFightTick(s, opts = {}) {
  if (!s || s.mode !== "playing") {
    if (s?.mode === "dead") return { kind: "dead" };
    if (s?.mode === "ending") return { kind: "ending" };
    return { kind: "stop", reason: `mode=${s?.mode}` };
  }
  if (s.bossDead || !s.boss?.alive) {
    return { kind: "done", bossDead: Boolean(s.bossDead) };
  }
  const dist = Number.isFinite(s.dist)
    ? s.dist
    : Math.hypot(s.x - s.boss.x, s.z - s.boss.z);
  const offNow = citadelOffArena({ x: s.x, z: s.z, y: s.y }, s.boss);
  // 054532: death respawn at world spawn z≈102 reported off=inside and the
  // fight loop bee-lined d=122 until timeout. north-of-gate + far must recover.
  const needRecover =
    (offNow.off && dist > 6) ||
    (dist > 10 && Math.abs(s.z - s.boss.z) > 12 && s.z < -7) ||
    (offNow.off && dist > 40);
  if (needRecover) {
    return {
      kind: "recover",
      reason: offNow.reason,
      dist,
      off: offNow,
      wps: citadelReturnWaypoints({ x: s.x, z: s.z, y: s.y }, s.boss),
      far: dist > 40 || (s.y ?? 0) > 40,
    };
  }

  let stall = opts.stall ?? 0;
  const lastDist = opts.lastDist;
  if (Number.isFinite(lastDist)) {
    if (dist > lastDist - 0.04) stall += 1;
    else stall = 0;
  }
  const sidestepUntil = opts.sidestepUntil ?? 0;
  const now = opts.now ?? 0;
  if (stall >= 25 && now > sidestepUntil) {
    const nearGate =
      Math.abs(s.x - 6) < 8 && Math.abs(s.z) < 10 && Math.abs(s.boss.z) < 12;
    return {
      kind: nearGate && dist > 3.5 ? "gate-clear" : "sidestep",
      reason: `stall=${stall}`,
      dist,
      stall,
      nearGate,
    };
  }

  const faceDot =
    s.faceDot ??
    (() => {
      const dx = s.boss.x - s.x;
      const dz = s.boss.z - s.z;
      const len = Math.hypot(dx, dz) || 1;
      const fx = -Math.sin(s.camYaw ?? 0);
      const fz = -Math.cos(s.camYaw ?? 0);
      return (dx * fx + dz * fz) / len;
    })();

  const decision = bossFightDecision({
    hp: s.hp,
    dist,
    bossPhase: s.boss.phase,
    bossHp: s.boss.hp,
    state: s.state,
    dodgeCd: s.dodgeCd,
    stamina: s.stamina,
    canDodge: s.canDodge,
    attackPhase: s.attackPhase,
    faceDot,
  });
  return {
    kind: "fight",
    action: decision.action,
    reason: decision.reason,
    dist,
    stall,
    faceDot,
    hp: s.hp,
    bossHp: s.boss.hp,
    bossPhase: s.boss.phase,
    dodgeCd: s.dodgeCd,
  };
}

/**
 * Apply one harness action to a virtual pose. Mirrors boss-resume movement
 * magnitudes (W ~0.3–0.55 m, back-off ~0.35, dodge +0.6) so trajectory tests
 * exercise the same outer branches, not a single-point policy assert.
 */
export function applyFightAction(pose, tick) {
  const p = { ...pose };
  if (tick.kind === "recover") {
    p.pendingRecover = tick.wps;
    p.dist = tick.dist;
    return p;
  }
  if (tick.kind !== "fight") return p;
  const a = tick.action;
  if (a === "approach") {
    p.dist = Math.max(2.05, p.dist - (p.dist > 5 ? 0.55 : 0.32));
  } else if (a === "swing") {
    p.bossHp = Math.max(0, p.bossHp - 1.8);
    p.swings = (p.swings ?? 0) + 1;
    p.landed = (p.landed ?? 0) + 1;
    // counter after some swings
    if (p.landed % 3 === 0) p.hp = Math.max(0.2, p.hp - 0.35);
  } else if (a === "dodge") {
    p.dist = Math.min(4.8, p.dist + 0.6);
    p.dodgeCd = 1.1;
  } else if (a === "back-off" || a === "back-off-too-close") {
    p.dist = Math.min(5.5, p.dist + (a === "back-off" ? 0.35 : 0.3));
  }
  if (p.dodgeCd > 0) p.dodgeCd = Math.max(0, +(p.dodgeCd - 0.15).toFixed(2));
  return p;
}
