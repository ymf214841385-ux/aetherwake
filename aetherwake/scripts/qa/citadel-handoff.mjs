import { CombatReady, checkFightScope } from "./route-navigation.mjs";
import { BOSS_TELEGRAPH, citadelFightStep } from "./boss-fight-policy.mjs";
import { executeLosReposition } from "./los-reposition.mjs";

// A blocked-LOS walk stops at the first actual live-combat observation. Walking
// onward to its fixed endpoint can consume recover and ignore the next strike.
// This is a combat handoff, never a claim that the navigation target arrived.
export async function runCitadelLosReposition({ scope, ...deps }) {
  const hadFlag = Object.prototype.hasOwnProperty.call(scope, "combatReposition");
  const previous = scope.combatReposition;
  scope.combatReposition = deps.start?.bossMeleeBlocked === true;
  try {
    return await executeLosReposition(deps);
  } catch (err) {
    if (!(err instanceof CombatReady)) throw err;
    checkFightScope(scope, err.snapshot);
    deps.note?.("citadel LOS walk handed back to live combat before waypoint arrival");
    return { ok: true, combatReady: true, s: err.snapshot,
      rec: { ok: true, reason: "combat-ready", arrived: false } };
  } finally {
    if (hadFlag) scope.combatReposition = previous;
    else delete scope.combatReposition;
  }
}

// The actual initial descent/follow/gate stages used by play-routes. Only this
// boundary consumes CombatReady; all failures continue to the fight stop handler.
export async function runCitadelInitialApproach({
  scope, fightRead, fightGoTo, fightFollow, tap, wait, note, WAYPOINTS, POI,
}) {
  let s;
  scope.initialApproach = true;
  try {
    const s0 = await fightRead();
    if (s0 && s0.y > 40) {
      note(`citadel dismount high y=${s0.y.toFixed(1)} at ${s0.x.toFixed(1)},${s0.z.toFixed(1)}`);

      await fightGoTo(36, -90, 22000, { arrive: 4, sprint: false, label: "citadel-off-crown", safeDescent: true });

      await fightGoTo(24, -40, 20000, { arrive: 5, sprint: true, label: "citadel-from-crown", safeDescent: true });
    }

    await fightFollow(WAYPOINTS.citadel, 40000, 4);
    // Courtyard is +Z of the keep. Static POI.citadel is the spawn, not a live lock.

    await fightGoTo(POI.citadel.x, POI.citadel.z + 8, 20000, { arrive: 3.2, sprint: true, label: "citadel-gate" });
    s = await fightRead();
  } catch (err) {
    if (!(err instanceof CombatReady)) throw err;
    // A failure arriving while hold's finally releases keys still wins.
    checkFightScope(scope, err.snapshot);
    return { snapshot: err.snapshot, combatReady: true };
  } finally {
    scope.initialApproach = false;
  }
  // Prompt is proximity-only; E is unnecessary on an early combat handoff.
  if (s?.sealOpen !== false && !s?.prompt?.includes("封印未开") &&
      s?.prompt?.includes("挑战空王")) {
    await tap("KeyE", scope);
    await wait(200);
  }
  return { snapshot: s, combatReady: false };
}

// Preserve the entry observation for the first policy/dispatcher invocation.
// Clear-LOS live telegraphs use the current camera immediately. Other later
// turns keep the original look-then-read sequence.
export function liveCitadelTelegraph(s) {
  return s?.mode === "playing" && Number.isFinite(s.hp) && s.hp > 0 &&
    s.bossDead !== true && s.boss?.alive === true && s.boss.hp > 0 &&
    s.bossMeleeBlocked === false && BOSS_TELEGRAPH.has(s.boss.phase) &&
    [s.x, s.y, s.z, s.camYaw, s.boss.x, s.boss.y, s.boss.z].every(Number.isFinite);
}
export async function prepareCitadelCombatDecision({
  snapshot, preserveSnapshot = false, scope, lookToward, fightRead,
}) {
  checkFightScope(scope, snapshot);
  let s = snapshot;
  if (!preserveSnapshot && !liveCitadelTelegraph(s)) {
    await lookToward(s.boss.x, s.boss.z, scope);
    s = await fightRead();
  }
  checkFightScope(scope, s);
  if (!s?.boss) return null;
  const dist = Math.hypot(s.x - s.boss.x, s.z - s.boss.z);
  const dx = s.boss.x - s.x, dz = s.boss.z - s.z;
  const faceDot = (dx * -Math.sin(s.camYaw) + dz * -Math.cos(s.camYaw)) / (dist || 1);
  const step = citadelFightStep({
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
    bossMeleeBlocked: Boolean(s.bossMeleeBlocked),
    blockerId: s.blockerId ?? null,
  });
  return { snapshot: s, dist, faceDot, step };
}
