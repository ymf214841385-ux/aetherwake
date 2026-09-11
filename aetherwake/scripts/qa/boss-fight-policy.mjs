/**
 * Boss fight input decision — extracted so Review16 can unit-test the
 * actual branch that swallowed swings at hp=0.25 dist=2.2 bossHp=20.
 *
 * Pure function: no game writes. Returns the next harness action.
 */

/** Melee band: sword reach ~2.15–2.75 with boss bonus; stay out of body (d<1.8). */
export const BOSS_MELEE_MIN = 1.85;
export const BOSS_MELEE_MAX = 2.55;
export const BOSS_TELEGRAPH = new Set(["windup", "strike"]);
/** Low player HP threshold that used to force back-off even in melee. */
export const LOW_HP = 0.85;

/**
 * @param {object} s snapshot
 * @param {number} s.hp player hp
 * @param {number} s.dist player→boss
 * @param {string} s.bossPhase
 * @param {number} s.bossHp
 * @param {string} s.state grounded|airborne|...
 * @param {number} s.dodgeCd
 * @param {number} s.attackPhase
 * @param {number} s.faceDot facing alignment 0..1
 * @returns {{action:"back-off"|"dodge"|"swing"|"hold-attack"|"wait-facing"|"approach"|"back-off-too-close", reason:string}}
 */
export function bossFightDecision(s) {
  const telegraph = BOSS_TELEGRAPH.has(s.bossPhase);
  const inMelee = s.dist >= BOSS_MELEE_MIN && s.dist <= BOSS_MELEE_MAX;
  const lowHp = s.hp < LOW_HP;

  // Telegraph: dodge whenever cooldown is ready — including after our own
  // dodge left us airborne (kill4 dec#10: windup cd=0 → hold-attack → dead).
  // I-frames cover the dash; holding into the strike is what killed us.
  if (telegraph && (s.dodgeCd ?? 0) <= 0.04) {
    return { action: "dodge", reason: "telegraph" };
  }
  // Telegraph but dodge on cooldown: never swing into the strike (run #64 died).
  // If already inside boss melee threat and grounded, retreating is safer.
  // Airborne retreat walked off the west ledge (run 50116: y=3.5 then dead).
  if (telegraph) {
    if (s.state === "grounded" && s.dist < BOSS_MELEE_MAX + 1.0) {
      return { action: "back-off", reason: `telegraph-cd=${s.dodgeCd} retreat` };
    }
    // kill4 dec#20: hold at d=0.65 into the hit. Even airborne, leave the body.
    if (s.dist < BOSS_MELEE_MIN) {
      return { action: "back-off-too-close", reason: `telegraph-inside d=${s.dist.toFixed(2)}` };
    }
    return { action: "hold-attack", reason: `telegraph-cd=${s.dodgeCd}` };
  }
  // Low HP: back off only when already inside melee but cannot swing (mid-swing
  // or too close). Outside melee, keep approaching so we can re-enter and finish.
  // Review17 stall: hp=0.25 d=3.9 bossHp=16.4 oscillated approach/back-off forever
  // because MELEE_MAX+1.5 blocked re-entry. 41902 sample (d=2.2 recover) still swings.
  if (lowHp) {
    if (inMelee && s.attackPhase === "idle") {
      return { action: "swing", reason: `low-hp-melee d=${s.dist.toFixed(2)}` };
    }
    if (s.dist < BOSS_MELEE_MAX) {
      return { action: "back-off", reason: `low-hp-inside d=${s.dist.toFixed(2)}` };
    }
    // Outside melee: approach (bounded, not infinite retreat).
  }
  // Review18: do NOT low-hp dodge while merely closing. Real 054532 died with
  // swings=0 because d≈2.7–3.0 approach ticks dodged away before melee (2.55).
  // Telegraph already dodges; recover/hurt must press into swing.
  if (s.dist < BOSS_MELEE_MIN) {
    return { action: "back-off-too-close", reason: "inside-body" };
  }
  if (s.dist > BOSS_MELEE_MAX) {
    return { action: "approach", reason: "out-of-reach" };
  }
  if (s.attackPhase && s.attackPhase !== "idle") {
    return { action: "hold-attack", reason: "swing-recover" };
  }
  if ((s.faceDot ?? 1) < 0.75) {
    return { action: "wait-facing", reason: `face=${(s.faceDot ?? 0).toFixed(2)}` };
  }
  return { action: "swing", reason: `melee d=${s.dist.toFixed(2)} bossHp=${s.bossHp}` };
}

/**
 * Play-routes citadel dispatcher. A dodge/approach/etc. must not fall through
 * into swing. Swing only when decision is swing AND pose is in melee with face.
 * Recorded 95073: after dodge to d≈6.4 recover, harness still clicked melee
 * (swings 26–29 at dist 7.0–8.28).
 */
export function nextCitadelAction(decision, snap) {
  const dist = snap?.dist;
  const faceDot = snap?.faceDot ?? 1;
  const act = decision?.action;
  if (act === "dodge") return { act: "dodge", swing: false, reason: "after-dodge-no-swing" };
  if (act === "approach") return { act: "approach", swing: false, reason: "approach" };
  if (act === "back-off") return { act: "back-off", swing: false, reason: "back-off" };
  if (act === "back-off-too-close") {
    return { act: "back-off-too-close", swing: false, reason: "too-close" };
  }
  if (act === "hold-attack") return { act: "hold-attack", swing: false, reason: "hold" };
  if (act === "wait-facing") return { act: "wait-facing", swing: false, reason: "face" };
  if (act === "swing") {
    if (!Number.isFinite(dist) || dist > BOSS_MELEE_MAX || dist < BOSS_MELEE_MIN) {
      return { act: "approach", swing: false, reason: `swing-out-of-band d=${dist}` };
    }
    if (faceDot < 0.75) {
      return { act: "wait-facing", swing: false, reason: `swing-face=${faceDot}` };
    }
    return { act: "swing", swing: true, reason: decision.reason };
  }
  return { act: "hold-attack", swing: false, reason: `unknown-${act}` };
}
