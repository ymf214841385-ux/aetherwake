/**
 * Asset orientation calibration.
 *
 * Only assets with independent measurement get a calibration.
 * Unknown / unmeasured assets must NOT inherit an asserted π.
 *
 * Measured 2026-09-16 for shipping wanderer.glb (sha256 70148c66…705167d):
 *   hair_tie relative to head ≈ [0.0018, 0.131, -0.084]
 *   → hair at back of skull on −Z; face/chest forward on +Z.
 *   Logical sim forward is −Z (bodyFwd / applyWish).
 *   Pending: headed Idle/Walk/Run visual confirmation of face/chest/feet.
 *   Until headed evidence is attached, calibration is "provisional-measured".
 */

export type AssetOrientation = {
  /** Radians applied once on modelBasisRoot.rotation.y. 0 = identity. */
  yawCalibration: number;
  /** Documented effective forward of the authored asset in its local space. */
  authoredForward: "+z" | "-z" | "unmeasured";
  /** How the calibration was established. */
  evidence: "measured-bones" | "headed-visual" | "unmeasured";
  evidenceNote: string;
};

export const UNMEASURED_ORIENTATION: AssetOrientation = {
  yawCalibration: 0,
  authoredForward: "unmeasured",
  evidence: "unmeasured",
  evidenceNote: "No independent measurement; do not inherit asserted calibration.",
};

/** Shipping default: bone-measured +Z, provisional until headed face/chest/feet capture. */
export const DEFAULT_WANDERER_ORIENTATION: AssetOrientation = {
  yawCalibration: Math.PI,
  authoredForward: "+z",
  evidence: "measured-bones",
  evidenceNote:
    "hair_tie at head local z=-0.084 (back of head); procedural fallback WANDERER_FORWARD=+z. Headed visual pending.",
};

/** Per-asset map. Only measured assets appear here. */
const BY_ASSET: Record<string, AssetOrientation> = {
  "/assets/character/wanderer.glb": DEFAULT_WANDERER_ORIENTATION,
};

/**
 * Resolve calibration for an asset URL.
 * Unmeasured assets return identity + unmeasured — never a silent π.
 */
export function orientationForAsset(url: string): AssetOrientation {
  if (BY_ASSET[url]) return BY_ASSET[url]!;
  // Normalize common absolute/relative forms.
  const path = url.startsWith("http") ? new URL(url).pathname : url;
  if (BY_ASSET[path]) return BY_ASSET[path]!;
  if (path.endsWith("/assets/character/wanderer.glb") || path === "/assets/character/wanderer.glb") {
    return DEFAULT_WANDERER_ORIENTATION;
  }
  // v4 candidate: NOT auto-inherited. Measure before enabling.
  if (path.includes("wanderer-v4")) {
    return {
      ...UNMEASURED_ORIENTATION,
      evidenceNote: "v4 candidate not independently measured in this round.",
    };
  }
  return { ...UNMEASURED_ORIENTATION, evidenceNote: `unmeasured asset ${path}` };
}

export function registerMeasuredOrientation(url: string, orientation: AssetOrientation) {
  BY_ASSET[url] = orientation;
}
