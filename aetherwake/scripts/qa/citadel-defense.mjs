import { BOSS_TELEGRAPH, canAcceptDodge } from './boss-fight-policy.mjs';
import { citadelDodgeAim } from './citadel-steer.mjs';
import { checkFightScope, FightStopError, keysToward } from './route-navigation.mjs';

// Shared by the real play-routes branch and Sim/input integration tests.
// Readonly snapshots in; ordinary scoped keyboard holds out.
export async function executeCitadelDefense({
  snapshot: s, step, scope, fightHold, fightRead, releaseAll, note,
}) {
  checkFightScope(scope, s);
  const telegraph = BOSS_TELEGRAPH.has(s?.boss?.phase);
  const retreat = step.act === 'back-off' || step.act === 'back-off-too-close';
  if (step.act !== 'dodge' && !retreat && !(telegraph && step.act === 'hold-attack')) {
    return { handled: false };
  }
  const pre = structuredClone(s);
  const lastReadBeforeAction = scope?.lastSnapshot;
  // Honor both the production gate and an explicit readonly rejection.
  const dodge = (step.act === 'dodge' || step.act === 'back-off') &&
    canAcceptDodge(s) && s.canDodge !== false;
  let target = null, keys = [], ms = 90;
  if (dodge || (telegraph && (retreat || step.act === 'dodge'))) {
    target = citadelDodgeAim(s, s.boss);
    keys = keysToward(s, target.x, target.z, false);
    if (target.safe === false || keys.length === 0) {
      const evidence = { decision: step.decision ?? step, target,
        reason: 'no-safe-direction', pre, post: structuredClone(s) };
      if (scope) {
        scope.lastSnapshot = s;
        scope.defensiveFailure ??= evidence;
        scope.abort.abort('no-safe-direction');
      }
      try { note(`citadel defense ${JSON.stringify(evidence)}`); }
      finally { await releaseAll(); }
      checkFightScope(scope);
      throw new FightStopError('no-safe-direction');
    }
    if (dodge) keys.unshift('KeyC');
    ms = dodge ? 280 : step.act === 'back-off-too-close' ? 180 : 220;
  } else if (retreat) {
    // Preserve non-telegraph ordinary back-off steering and durations.
    keys = ['KeyS', 'KeyA'];
    ms = step.act === 'back-off-too-close' ? 180 : 220;
  }
  let post = null;
  try {
    await fightHold(keys, ms);
    post = await fightRead();
    checkFightScope(scope, post);
  } catch (err) {
    // checkedRead retains the actual observation before throwing on death.
    // A read/monitor abort without a fresh observation must not invent a post.
    post ??= scope?.lastSnapshot !== lastReadBeforeAction ? scope?.lastSnapshot ?? null : null;
    const evidence = { decision: step.decision ?? step, target,
      reason: scope?.abort.reason ?? String(err?.message ?? err), keys, pre, post };
    if (scope) scope.defensiveFailure ??= structuredClone(evidence);
    note(`citadel defense ${JSON.stringify(evidence)}`);
    throw err;
  }
  note(`citadel defense ${JSON.stringify({ decision: step.decision ?? step,
    target, reason: target?.reason ?? step.reason, keys, pre, post })}`);
  return { handled: true, snapshot: post };
}
