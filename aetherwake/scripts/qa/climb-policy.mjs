/**
 * Local climb + rest-ledge policy.
 *
 * The harness only emits real keys (WASD, E, Space, …). It does not write
 * player coordinates, does not call grabRest, and does not depend on a 12 m
 * teleport snap. If the game still teleports internally, that is gameplay —
 * this policy still only asks for ordinary input.
 *
 * Authored rest ledges are 4 columns × 3 rows (not 12 even spacings).
 * Rest: release W on a local ledge, wait for stamina. Re-grab: hold W+E
 * (wantClimb includes resting && moveY>0.12). Never walk into the shaft
 * center (tower.x, tower.z).
 */

export const TOWER_RADIUS = 4.2;
export const TOWER_HEIGHT = 38;
export const APPROACH_OFFSET_Z = 5.6;
export const TOWER_DOCK_RADIUS = 5.7;
/** Copied from height.ts / world.ts — do not import the game graph. */
export const WATER_LEVEL = 3.35;
export const TOWER_LEDGE_COLUMNS = 4;
export const TOWER_LEDGE_ROWS = 3;
export const TOWER_LEDGE_Y_TOP = TOWER_HEIGHT - 1.55;
export const TOWER_LEDGE_NEAR = 1.15;

/**
 * Authored pad heights from heightAt(POI). Never use the player's swim/ledge
 * y as tower base — that shifts the 3 rest rows and makes S-drop miss.
 */
export const TOWER_BASE_Y = Object.freeze({
  dawn: 11.1,
  mere: 7.8,
  crown: 16.8,
});

export function authoredBaseY(id, fallback) {
  const y = TOWER_BASE_Y[id];
  return Number.isFinite(y) ? y : fallback;
}

/** Keyboard codes the harness is allowed to send. No cheat / teleport codes. */
export const REAL_INPUT_CODES = Object.freeze([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ShiftLeft",
  "Space",
  "KeyE",
  "KeyF",
  "KeyC",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Tab",
  "Escape",
  "KeyM",
  "ControlLeft",
]);

export const REAL_INPUT_SET = new Set(REAL_INPUT_CODES);

export function isRealInputCode(code) {
  return REAL_INPUT_SET.has(code);
}

export function towerApproachPoint(tw, id) {
  const zOff = id === "mere" ? TOWER_DOCK_RADIUS : APPROACH_OFFSET_Z;
  return { x: tw.x, z: tw.z + zOff };
}

export function xzDist(s, tw) {
  return Math.hypot((s?.x ?? 0) - tw.x, (s?.z ?? 0) - tw.z);
}

export function isInShaft(s, tw) {
  if (!s) return false;
  if (s.state === "climbing") return false;
  // Wall-hug is ~radius+capsule (4.52). Only the hollow interior is a detour.
  return xzDist(s, tw) < TOWER_RADIUS - 0.15;
}

/** Same local-Y0 as world.ts towerLedgeLocalY0. */
export function towerLedgeLocalY0(baseY) {
  return Math.max(2.1, WATER_LEVEL + 0.55 - baseY);
}

/**
 * 3 authored rest-row local Y values.
 * y0 = max(2.1, WATER_LEVEL+0.55-baseY), yTop = 38-1.55,
 * y = y0 + (row/2)*ySpan for row 0..2.
 */
export function towerLedgeLocalYs(baseY) {
  const y0 = towerLedgeLocalY0(baseY);
  const ySpan = Math.max(6, TOWER_LEDGE_Y_TOP - y0);
  const ys = [];
  for (let row = 0; row < TOWER_LEDGE_ROWS; row++) {
    ys.push(y0 + (row / (TOWER_LEDGE_ROWS - 1)) * ySpan);
  }
  return ys;
}

export function towerLedgeWorldYs(baseY) {
  return towerLedgeLocalYs(baseY).map((ly) => baseY + ly);
}

/** True only at the 3 authored rest rows. Not 12 even spacings up the shaft. */
export function nearLedge(y, baseY) {
  for (const wy of towerLedgeWorldYs(baseY)) {
    if (Math.abs(y - wy) < TOWER_LEDGE_NEAR) return true;
  }
  return false;
}

