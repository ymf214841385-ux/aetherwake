/**
 * Pure policy for world clicks / look-zone short taps.
 * Explicit pick required for click-to-interact; proximity interact is E/button only.
 * Empty taps never attack.
 */

import { makeActivationId } from "./interaction.ts";

export type WorldClickSource = "mouse" | "touch-tap";

export type WorldClickDecision =
  | { kind: "interact"; targetId: string; worldId: string; activationId: string }
  | { kind: "pointer-lock" }
  | { kind: "attack" }
  | { kind: "ignore"; reason: string };

let activationSeq = 1;

export function nextActivationId(source: WorldClickSource) {
  return makeActivationId(source, activationSeq++);
}

export function decideWorldClick(opts: {
  source: WorldClickSource;
  pointerLocked: boolean;
  mode: string;
  /** Explicit raycast/pick result, if any. */
  pickedTargetId: string | null;
  /**
   * Preview of the picked target after range/world checks.
   * Proximity-only previews are ignored for mouse/touch world clicks —
   * they remain for E / interact button via a different entry.
   */
  preview: { targetId: string; worldId: string; enabled: boolean } | null;
  /** When true, allow proximity interact even without a pick (E / interact button). */
  allowProximity?: boolean;
}): WorldClickDecision {
  if (opts.mode !== "playing") {
    return { kind: "ignore", reason: "not-playing" };
  }

  // Explicit pick: only that target may fire. Out of range / wrong world → ignore, never attack.
  if (opts.pickedTargetId) {
    const p = opts.preview;
    if (p && p.targetId === opts.pickedTargetId && p.enabled) {
      return {
        kind: "interact",
        targetId: p.targetId,
        worldId: p.worldId,
        activationId: nextActivationId(opts.source),
      };
    }
    return { kind: "ignore", reason: "picked-target-unavailable" };
  }

  // Proximity interact only when explicitly allowed (E / interact button).
  if (opts.allowProximity && opts.preview && opts.preview.enabled) {
    return {
      kind: "interact",
      targetId: opts.preview.targetId,
      worldId: opts.preview.worldId,
      activationId: nextActivationId(opts.source),
    };
  }

  // Empty touch short-tap must not attack (plan §3.3).
  if (opts.source === "touch-tap") {
    return { kind: "ignore", reason: "empty-touch-tap" };
  }

  // First unlocked empty mouse click focuses pointer lock only.
  if (!opts.pointerLocked) {
    return { kind: "pointer-lock" };
  }

  return { kind: "attack" };
}
