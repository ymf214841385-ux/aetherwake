/**
 * D4.1: citadel-resume focus plan. Only QA_FOCUS=citadel selects checkpoint
 * restore + fightBoss; other focuses stay full-route / dedicated climbs.
 */
export const CITADEL_RESUME_FOCUS = "citadel";

/**
 * @param {{focus?: string|null, ckptPath?: string|null}} opts
 * @returns {{ok:boolean, mode:string, fightBoss:boolean, ckptPath?:string, reason?:string}}
 */
export function citadelResumePlan({ focus, ckptPath } = {}) {
  if (focus === CITADEL_RESUME_FOCUS) {
    if (!ckptPath) {
      return {
        ok: false,
        mode: "citadel-resume",
        fightBoss: false,
        reason: "citadel-focus-requires-QA_STORAGE_CHECKPOINT",
      };
    }
    return {
      ok: true,
      mode: "citadel-resume",
      fightBoss: true,
      ckptPath,
    };
  }
  return { ok: true, mode: "default-route", fightBoss: false };
}

/** Prove injected v2 string matches source file bytes (no rewrite). */
export function v2MatchesSource(sourceV2, injectedV2) {
  if (typeof sourceV2 !== "string" || typeof injectedV2 !== "string") return false;
  return sourceV2 === injectedV2;
}
