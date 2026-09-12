/**
 * E1: production combat-progress monitor + abort latch.
 * Pure/serial — no key/mouse, no resumePlay, no sim writes.
 * now() is injected: runtime performance.now, tests fake clock.
 */

export const COMBAT_MAX_HZ = 8;
export const COMBAT_MAX_DY = 3;
export const NO_DAMAGE_MS = 15000;
export const SAMPLE_GAP_MS = 500;
export const RING_MS = 10000;
export const RING_MAX = 101;
export const SAMPLE_BEAT_MS = 100;

/** classify one read() snapshot. */
export function classifyFightSnapshot(s) {
  if (!s) return "unknown";
  if (s.mode !== "playing") return "unknown";
  const playerAlive =
    s.state !== "dead" && !(Number.isFinite(s.hp) && s.hp <= 0);
  if (!playerAlive) return "dead";
  const boss = s.boss;
  if (!boss || boss.alive === false) return "unknown";
  if (s.sealOpen !== true) return "unknown";
  const hz = Math.hypot(s.x - boss.x, s.z - boss.z);
  const dy = Math.abs((s.y ?? 0) - (boss.y ?? 0));
  if (hz <= COMBAT_MAX_HZ && dy <= COMBAT_MAX_DY) return "combat";
  return "navigation";
}

/**
 * Create monitor. onEvent({type,...}) is append-only evidence.
 * @param {{now:()=>number, onEvent?:(e:object)=>void}} deps
 */
export function createCombatProgressMonitor({ now, onEvent }) {
  if (typeof now !== "function") throw new Error("monitor requires now()");
  const ring = [];
  let lastValid = null;
  let combatMs = 0;
  let navMs = 0;
  let noDamageMs = 0;
  let lastBossHp = null;
  let stopped = false;
  let latched = null; // {reason, t, snap}
  const emit = (e) => {
    try {
      onEvent?.(e);
    } catch {
      /* ignore */
    }
  };

  function pushRing(entry) {
    ring.push(entry);
    const cutoff = now() - RING_MS;
    while (ring.length > RING_MAX || (ring.length && ring[0].t < cutoff)) {
      ring.shift();
    }
  }

  return {
    get ring() {
      return ring.slice();
    },
    get combatMs() {
      return combatMs;
    },
    get navMs() {
      return navMs;
    },
    get noDamageMs() {
      return noDamageMs;
    },
    get latched() {
      return latched;
    },
    get stopped() {
      return stopped;
    },
    /**
     * @param {object|null} s snapshot from read()
     * @param {object} [meta] { input: {action, t} }
     */
    observe(s, meta = {}) {
      if (stopped) return { stopped: true, latched };
      const t = now();
      const phase = classifyFightSnapshot(s);
      const entry = {
        t,
        phase,
        hp: s?.hp ?? null,
        state: s?.state ?? null,
        x: s?.x ?? null,
        y: s?.y ?? null,
        z: s?.z ?? null,
        stamina: s?.stamina ?? null,
        dodgeCd: s?.dodgeCd ?? null,
        dodgeT: s?.dodgeT ?? null,
        bossX: s?.boss?.x ?? null,
        bossY: s?.boss?.y ?? null,
        bossZ: s?.boss?.z ?? null,
        bossHp: s?.boss?.hp ?? null,
        bossPhase: s?.boss?.phase ?? null,
        bossMeleeBlocked: s?.bossMeleeBlocked ?? null,
        blockerId: s?.blockerId ?? null,
        lastInput: meta.input ?? null,
      };
      pushRing(entry);

      if (phase === "dead") {
        latched = { reason: "death", t, snap: s };
        stopped = true;
        emit({ type: "latch-death", t, snap: s });
        return { stopped: true, latched };
      }

      if (phase === "unknown") {
        // Pause timing — do not accumulate combat/nav/no-damage.
        lastValid = null;
        return { phase, noDamageMs, combatMs, navMs, stopped: false };
      }

      // Valid combat or navigation
      const dt =
        lastValid && lastValid.phase !== "unknown" ? t - lastValid.t : 0;
      if (dt > 0 && dt <= SAMPLE_GAP_MS) {
        if (phase === "combat" && lastValid.phase === "combat") {
          combatMs += dt;
          noDamageMs += dt;
        } else if (phase === "navigation") {
          navMs += dt;
          // navigation never feeds combat-no-damage
        }
      } else if (dt > SAMPLE_GAP_MS) {
        emit({ type: "sample-gap", t, gapMs: dt, from: lastValid.phase, to: phase });
      }

      // Boss HP real drop resets no-damage accumulation (not combatMs).
      const bossHp = s?.boss?.hp;
      if (Number.isFinite(bossHp)) {
        if (lastBossHp != null && bossHp < lastBossHp - 0.01) {
          noDamageMs = 0;
          emit({ type: "boss-hp-drop", t, from: lastBossHp, to: bossHp });
        }
        lastBossHp = bossHp;
      }

      lastValid = { t, phase };

      if (noDamageMs >= NO_DAMAGE_MS) {
        latched = { reason: "combat-no-damage", t, noDamageMs, combatMs, navMs };
        stopped = true;
        emit({ type: "latch-combat-no-damage", ...latched });
      }
      return { phase, noDamageMs, combatMs, navMs, stopped };
    },
    stop(reason = "stopped") {
      stopped = true;
      emit({ type: "monitor-stop", t: now(), reason });
    },
  };
}

