// Fixed order breaks exact ties: W, WD, D, SD, S, SA, A, WA.
/** @type {[number, number, string[]][]} */
const DIRECTIONS = [
  [0, 1, ["KeyW"]], [1, 1, ["KeyW", "KeyD"]],
  [1, 0, ["KeyD"]], [1, -1, ["KeyS", "KeyD"]],
  [0, -1, ["KeyS"]], [-1, -1, ["KeyS", "KeyA"]],
  [-1, 0, ["KeyA"]], [-1, 1, ["KeyW", "KeyA"]],
];
/**
 * @param {{x?: number, z?: number, camYaw?: number, stamina?: number, state?: string} | null | undefined} s
 * @param {number} tx
 * @param {number} tz
 * @param {boolean} sprint
 */
export function keysToward(s, tx, tz, sprint) {
  if (!s || typeof s.x !== "number" || typeof s.z !== "number" || typeof s.camYaw !== "number") return [];
  if (![s?.x, s?.z, s?.camYaw, tx, tz].every(Number.isFinite)) return [];
  const dx = tx - s.x, dz = tz - s.z;
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length <= 1e-8) return [];
  const fx = -Math.sin(s.camYaw), fz = -Math.cos(s.camYaw);
  const rx = Math.cos(s.camYaw), rz = -Math.sin(s.camYaw);
  let best = -Infinity;
  /** @type {string[]} */
  let chosen = [];
  for (const [r, f, keys] of DIRECTIONS) {
    const norm = Math.hypot(r, f);
    const wx = (rx * r + fx * f) / norm;
    const wz = (rz * r + fz * f) / norm;
    const dot = wx * (dx / length) + wz * (dz / length);
    if (dot > best) { best = dot; chosen = keys; }
  }
  const keys = [...chosen];
  if (keys.length && sprint && (s.stamina ?? 0) > 8 && s.state !== "climbing") keys.push("ShiftLeft");
  return keys;
}
