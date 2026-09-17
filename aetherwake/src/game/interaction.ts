/**
 * Unified interaction resolver: one source for HUD preview, E key, touch
 * interact button, world click pick, and climb fallback.
 * Execution always revalidates world/range/height/idempotence.
 */

export type InteractAction =
  | "talk"
  | "open"
  | "cook"
  | "activate"
  | "enter"
  | "leave"
  | "collect"
  | "claim"
  | "reset";

export type InteractionTarget = {
  targetId: string;
  worldId: string;
  action: InteractAction;
  label: string;
  enabled: boolean;
  reason?: string;
  x: number;
  y: number;
  z: number;
  range: number;
  maxDy: number;
  /**
   * Solid IDs owned by this target's surface (tower shaft/cap, shrine body).
   * Only these are ignored for LOS — independent walls always block.
   */
  excludeSolidIds?: string[];
};

export type InteractionPreview = InteractionTarget | null;

export type InteractionExecution =
  | { status: "applied"; targetId: string; modeChanged: boolean; worldChanged: boolean }
  | { status: "rejected"; targetId?: string; reason: string };

export type WorldRef = string;

export type InteractionHost = {
  worldId: WorldRef;
  mode: string;
  interactLock: number;
  player: { x: number; y: number; z: number };
  /** Returns true if blocked between player and target. excludeIds = target-owned solids. */
  losBlocked?: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    opts?: { excludeIds?: string[] },
  ) => boolean;
};

export function worldIdOf(host: Pick<InteractionHost, "worldId">) {
  return host.worldId;
}

function distXZ(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

export function inRange(
  host: InteractionHost,
  t: {
    x: number;
    y: number;
    z: number;
    range: number;
    maxDy: number;
    action?: InteractAction;
    excludeSolidIds?: string[];
  },
): { ok: true } | { ok: false; reason: string } {
  const p = host.player;
  const d = distXZ(p.x, p.z, t.x, t.z);
  if (d > t.range) return { ok: false, reason: `请靠近：距离 ${d.toFixed(1)}m` };
  const dy = Math.abs(p.y - t.y);
  if (dy > t.maxDy) return { ok: false, reason: "高度差过大" };
  if (host.losBlocked?.(p, t, { excludeIds: t.excludeSolidIds })) {
    return { ok: false, reason: "视线被阻挡" };
  }
  return { ok: true };
}

/**
 * Prefer an explicit picked target; otherwise nearest *eligible* candidate.
 * Explicit disabled/out-of-range pick stays explicit (never silent swap).
 * Implicit E: nearest enabled first; unavailable preview only if none eligible.
 */
export function selectInteractionTarget(
  candidates: InteractionTarget[],
  opts?: { pickedTargetId?: string | null; host?: InteractionHost },
): InteractionPreview {
  const host = opts?.host;
  const pickedId = opts?.pickedTargetId ?? null;
  const list = candidates.filter((c) => c.enabled !== false || c.reason);

  if (pickedId) {
    const exact = list.find((c) => c.targetId === pickedId);
    if (!exact) return null;
    if (host && exact.worldId !== host.worldId) {
      return { ...exact, enabled: false, reason: "目标不在当前世界" };
    }
    if (host) {
      const r = inRange(host, exact);
      if (!r.ok) return { ...exact, enabled: false, reason: r.reason };
    }
    return exact.enabled === false ? { ...exact } : exact;
  }

  if (!host) return list[0] ?? null;

  const evaluated = list
    .map((c) => {
      if (c.worldId !== host.worldId) return { ...c, enabled: false, reason: "目标不在当前世界" };
      if (c.enabled === false) return { ...c };
      const r = inRange(host, c);
      return r.ok ? c : { ...c, enabled: false, reason: r.reason };
    })
    .sort((a, b) => {
      const da = distXZ(host.player.x, host.player.z, a.x, a.z);
      const db = distXZ(host.player.x, host.player.z, b.x, b.z);
      return da - db;
    });

  // Nearest eligible wins over a nearer disabled/failed object.
  const eligible = evaluated.find((c) => c.enabled !== false);
  if (eligible) return eligible;
  // Only when nothing is usable, surface the nearest unavailable for explanation.
  return evaluated[0] ?? null;
}

/** Execution-time revalidation. Preview may be stale. */
export function revalidateInteraction(
  host: InteractionHost,
  target: InteractionTarget,
): { ok: true; target: InteractionTarget } | { ok: false; reason: string } {
  if (host.mode !== "playing") return { ok: false, reason: "当前模式不可交互" };
  if (host.interactLock > 0) return { ok: false, reason: "交互冷却中" };
  if (target.worldId !== host.worldId) return { ok: false, reason: "目标不在当前世界" };
  if (!target.enabled) return { ok: false, reason: target.reason || "目标不可用" };
  const r = inRange(host, target);
  if (!r.ok) return r;
  return { ok: true, target };
}

export type ActivationRecord = {
  activationId: string;
  targetId: string;
  worldId: string;
  at: number;
};

/** One activation id must produce at most one applied execution. */
export class ActivationLedger {
  private used = new Set<string>();
  private order: string[] = [];

  mark(activationId: string) {
    if (this.used.has(activationId)) return false;
    this.used.add(activationId);
    this.order.push(activationId);
    if (this.order.length > 64) {
      const drop = this.order.shift();
      if (drop) this.used.delete(drop);
    }
    return true;
  }

  has(activationId: string) {
    return this.used.has(activationId);
  }

  clear() {
    this.used.clear();
    this.order.length = 0;
  }
}

export function makeActivationId(source: string, seq: number) {
  return `${source}:${seq}:${Math.random().toString(36).slice(2, 8)}`;
}
