/**
 * Success predicate for lifecycle-control (Review07).
 * True only when: arrived AND full budget held AND no unintentional close/crash/disconnect.
 */

/**
 * @param {object} p
 * @param {boolean} p.arrived
 * @param {boolean} p.completedBudget  // held until endAt without early abort
 * @param {boolean} p.survivedBudget   // wall elapsed >= budgetMs
 * @param {{events?: {intentional?: boolean}[]}} p.lifecycle
 * @param {string|null} [p.errorMessage]
 */
export function isControlSuccess(p) {
  const life = p.lifecycle || {};
  const events = life.events || [];
  const unintentional = events.some((e) => e.intentional === false);
  const badClose =
    Boolean(life.crashed) ||
    Boolean(life.browserDisconnected) ||
    Boolean(life.pageClosed) ||
    unintentional;
  if (p.errorMessage) return false;
  if (!p.arrived) return false;
  if (!p.completedBudget) return false;
  if (!p.survivedBudget) return false;
  if (badClose) return false;
  return true;
}

export function controlFailureReason(p) {
  const life = p.lifecycle || {};
  const events = life.events || [];
  const unintentional = events.some((e) => e.intentional === false);
  if (p.errorMessage) return `error:${p.errorMessage}`;
  if (!p.arrived) return "not-arrived";
  if (unintentional || life.crashed || life.pageClosed || life.browserDisconnected) {
    return `unintentional-close:${life.order || "flags"}`;
  }
  if (!p.completedBudget || !p.survivedBudget) return "incomplete-budget";
  return "ok";
}
