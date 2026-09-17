/**
 * R26 boss courtyard fight control (QA). Pure — no DOM.
 * Production boss: meleeR=3.4, strike range=3.8, DODGE_IFRAMES=0.18, DODGE_TIME=0.28.
 * Never drive while merely "holding facing". Threats outrank courtyard re-entry.
 */

export const BOSS_MELEE_R = 3.4;
/** Production strike damage band — generic combat DANGER 3.6 is too small. */
export const BOSS_STRIKE_R = 3.8;
/** Keep this far from the boss when not attacking (outside strike band + margin). */
export const BOSS_SAFE_R = 4.2;
/**
 * Production boss meleeHit range = ATTACK_RANGE_HEAVY + 0.6 (rangeBoost)
 * = 2.85 + 0.6 = 3.45. NOT ATTACK_RANGE 2.15.
 */
export const BOSS_HIT_R = 2.85 + 0.6;
/** Still art (Digit5+F) locks the nearest living enemy within 16m for 4.2s. */
export const STILL_FREEZE_RANGE = 16;

export type BossThreat = {
  id: string;
  d: number;
  phase: string | null;
  x: number;
  z: number;
  hp?: number;
  brainT?: number | null;
  /** Live enemy.frozen seconds remaining. */
  frozen?: number;
};

export type BossPlayer = {
  x: number;
  z: number;
  camYaw: number;
  bodyYaw?: number;
  hp: number;
  stamina: number;
  invuln?: number;
  dodgeCd?: number;
  attackPhase?: string | null;
};

export type BossFightAction =
  | { kind: "dodge"; reason: string }
  | { kind: "look"; key: "ArrowLeft" | "ArrowRight"; reason: string; err: number }
  | { kind: "move"; tx: number; tz: number; reason: string }
  | { kind: "attack"; reason: string }
  | { kind: "freeze"; reason: string }
  | { kind: "wait"; reason: string };

const STRIKE = new Set(["windup", "strike"]);

function angDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function desiredYawTo(from: { x: number; z: number }, to: { x: number; z: number }) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** Look-only turn toward a world point. Never implies movement. */
export function decideLookToward(
  from: { x: number; z: number; camYaw: number },
  to: { x: number; z: number },
  errThreshold = 0.28,
): { kind: "done"; err: number } | { kind: "turn"; key: "ArrowLeft" | "ArrowRight"; err: number } {
  const err = angDiff(desiredYawTo(from, to), from.camYaw);
  if (Math.abs(err) < errThreshold) return { kind: "done", err };
  // ArrowRight decreases cam.yaw; need larger yaw → ArrowLeft
  return { kind: "turn", key: err > 0 ? "ArrowLeft" : "ArrowRight", err };
}

export function facingBody(from: { x: number; z: number; bodyYaw?: number; camYaw: number }, to: { x: number; z: number }) {
  const yaw = from.bodyYaw ?? from.camYaw;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return true;
  // body forward = (−sin yaw, −cos yaw)
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return (dx * fx + dz * fz) / len >= 0.55;
}

function dodgeReady(p: BossPlayer, staminaMin = 18) {
  return p.stamina > staminaMin && (p.dodgeCd ?? 0) <= 0;
}

/**
 * One fight decision step.
 * Order: strike threat → courtyard re-entry (only if safe) → recover attack
 * (look-only then attack) → maintain safe spacing → look toward boss.
 */
