/**
 * E1/E1.1: production combat-progress monitor + shared abort orchestrator.
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
export const HOLD_SLICE_MS = 100;

/** classify one read() snapshot. Death wins before mode gate. */
export function classifyFightSnapshot(s) {
  if (!s) return "unknown";
  // E1.1: mode dead / state dead / hp<=0 — any one is death, before playing gate.
  if (
    s.mode === "dead" ||
    s.state === "dead" ||
    (Number.isFinite(s.hp) && s.hp <= 0)
  ) {
    return "dead";
  }
  if (s.mode !== "playing") return "unknown";
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
  let latched = null;
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
        return { stopped: true, latched, phase };
      }

      if (phase === "unknown") {
        lastValid = null;
        return { phase, noDamageMs, combatMs, navMs, stopped: false };
      }

      const dt =
        lastValid && lastValid.phase !== "unknown" ? t - lastValid.t : 0;
      if (dt > 0 && dt <= SAMPLE_GAP_MS) {
        if (phase === "combat" && lastValid.phase === "combat") {
          combatMs += dt;
          noDamageMs += dt;
        } else if (phase === "navigation") {
          navMs += dt;
        }
      } else if (dt > SAMPLE_GAP_MS) {
        emit({ type: "sample-gap", t, gapMs: dt, from: lastValid.phase, to: phase });
      }

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
      try {
        monitor.stop(`read-error:${err?.message || err}`);
      } catch {
        /* ignore */
      }
      break;
    }
    if (shouldStop() || monitor.stopped) break;
    monitor.observe(s, { input: inputRef?.current ?? null });
    samples += 1;
    if (monitor.stopped) break;
    const elapsed = now() - t0;
    const rest = SAMPLE_BEAT_MS - elapsed;
    if (rest > 0) await wait(rest);
  }
  return {
    samples,
    latched: monitor.latched,
    combatMs: monitor.combatMs,
    navMs: monitor.navMs,
    noDamageMs: monitor.noDamageMs,
  };
}

/** Shared abort latch — first reason wins. */
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
 * hold sliced to HOLD_SLICE_MS so abort can release keys mid-input.
 * Does not let the sampler send keys — only the action executor calls this.
 */
export function wrapHoldForAbort(hold, getAbort, releaseAll, { sliceMs = HOLD_SLICE_MS, wait } = {}) {
  return async function holdChecked(keys, ms) {
    const a = typeof getAbort === "function" ? getAbort() : getAbort;
    if (a?.aborted) {
      try {
        await releaseAll?.();
      } catch {
        /* ignore */
      }
      return { aborted: true, reason: a.reason };
    }
    // Slice long holds so abort can fire between segments.
    let remaining = ms;
    while (remaining > 0) {
      const cur = typeof getAbort === "function" ? getAbort() : getAbort;
      if (cur?.aborted) {
        try {
          await releaseAll?.();
        } catch {
          /* ignore */
        }
        return { aborted: true, reason: cur.reason };
      }
      const slice = Math.min(sliceMs, remaining);
      await hold(keys, slice);
      remaining -= slice;
      if (remaining > 0 && wait) await wait(0);
    }
    return { aborted: false };
  };
}

/**
 * Wrap goTo: abort → dedicated stop (no fake x/z); nav timeout ≠ combat failure.
 * Internal goTo still uses original implementation; callers must also use
 * scoped resumePlay/goTo that check abort each read.
 */
export function wrapGoToForAbort(goTo, getAbort) {
  return async function goToChecked(tx, tz, ms, opts = {}) {
    const a = typeof getAbort === "function" ? getAbort() : getAbort;
    if (a?.aborted) {
      // E1.1: no fabricated coordinates — dedicated stop reason only.
      return {
        aborted: true,
        reason: a.reason,
        nav: { arrived: false, status: "aborted", stopReason: a.reason },
      };
    }
    return goTo(tx, tz, ms, opts);
  };
}

/**
 * resumePlay wrapper: death before resume latches abort and refuses revive.
 * @param {Function} resumePlay original
 * @param {Function} read
 * @param {{aborted:boolean, reason:string|null}|Function} getAbort
 * @param {(reason:string)=>void} abort
 */
