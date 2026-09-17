/**
 * Pure climb control decisions for the 11.7 tower ascent harness.
 * Order is authoritative — callers must evaluate in this sequence:
 *   death/invalid → REST (grounded ledge + low stamina) → REST wait →
 *   DESCEND (climbing + low stamina) → ASCEND (climbing) →
 *   SUMMIT interact at activate height (before regrab) →
 *   APPROACH/REGRAB (grounded near wall).
 * maxY is diagnostics only — never a control input.
 */

export type ClimbTelemetry = {
  state: string;
  mode?: string;
  y: number;
  stamina: number;
  hp?: number;
  nearestClimbId?: string | null;
  prompt?: string;
  towers?: string[];
  interactVisible?: boolean;
};

export type ClimbPhase = "DEAD" | "REST" | "REST_WAIT" | "DESCEND" | "ASCEND" | "APPROACH" | "SUMMIT_INTERACT" | "FAIL";

export type ClimbDecision = {
  phase: ClimbPhase;
  reason: string;
  /** Release all owned pointers / stop driving. */
  releaseInput: boolean;
  /** Attempt interact button only when true. */
  tryInteract: boolean;
  /** Attempt climb button only when true. */
  tryClimb: boolean;
};

const LEDGE_HINTS = ["spiral", "ledge", "cap"];

export function isRestSupportId(id: string | null | undefined) {
  if (!id) return false;
  return LEDGE_HINTS.some((h) => id.includes(h));
}

/**
 * Single decision step. Pure — no side effects.
 * @param t current telemetry
 * @param restRecovered stamina threshold to leave REST (default 85)
 * @param restTimeoutMs how long REST may wait before FAIL
 * @param restElapsedMs time already spent in REST
 */
export function decideClimbAction(
  t: ClimbTelemetry,
  opts: {
    restRecovered?: number;
    restTimeoutMs?: number;
    restElapsedMs?: number;
    activateY?: number;
    /** Target tower id for already-lit short-circuit (default dawn). */
    targetTowerId?: string;
  } = {},
): ClimbDecision {
  const restRecovered = opts.restRecovered ?? 85;
  const restTimeoutMs = opts.restTimeoutMs ?? 8000;
  const restElapsedMs = opts.restElapsedMs ?? 0;
  const activateY = opts.activateY ?? Infinity;
  const targetTowerId = opts.targetTowerId ?? "dawn";

  // 1) Terminal
  if (t.state === "dead" || t.mode === "dead" || (t.hp !== undefined && t.hp <= 0)) {
    return { phase: "DEAD", reason: "dead", releaseInput: true, tryInteract: false, tryClimb: false };
  }
  if (t.mode && t.mode !== "playing") {
    return { phase: "FAIL", reason: `mode=${t.mode}`, releaseInput: true, tryInteract: false, tryClimb: false };
  }

  // Already lit (target tower only — mere climb must not short-circuit on dawn)
  if (t.towers?.includes(targetTowerId)) {
    return { phase: "SUMMIT_INTERACT", reason: "already-lit", releaseInput: true, tryInteract: false, tryClimb: false };
  }

  // 2) Active REST session (already entered) — wait / finish / timeout
  if (t.state === "grounded" && restElapsedMs > 0) {
    if (t.stamina >= restRecovered) {
      // recovered — caller may leave REST; fall through to approach/ascend
    } else if (restElapsedMs >= restTimeoutMs) {
      return { phase: "FAIL", reason: `rest-timeout stam=${t.stamina.toFixed(1)}`, releaseInput: true, tryInteract: false, tryClimb: false };
    } else {
      return { phase: "REST_WAIT", reason: "recovering", releaseInput: true, tryInteract: false, tryClimb: false };
    }
  }

  // 3) Enter REST: grounded ledge + low stamina (no climb spam)
  if (t.state === "grounded" && t.stamina < 45 && isRestSupportId(t.nearestClimbId)) {
    return { phase: "REST", reason: `rest-ledge stam=${t.stamina.toFixed(1)}`, releaseInput: true, tryInteract: false, tryClimb: false };
  }

  // 4) Climbing + low stamina → DESCEND toward rest (not ascend)
  if (t.state === "climbing" && t.stamina < 8) {
    return { phase: "DESCEND", reason: "low-stam-while-climbing", releaseInput: false, tryInteract: false, tryClimb: true };
  }

  // 5) Valid climbing → ASCEND
  if (t.state === "climbing") {
    return { phase: "ASCEND", reason: "climbing", releaseInput: false, tryInteract: false, tryClimb: true };
  }

  // 6) Summit BEFORE regrab: grounded on the cap at activate height must light
  // the tower — otherwise APPROACH on dawn-shaft loops forever (R24).
  if (t.state !== "climbing" && t.y >= activateY && t.interactVisible) {
    return { phase: "SUMMIT_INTERACT", reason: "at-activate-height", releaseInput: false, tryInteract: true, tryClimb: false };
  }

  // 7) Grounded near wall (but not resting) → APPROACH / regrab
  if (t.state === "grounded" && t.nearestClimbId && (t.nearestClimbId.includes("shaft") || t.nearestClimbId.includes("tower"))) {
    const stamOk = t.stamina >= 8;
    if (!stamOk) {
      // grounded low stam without ledge id → still REST-like wait if we just treat as recover
      return { phase: "REST", reason: "grounded-low-stam-near-shaft", releaseInput: true, tryInteract: false, tryClimb: false };
    }
    return { phase: "APPROACH", reason: "regrab", releaseInput: false, tryInteract: false, tryClimb: true };
  }

  // Airborne after stamina zero while climbing — treat as fall; do not SUMMIT
  if (t.state === "airborne") {
    return { phase: "DESCEND", reason: "airborne-fall", releaseInput: false, tryInteract: false, tryClimb: false };
  }

  return { phase: "FAIL", reason: `unhandled state=${t.state} stam=${t.stamina.toFixed(1)}`, releaseInput: true, tryInteract: false, tryClimb: false };
}