export function decideBossFight(opts: {
  player: BossPlayer;
  boss: BossThreat | null;
  inCourtyard: boolean;
  /** Gate mouth / courtyard anchor used when knocked outside. */
  courtyardAnchor?: { x: number; z: number };
  /** Player has still art (slot 4) and it can fire (no extra cost in production). */
  stillReady?: boolean;
  /** Live production meleeHit probe (range/arc/height). false → realign, do not swing. */
  canMeleeHit?: boolean;
}): BossFightAction {
  const { player, boss } = opts;
  const anchor = opts.courtyardAnchor ?? { x: 6, z: -3 };
  const outOfCourt = !opts.inCourtyard;
  const frozen = (boss?.frozen ?? 0) > 0.15;

  // 0) Still freeze (Digit5+F): legal production art. Freezes nearest living
  //    enemy 16m for 4.2s and adds +1.6 melee damage. Prefer before trading.
  if (opts.stillReady && boss && !frozen && boss.d <= STILL_FREEZE_RANGE) {
    return { kind: "freeze", reason: `still d=${boss.d.toFixed(2)} phase=${boss.phase}` };
  }

  // 1) Live strike/windup inside production strike band ALWAYS wins —
  //    UNLESS the boss is already frozen (production skips frozen AI; no damage).
  if (!frozen && boss && STRIKE.has(boss.phase || "") && boss.d <= BOSS_STRIKE_R + 0.15) {
    if (dodgeReady(player)) return { kind: "dodge", reason: `boss-${boss.phase} d=${boss.d.toFixed(2)}` };
    // Sidestep — never radial-out through the gate when already in the courtyard.
    const dx = player.x - boss.x;
    const dz = player.z - boss.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      let tx: number;
      let tz: number;
      if (opts.inCourtyard) {
        // Perpendicular to the boss→player ray; pick the side that stays inside.
        const px = -dz / len;
        const pz = dx / len;
        tx = player.x + px * 2.4;
        tz = player.z + pz * 2.4;
        if (tz > -1.6 || tz < -6.2) {
          tx = player.x - px * 2.4;
          tz = player.z - pz * 2.4;
        }
        tx = Math.min(9.5, Math.max(2.5, tx));
        tz = Math.min(-1.6, Math.max(-6.2, tz));
      } else {
        tx = player.x + (dx / len) * 3;
        tz = player.z + (dz / len) * 3;
      }
      return {
        kind: "move",
        tx,
        tz,
        reason: `strike-no-dodge d=${boss.d.toFixed(2)} court=${opts.inCourtyard}`,
      };
    }
    return { kind: "wait", reason: "strike-no-vector" };
  }

  // 2) Out of courtyard: re-enter via gate, but only look/move — no attack.
  //    After each look/move the caller must re-sample (threats rechecked next step).
  if (outOfCourt) {
    const look = decideLookToward(player, anchor);
    if (look.kind === "turn") return { kind: "look", key: look.key, reason: "reenter-look", err: look.err };
    return { kind: "move", tx: anchor.x, tz: anchor.z, reason: "reenter-move" };
  }

  if (!boss) {
    const look = decideLookToward(player, anchor);
    if (look.kind === "turn") return { kind: "look", key: look.key, reason: "no-boss-look", err: look.err };
    return { kind: "wait", reason: "no-boss" };
  }

  // 3) Recover / detect / hurt / frozen: use production hit range 3.45.
  //    Close only if outside that range; swing when cam-facing.
  if (boss.phase === "recover" || boss.phase === "detect" || boss.phase === "hurt" || frozen) {
    // After look-only, bodyYaw lags cam — production attack re-faces from cam.
    const camFace = (() => {
      const dx = boss.x - player.x;
      const dz = boss.z - player.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-5) return true;
      const fx = -Math.sin(player.camYaw);
      const fz = -Math.cos(player.camYaw);
      return (dx * fx + dz * fz) / len >= 0.55;
    })();
    if (!camFace) {
      const look = decideLookToward(player, boss, 0.32);
      if (look.kind === "turn") return { kind: "look", key: look.key, reason: `face-${boss.phase ?? "frozen"}`, err: look.err };
    }
    // Production hit band: HEAVY+0.6 = 3.45. Do not walk into the boss body.
    if (boss.d > BOSS_HIT_R - 0.15) {
      return { kind: "move", tx: boss.x, tz: boss.z, reason: `close-hit d=${boss.d.toFixed(2)} frozen=${frozen}` };
    }
    if (player.attackPhase && player.attackPhase !== "idle") {
      return { kind: "wait", reason: `attack-busy ${player.attackPhase}` };
    }
    // Production meleeHit would miss (arc/height/LOS proxy) — re-align instead of a wasted swing.
    if (opts.canMeleeHit === false) {
      const look = decideLookToward(player, boss, 0.25);
      if (look.kind === "turn") return { kind: "look", key: look.key, reason: "realign-for-hit", err: look.err };
      return { kind: "move", tx: boss.x, tz: boss.z, reason: "realign-for-hit-close" };
    }
    return { kind: "attack", reason: `punish-${boss.phase ?? "frozen"} d=${boss.d.toFixed(2)} frozen=${frozen}` };
  }

  // 4) approach / idle: keep outside the strike band; do not walk into windup.
  if (boss.d < BOSS_SAFE_R) {
    const dx = player.x - boss.x;
    const dz = player.z - boss.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      return {
        kind: "move",
        tx: player.x + (dx / len) * 2.2,
        tz: player.z + (dz / len) * 2.2,
        reason: `spacing d=${boss.d.toFixed(2)} phase=${boss.phase}`,
      };
    }
  }

  // 5) Far: look toward boss, then close one short step (re-sample after each).
  const look = decideLookToward(player, boss, 0.35);
  if (look.kind === "turn") return { kind: "look", key: look.key, reason: "close-look", err: look.err };
  if (boss.d > BOSS_SAFE_R) {
    return { kind: "move", tx: boss.x, tz: boss.z, reason: `close d=${boss.d.toFixed(2)}` };
  }
  return { kind: "wait", reason: `hold d=${boss.d.toFixed(2)} phase=${boss.phase}` };
}

/** Courtyard band: between front wall (z≈−1) and keep south (z≈−7), near x=6. */
export function isInCourtyard(x: number, z: number) {
  return z < -1.2 && z > -7 && Math.abs(x - 6) < 5;
}