/**
 * Detour east/west of the cylinder so reapproach never walks through the shaft.
 */
export function reapproachWaypoints(s, tw, id) {
  const approach = towerApproachPoint(tw, id);
  if (!s) return [approach];
  const xz = xzDist(s, tw);
  if (xz < 8.5) {
    const side = s.x >= tw.x ? 1 : -1;
    const sx = tw.x + side * 8.5;
    return [
      { x: sx, z: s.z },
      { x: sx, z: approach.z },
      approach,
    ];
  }
  return [approach];
}

/**
 * Keys the harness should send for one policy action. Empty = wait / release.
 * Never includes a teleport instruction.
 */
export function keysForAction(action) {
  if (!action || !action.type) return [];
  switch (action.type) {
    case "climb-up":
      return ["KeyW"];
    case "regrab":
      return ["KeyW", "KeyE"];
    case "ledge-drop":
      return ["KeyS"];
    case "activate":
      return ["KeyE"];
    case "surface-jump":
      return ["Space", "KeyE"];
    case "approach-grab":
      return ["KeyW", "KeyE"];
    case "rest":
    case "wait-air":
    case "done":
    case "abort":
    case "reapproach":
      return [];
    default:
      return [];
  }
}

export function assertRealKeys(action) {
  const keys = keysForAction(action);
  return keys.every(isRealInputCode) && !/teleport|snap|grabRest/i.test(action?.type || "");
}

/**
 * One tick of climb intent. `climb-up` is the only action that holds W alone.
 * Grounded-on-ledge after rest is `regrab` (hold W+E, never tap-E-then-W).
 *
 * @param {object | null} s
 * @param {{ id: string, tw: { x: number, z: number }, baseY: number, burstUntil: number, now: number }} ctx
 */
export function climbTickPolicy(s, ctx) {
  const { id, tw, baseY } = ctx;
  if (!s) return { type: "abort" };
  if (s.towers?.includes(id)) return { type: "done" };
  if (s.prompt?.includes("启动")) return { type: "activate" };

  const xz = xzDist(s, tw);
  // Must match sim interact plus the outer cap pad. 85510 stood at xz=5.23
  // y=54.8 with 启动 雪冠塔 and the 5.2 cutoff regrabbed until the window ended.
  if (xz < 6.5 && s.y > baseY + TOWER_HEIGHT - 2.2) return { type: "activate" };

  if (isInShaft(s, tw) && s.y < baseY + 6) return { type: "reapproach" };
  if (xz > 14) return { type: "reapproach" };
  // Dock / waterline at mere is y≈3.5, which is < pad-3.5. That is the grab
  // ring, not a fall. Only detour when far from the shaft.
  if (s.state !== "swimming" && s.y < baseY - 3.5 && xz > 8) return { type: "reapproach" };

  // Player-correct lake grab is W+E into the wall. Space-jump walks/swims into
  // the hollow under a pad that sits above WATER_LEVEL (headed route mere fail).
  if (s.state === "swimming") return { type: "approach-grab" };

  if (s.state === "grounded" && s.y > baseY + 1.8) {
    // Rest only on an authored ledge with a near-full bar. Grounded on the
    // hillside / between rows is not a rest — regrab instead of idling.
    const onLedge = nearLedge(s.y, baseY);
    const stamMax = Number.isFinite(s.staminaMax) && s.staminaMax > 0 ? s.staminaMax : 100;
    if (onLedge && s.stamina < stamMax * 0.88) return { type: "rest" };
    return { type: "regrab", tapS: false, holdW: true, holdE: true };
  }

  if (s.state === "climbing") {
    // burstUntil covers the first ~4 m after a regrab so we do not S-drop while
    // still inside the 1.15 m nearLedge window of the ledge we just left.
    const bursting = (ctx.now ?? 0) < (ctx.burstUntil ?? 0);
    if (!bursting && nearLedge(s.y, baseY) && s.stamina < 48) return { type: "ledge-drop" };
    return { type: "climb-up" };
  }

  if (s.state === "airborne" || s.state === "gliding") return { type: "wait-air" };
  return { type: "approach-grab" };
}