/**
 * Serial readonly sampler: read → observe → top-up to beat. No overlapping reads.
 * @param {{read:()=>Promise<any>, monitor:object, now:()=>number, wait:(ms:number)=>Promise<void>, shouldStop:()=>boolean, inputRef?:{current:object|null}}} deps
 */
export async function runCombatSampleLoop(deps) {
  const { read, monitor, now, wait, shouldStop, inputRef } = deps;
  let samples = 0;
  while (!shouldStop() && !monitor.stopped) {
    const t0 = now();
    let s = null;
    try {
      s = await read();
    } catch (err) {
      monitor.observe(null);
      emitFail(err);
      break;
    }
    monitor.observe(s, { input: inputRef?.current ?? null });
    samples += 1;
    if (monitor.stopped) break;
    const elapsed = now() - t0;
    const rest = SAMPLE_BEAT_MS - elapsed;
    if (rest > 0) await wait(rest);
  }
  return { samples, latched: monitor.latched, combatMs: monitor.combatMs, navMs: monitor.navMs, noDamageMs: monitor.noDamageMs };
  function emitFail(err) {
    try {
      monitor.stop?.(`read-error:${err?.message || err}`);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Shared abort latch for hold/goTo/follow/resumePlay in one citadel-resume run.
 */
export function createAbortLatch() {
  let reason = null;
  let at = null;
  return {
    get reason() {
      return reason;
    },
    get at() {
      return at;
    },
    get aborted() {
      return reason != null;
    },
    abort(r, t = Date.now()) {
      if (reason == null) {
        reason = r;
        at = t;
      }
      return reason;
    },
  };
}

/**
 * Wrap hold so aborted runs release keys and send nothing new.
 * @param {Function} hold original hold(keys, ms)
 * @param {() => {aborted:boolean, reason:string|null}} getAbort
 * @param {() => Promise<void>} [releaseAll]
 */
export function wrapHoldForAbort(hold, getAbort, releaseAll) {
  return async function holdChecked(keys, ms) {
    const a = typeof getAbort === "function" ? getAbort() : getAbort;
    if (a?.aborted) {
      try {
        await releaseAll?.();
      } catch {
        /* ignore */
      }
      return;
    }
    return hold(keys, ms);
  };
}

/**
 * Wrap goTo: abort → return current without walking; nav timeout is not combat failure.
 */
export function wrapGoToForAbort(goTo, getAbort) {
  return async function goToChecked(tx, tz, ms, opts = {}) {
    const a = typeof getAbort === "function" ? getAbort() : getAbort;
    if (a?.aborted) {
      return { aborted: true, reason: a.reason, x: opts.__x, z: opts.__z, nav: { arrived: false, status: "aborted" } };
    }
    return goTo(tx, tz, ms, opts);
  };
}

/**
 * focusOk=false must not call fightBoss.
 * @returns {Promise<{ok:boolean, fightBossCalled:boolean, reason:string, result?:any}>}
 */
export async function runCitadelFocusGate({ focusOk, fightBoss }) {
  if (!focusOk) {
    return { ok: false, fightBossCalled: false, reason: "precondition-failed" };
  }
  const r = await fightBoss();
  return { ok: true, fightBossCalled: true, result: r, reason: "fightboss-invoked" };
}
