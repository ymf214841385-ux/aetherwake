/**
 * Multi-enemy combat threat decision (QA controller).
 * Pure — no DOM. Uses live enemy phases and player combat state.
 * Does NOT weaken enemies; only chooses legal dodge / attack / flee / continue.
 */

export type EnemyThreat = {
  id: string;
  d: number;
  phase: string | null;
  x?: number;
  z?: number;
};

export type CombatState = {
  hp: number;
  stamina: number;
  dodgeCd?: number;
  invuln?: number;
  attackIdle?: boolean;
  facingYaw?: number;
  player?: { x: number; z: number };
};

export type CombatAction =
  | { kind: "dodge"; reason: string; enemyId: string }
  | { kind: "flee"; reason: string; dx: number; dz: number }
  | { kind: "attack"; reason: string; enemyId: string }
  | { kind: "continue"; reason: string };

const STRIKE = new Set(["windup", "strike"]);
const NEAR_MELEE = 2.8;
const DANGER = 3.6;
const FLEE_DANGER = 2.2;

/** Among threats, pick highest priority: strike > approach > recover/detect. */
export function pickPriorityThreat(enemies: EnemyThreat[]): EnemyThreat | null {
  let best: EnemyThreat | null = null;
  let bestRank = -1;
  for (const e of enemies) {
    if (!e || e.d > DANGER) continue;
    let rank = -1;
    if (STRIKE.has(e.phase || "") && e.d < DANGER) rank = 3;
    else if (e.phase === "approach" && e.d < DANGER) rank = 2;
    else if ((e.phase === "recover" || e.phase === "detect") && e.d < NEAR_MELEE) rank = 1;
    if (rank > bestRank) {
      bestRank = rank;
      best = e;
    }
  }
  return best;
}

/**
 * Decide next combat action.
 * - windup/strike nearby → dodge (or flee if dodge unavailable)
 * - multiple windup + very close → flee away from cluster
 * - recover near + attack available + can face → attack
 * - else continue traversal
 */
export function decideCombatAction(
  enemies: EnemyThreat[],
  state: CombatState,
  opts: { attackAvailable?: boolean; canFaceEnemy?: boolean; dodgeAvailable?: boolean } = {},
): CombatAction {
  const threat = pickPriorityThreat(enemies);
  if (!threat) return { kind: "continue", reason: "no-threat" };

  const dodgeAvailable = opts.dodgeAvailable !== false && state.stamina > 20 && (state.dodgeCd ?? 0) <= 0;
  const attackAvailable = opts.attackAvailable !== false && (state.attackIdle !== false);
  const canFace = opts.canFaceEnemy !== false;

  // Cluster: ≥2 strike threats within FLEE_DANGER — prefer dodge+move over bare flee
  const strikeClose = enemies.filter((e) => STRIKE.has(e.phase || "") && e.d < FLEE_DANGER);
  if (strikeClose.length >= 2) {
    if (dodgeAvailable) {
      return { kind: "dodge", reason: `cluster-strike-dodge x${strikeClose.length}`, enemyId: threat.id };
    }
    // Flee only if dodge unavailable AND direction is non-zero
    if (state.player && strikeClose.every((e) => e.x != null && e.z != null)) {
      let ax = 0;
      let az = 0;
      for (const e of strikeClose) {
        ax += (e.x ?? 0) - state.player.x;
        az += (e.z ?? 0) - state.player.z;
      }
      const len = Math.hypot(ax, az);
      if (len > 1e-4) {
        return { kind: "flee", reason: `cluster-strike-flee x${strikeClose.length}`, dx: -ax / len, dz: -az / len };
      }
    }
  }

  if (STRIKE.has(threat.phase || "")) {
    if (dodgeAvailable) return { kind: "dodge", reason: `strike-${threat.phase}`, enemyId: threat.id };
    if (state.player && threat.x != null && threat.z != null) {
      const dx = state.player.x - threat.x;
      const dz = state.player.z - threat.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        return { kind: "flee", reason: "strike-no-dodge", dx: dx / len, dz: dz / len };
      }
    }
    return { kind: "continue", reason: "strike-no-action" };
  }

  if (threat.phase === "approach" && threat.d < NEAR_MELEE && dodgeAvailable) {
    return { kind: "dodge", reason: "approach-close", enemyId: threat.id };
  }

  if ((threat.phase === "recover" || threat.phase === "detect" || threat.phase === "approach") && threat.d < NEAR_MELEE) {
    if (attackAvailable && canFace) {
      return { kind: "attack", reason: `melee-${threat.phase}`, enemyId: threat.id };
    }
    if (dodgeAvailable) return { kind: "dodge", reason: "melee-no-attack", enemyId: threat.id };
  }

  return { kind: "continue", reason: `low-${threat.phase ?? "?"}` };
}