export function wrapResumePlayForAbort(resumePlay, read, getAbort, abort) {
  return async function resumePlayChecked() {
    const a = typeof getAbort === "function" ? getAbort() : getAbort;
    if (a?.aborted) return null;
    // Read raw state BEFORE resumePlay (which auto-revives).
    let raw = null;
    try {
      raw = await read();
    } catch {
      /* fall through — resumePlay may still handle overlay */
    }
    if (
      raw &&
      (raw.mode === "dead" || raw.state === "dead" || (Number.isFinite(raw.hp) && raw.hp <= 0))
    ) {
      abort?.("death-before-resume");
      return raw;
    }
    return resumePlay();
  };
}

/**
 * tryMeleeClick wrapper: abort → no click.
 */
export function wrapClickForAbort(tryClick, getAbort) {
  return async function clickChecked() {
    const a = typeof getAbort === "function" ? getAbort() : getAbort;
    if (a?.aborted) return { aborted: true, reason: a.reason };
    return tryClick();
  };
}

/**
 * follow wrapper: each leg checks abort; nav timeout is not combat failure.
 */
export function wrapFollowForAbort(follow, getAbort) {
  return async function followChecked(points, msEach, arrive) {
    const a0 = typeof getAbort === "function" ? getAbort() : getAbort;
    if (a0?.aborted) {
      return { aborted: true, reason: a0.reason, nav: { arrived: false, status: "aborted" } };
    }
    return follow(points, msEach, arrive);
  };
}

/**
 * Production orchestrator: shared abort + monitor + scoped helpers.
 * @param {object} deps
 * @param {()=>Promise<any>} deps.read
 * @param {(keys:string[],ms:number)=>Promise<any>} deps.hold
 * @param {(x:number,z:number,ms:number,opts?:object)=>Promise<any>} deps.goTo
 * @param {(pts:any[],ms?:number,arrive?:number)=>Promise<any>} deps.follow
 * @param {()=>Promise<any>} deps.resumePlay
 * @param {()=>Promise<any>} deps.tryMeleeClick
 * @param {()=>Promise<void>} deps.releaseAll
 * @param {()=>number} deps.now
 * @param {(ms:number)=>Promise<void>} deps.wait
 * @param {(m:string)=>void} [deps.note]
 */
export function createFightOrchestrator(deps) {
  const {
    read,
    hold,
    goTo,
    follow,
    resumePlay,
    tryMeleeClick,
    releaseAll,
    now,
    wait,
    note,
  } = deps;
  const abort = createAbortLatch();
  const monitor = createCombatProgressMonitor({
    now,
    onEvent: (ev) => {
      // E1.1: death / no-damage / read-error all drive shared stop (first reason).
      if (ev.type === "latch-death") abort.abort("death");
      else if (ev.type === "latch-combat-no-damage") abort.abort("combat-no-damage");
      else if (ev.type === "monitor-stop" && String(ev.reason || "").startsWith("read-error:")) {
        abort.abort(ev.reason);
      }
      try {
        note?.(`citadel-mon ${JSON.stringify(ev)}`);
      } catch {
        /* ignore */
      }
    },
  });
  const lastInput = { current: null };
  const scope = { abort, markInput(action) { lastInput.current = { action, t: now() }; } };
  const scopedHold = (keys, ms) => hold(keys, ms, scope);
  const scopedGoTo = (x, z, ms, opts) => goTo(x, z, ms, opts, scope);
  const scopedFollow = (points, ms, arrive) => follow(points, ms, arrive, scope);
  const scopedResume = () => resumePlay(scope);
  const scopedClick = () => tryMeleeClick(scope);

  let samplePromise = null;
  function startSampling() {
    if (samplePromise) return samplePromise;
    samplePromise = runCombatSampleLoop({
      read,
      monitor,
      now,
      wait,
      shouldStop: () => abort.aborted || monitor.stopped,
      inputRef: lastInput,
    });
    return samplePromise;
  }
  async function stopSampling(reason = "stopped") {
    monitor.stop(reason);
    if (samplePromise) {
      try {
        await samplePromise;
      } catch {
        /* ignore */
      }
    }
    return monitor;
  }

  return {
    abort,
    scope,
    monitor,
    lastInput,
    hold: scopedHold,
    goTo: scopedGoTo,
    follow: scopedFollow,
    resumePlay: scopedResume,
    tryMeleeClick: scopedClick,
    startSampling,
    stopSampling,
    markInput(action) {
      lastInput.current = { action, t: Date.now() };
    },
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
