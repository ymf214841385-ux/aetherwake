/** Route success is objective evidence, not "the browser did not throw". */

import { unexpectedCloseFailure } from "./lifecycle.mjs";

export const REQUIRED_TOWERS = ["dawn", "mere", "crown"];
export const REQUIRED_SHRINES = ["pull", "rime", "burst", "still"];
export const PLAYING_OR_ENDING = new Set(["playing", "ending", "credits"]);

function asSet(v) {
  return new Set(Array.isArray(v) ? v : []);
}

function missing(got, need) {
  const have = asSet(got);
  return need.filter((id) => !have.has(id));
}

export function progressSnapshot(s) {
  if (!s) return null;
  return {
    mode: s.mode ?? null,
    towers: [...asSet(s.towers)],
    shrines: [...asSet(s.shrines)],
    orbs: Number(s.orbs ?? 0),
    ruinSolved: s.ruinSolved === true,
    bossDead: s.bossDead === true,
  };
}

function sameIds(a, b) {
  const aa = [...asSet(a)].sort();
  const bb = [...asSet(b)].sort();
  return aa.length === bb.length && aa.every((id, i) => id === bb[i]);
}

/**
 * Persistable progress that a real save+reload must restore via window.__sim.
 * ruinSolved is part of the save schema (wind-bridge solved). A designed
 * reset would be documented; dropping true→false after 继续旅途 is a miss.
 */
export function saveReloadRestored(before, after) {
  if (!before || !after) return { ok: false, detail: "missing before/after snapshot" };
  const missT = missing(after.towers, REQUIRED_TOWERS);
  const missS = missing(after.shrines, REQUIRED_SHRINES);
  const reasons = [];
  if (missT.length) reasons.push(`towers after reload missing ${missT.join(",")}`);
  if (missS.length) reasons.push(`shrines after reload missing ${missS.join(",")}`);
  if (!(Number(after.orbs) >= 4)) reasons.push(`orbs after reload=${after.orbs}`);
  if (before.bossDead && !after.bossDead) reasons.push("bossDead dropped after reload");
  if (before.ruinSolved && !after.ruinSolved) reasons.push("ruinSolved dropped after reload");
  if (!sameIds(before.towers, after.towers)) {
    reasons.push(`towers ${[...asSet(before.towers)].join(",") || "(none)"} → ${[...asSet(after.towers)].join(",") || "(none)"}`);
  }
  if (!sameIds(before.shrines, after.shrines)) {
    reasons.push(`shrines ${[...asSet(before.shrines)].join(",") || "(none)"} → ${[...asSet(after.shrines)].join(",") || "(none)"}`);
  }
  return { ok: reasons.length === 0, detail: reasons.join("; ") || "restored" };
}

/**
 * Strict success requires ALL of:
 *   3 towers on, 4 shrines, orbs>=4, wind/ruin solved,
 *   citadel/boss ending path, save+reload restores observed via window.__sim.
 *
 * Never returns ok=true when any of those are missing. Incomplete towers or
 * shrines is a failure even if the browser did not throw.
 *
 * @param {{
 *   final?: object | null,
 *   observed?: object | null,
 *   titleMidRun?: boolean,
 *   attemptedCitadel?: boolean,
 *   sealClosedAttempt?: boolean,
 *   citadelPrompt?: string | null,
 *   closeReason?: object | null,
 *   saveReload?: {
 *     attempted?: boolean,
 *     savePresent?: boolean,
 *     continued?: boolean,
 *     before?: object | null,
 *     after?: object | null,
 *     restored?: boolean,
 *     detail?: string | null,
 *   } | null,
 * }} report
 */
export function evaluateRoute(report = {}) {
  const failures = [];
  const final = report.final ?? null;
  const observed = report.observed ?? null;
  const mode = final?.mode ?? null;
  const towers = final?.towers ?? [];
  const shrines = final?.shrines ?? [];
  const orbs = Number(final?.orbs ?? 0);
  const ruinSolved = final?.ruinSolved === true || observed?.ruinSolved === true;
  const bossDead = final?.bossDead === true || observed?.bossDead === true;

  if (!final) {
    failures.push({
      id: "sim",
      expected: "window.__sim snapshot",
      actual: null,
      detail: "sim never became readable",
    });
  }

  if (report.titleMidRun || mode === "title") {
    failures.push({
      id: "mode",
      expected: "playing or ending/credits",
      actual: mode,
      detail: "run returned to title; silent title is not a pass",
    });
  } else if (mode && !PLAYING_OR_ENDING.has(mode)) {
    failures.push({
      id: "mode",
      expected: "playing or ending/credits",
      actual: mode,
      detail: "finished in a non-play overlay/dead state",
    });
  }

  const missTowers = missing(towers, REQUIRED_TOWERS);
  if (missTowers.length) {
    failures.push({
      id: "towers",
      expected: REQUIRED_TOWERS.join(","),
      actual: [...asSet(towers)].join(",") || "(none)",
      detail: `missing ${missTowers.join(",")}`,
    });
  }

  const missShrines = missing(shrines, REQUIRED_SHRINES);
  if (missShrines.length) {
    failures.push({
      id: "shrines",
      expected: REQUIRED_SHRINES.join(","),
      actual: [...asSet(shrines)].join(",") || "(none)",
      detail: `missing ${missShrines.join(",")}`,
    });
  }

  if (!(orbs >= 4)) {
    failures.push({
      id: "orbs",
      expected: ">= 4",
      actual: orbs,
      detail: "need one orb per shrine",
    });
  }

  if (!ruinSolved) {
    failures.push({
      id: "ruinSolved",
      expected: true,
      actual: false,
      detail: "wind ruin not solved (gust planks or side-updraft)",
    });
  }

  if (report.sealClosedAttempt) {
    failures.push({
      id: "citadel-seal",
      expected: "seal open before citadel/boss",
      actual: report.citadelPrompt || "seal closed",
      detail: "attempted citadel while seal closed; that is a failure, not success",
    });
  }

  if (!report.attemptedCitadel) {
    failures.push({
      id: "citadel",
      expected: "citadel/boss ending path attempted",
      actual: false,
      detail: "citadel was not attempted; skipping the boss is not success",
    });
  } else if (!bossDead) {
    failures.push({
      id: "bossDead",
      expected: true,
      actual: false,
      detail: "citadel/boss path ran but boss is not dead / ending not reached",
    });
  }

  const sr = report.saveReload ?? null;
  if (!sr || sr.attempted !== true) {
    failures.push({
      id: "save-reload",
      expected: "reload page and continue from save; observe restored progress on window.__sim",
      actual: sr ? "not attempted" : null,
      detail: "save+reload was not actually observed",
    });
  } else {
    const before = sr.before ?? null;
    const after = sr.after ?? null;
    const check = saveReloadRestored(before, after);
    const restored = sr.restored === true && check.ok && sr.savePresent === true && sr.continued === true;
    if (!restored) {
      failures.push({
        id: "save-reload",
        expected: "towers, shrines, orbs, ruinSolved, bossDead restored after 继续旅途",
        actual: {
          savePresent: sr.savePresent ?? false,
          continued: sr.continued ?? false,
          before: progressSnapshot(before),
          after: progressSnapshot(after),
        },
        detail: sr.detail || check.detail || "save+reload did not restore progress",
      });
    }
  }

  const closeFail = unexpectedCloseFailure(report.closeReason);
  if (closeFail) failures.push(closeFail);

  return { ok: failures.length === 0, failures };
}
