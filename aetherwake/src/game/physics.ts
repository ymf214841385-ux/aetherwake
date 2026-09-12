import { FOOT_SNAP, PLAYER_HEIGHT, PLAYER_RADIUS, STEP_UP } from "./params.ts";

export type Solid = {
  id: string;
  kind: "cyl" | "box";
  x: number;
  y: number;
  z: number;
  r?: number;
  h: number;
  w?: number;
  d?: number;
  yaw?: number;
  climbable?: boolean;
  standable?: boolean;
};

export type SupportHit = {
  y: number;
  id: string;
  climbable: boolean;
  normalY: number;
};

export type WallHit = {
  id: string;
  nx: number;
  nz: number;
  climbable: boolean;
  top: number;
  base: number;
  pen: number;
};

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpAng(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function inBoxFootprint(s: Solid, x: number, z: number) {
  const yaw = s.yaw ?? 0;
  const dx = x - s.x;
  const dz = z - s.z;
  const c = Math.cos(-yaw);
  const sn = Math.sin(-yaw);
  const lx = dx * c - dz * sn;
  const lz = dx * sn + dz * c;
  const hw = (s.w ?? 1) * 0.5;
  const hd = (s.d ?? 1) * 0.5;
  return Math.abs(lx) <= hw && Math.abs(lz) <= hd;
}

function cylOverlap(s: Solid, x: number, z: number, extra = 0) {
  const r = (s.r ?? 1) + extra;
  return Math.hypot(x - s.x, z - s.z) < r;
}

/** Non-zero axis-aligned escape in local box space. Center and axes pick +X then +Z. */
export function boxEscapeNormal(lx: number, lz: number, penX: number, penZ: number) {
  const sx = lx < 0 ? -1 : 1;
  const sz = lz < 0 ? -1 : 1;
  if (penX < penZ - 1e-9) return { nx: sx, nz: 0, pen: penX };
  if (penZ < penX - 1e-9) return { nx: 0, nz: sz, pen: penZ };
  return { nx: sx, nz: 0, pen: penX };
}

export function solidTop(s: Solid) {
  return s.y + s.h;
}

/** Closest point on a solid's XZ footprint to (x,z). Used for local mantle reach, not teleport. */
export function closestPointOnSolidXZ(s: Solid, x: number, z: number): { x: number; z: number; dist: number } {
  if (s.kind === "cyl") {
    const dx = x - s.x;
    const dz = z - s.z;
    const dist = Math.hypot(dx, dz);
    const r = s.r ?? 1;
    if (dist <= r) return { x, z, dist: 0 };
    const inv = 1 / Math.max(dist, 1e-8);
    return { x: s.x + dx * inv * r, z: s.z + dz * inv * r, dist: dist - r };
  }
  const yaw = s.yaw ?? 0;
  const dx = x - s.x;
  const dz = z - s.z;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const lx = dx * c + dz * sn;
  const lz = -dx * sn + dz * c;
  const hw = (s.w ?? 1) * 0.5;
  const hd = (s.d ?? 1) * 0.5;
  const cx = clamp(lx, -hw, hw);
  const cz = clamp(lz, -hd, hd);
  const wx = s.x + cx * c - cz * sn;
  const wz = s.z + cx * sn + cz * c;
  return { x: wx, z: wz, dist: Math.hypot(x - wx, z - wz) };
}

export function solidBase(s: Solid) {
  return s.y;
}

export function supportY(
  x: number,
  z: number,
  feetY: number,
  solids: Solid[],
  heightFn: (x: number, z: number) => number,
  extra: { y: number; id: string; x: number; z: number; r: number }[],
  excludeId?: string | null,
): SupportHit {
  const ground = heightFn(x, z);
  let best: SupportHit = { y: ground, id: "terrain", climbable: false, normalY: 1 };
  const maxLift = feetY + FOOT_SNAP;

  const consider = (y: number, id: string, climbable: boolean) => {
    if (y > maxLift) return;
    if (y + 8 < feetY) return;
    if (y >= best.y - 1e-6 && y <= maxLift) {
      best = { y, id, climbable, normalY: 1 };
    }
  };

  consider(ground, "terrain", false);

  for (const s of solids) {
    if (!s.standable) continue;
    if (excludeId && s.id === excludeId) continue;
    const top = solidTop(s);
    if (s.kind === "cyl") {
      if (cylOverlap(s, x, z, 0.05)) consider(top, s.id, Boolean(s.climbable));
    } else if (inBoxFootprint(s, x, z)) {
      consider(top, s.id, Boolean(s.climbable));
    }
  }

  for (const e of extra) {
    if (excludeId && e.id === excludeId) continue;
    if (Math.hypot(x - e.x, z - e.z) < e.r) consider(e.y, e.id, false);
  }

  return best;
}

export function queryWall(
  x: number,
  z: number,
  y: number,
  solids: Solid[],
  radius = PLAYER_RADIUS,
): WallHit | null {
  let hit: WallHit | null = null;
  let bestPen = 0;
  const mid = y + PLAYER_HEIGHT * 0.45;
  for (const s of solids) {
    const base = solidBase(s);
    const top = solidTop(s);
    if (mid < base - 0.05 || y + 0.2 > top + 0.35) continue;
    if (s.standable && y >= top - 0.22) continue;
    if (s.standable && s.h < 1) continue;
    if (s.kind === "cyl") {
      const dx = x - s.x;
      const dz = z - s.z;
      const dist = Math.hypot(dx, dz);
      const need = (s.r ?? 1) + radius;
      const pen = need - dist;
      if (pen > bestPen) {
        bestPen = pen;
        const nx = dist < 1e-5 ? 1 : dx / dist;
        const nz = dist < 1e-5 ? 0 : dz / dist;
        hit = { id: s.id, nx, nz, climbable: Boolean(s.climbable), top, base, pen };
      }
    } else {
      const yaw = s.yaw ?? 0;
      const dx = x - s.x;
      const dz = z - s.z;
      const c = Math.cos(-yaw);
      const sn = Math.sin(-yaw);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      const hw = (s.w ?? 1) * 0.5 + radius;
      const hd = (s.d ?? 1) * 0.5 + radius;
      const ox = Math.abs(lx) - hw;
      const oz = Math.abs(lz) - hd;
      if (ox < 0 && oz < 0) {
        const local = boxEscapeNormal(lx, lz, -ox, -oz);
        if (local.pen > bestPen) {
          bestPen = local.pen;
          const nx = local.nx * c + local.nz * sn;
          const nz = -local.nx * sn + local.nz * c;
          const len = Math.hypot(nx, nz) || 1;
          hit = { id: s.id, nx: nx / len, nz: nz / len, climbable: Boolean(s.climbable), top, base, pen: local.pen };
        }
      }
    }
  }
  return hit;
}

export function resolveHorizontal(
  x: number,
  z: number,
  y: number,
  solids: Solid[],
  radius = PLAYER_RADIUS,
): { x: number; z: number; wall: WallHit | null } {
  let px = x;
  let pz = z;
  let wall: WallHit | null = null;
  for (let i = 0; i < 3; i++) {
    const hit = queryWall(px, pz, y, solids, radius);
    if (!hit) break;
    wall = hit;
    px += hit.nx * Math.max(0.08, hit.pen);
    pz += hit.nz * Math.max(0.08, hit.pen);
  }
  return { x: px, z: pz, wall };
}

export function sphereCast(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  heightFn: (x: number, z: number) => number,
  solids: Solid[],
  radius = 0.28,
  steps = 10,
): { x: number; y: number; z: number; hit: boolean; t: number } {
  let x = ox;
  let y = oy;
  let z = oz;
  const len = Math.hypot(dx, dy, dz) || 1;
  const sx = dx / steps;
  const sy = dy / steps;
  const sz = dz / steps;
  for (let i = 1; i <= steps; i++) {
    x = ox + sx * i;
    y = oy + sy * i;
    z = oz + sz * i;
    const g = heightFn(x, z) + radius + 0.15;
    if (y < g) {
      return { x, y: g, z, hit: true, t: i / steps };
    }
    const wall = queryWall(x, z, y - PLAYER_HEIGHT * 0.3, solids, radius);
    if (wall) {
      return { x: x + wall.nx * radius, y, z: z + wall.nz * radius, hit: true, t: i / steps };
    }
  }
  return { x: ox + dx, y: oy + dy, z: oz + dz, hit: false, t: 1 };
}

export function canStandAt(x: number, z: number, y: number, solids: Solid[], heightFn: (x: number, z: number) => number) {
  const s = supportY(x, z, y + 0.4, solids, heightFn, []);
  return Math.abs(s.y - y) < STEP_UP + 0.15;
}

export type BodyPosition = { x: number; y: number; z: number };
export const BODY_SKIN = 0.002;

// Full upright player volume for mantle validation. Unlike queryWall this must
// include thin platforms and the head, and must not resolve by pushing a pose.
export function playerBodyClear(p: BodyPosition, solids: Solid[], heightFn: (x: number, z: number) => number) {
  return sweepPlayerBody(p, p, solids, heightFn);
}

/** Conservative swept player cylinder; false means no movement may be committed. */
export function sweepPlayerBody(from: BodyPosition, to: BodyPosition, solids: Solid[], heightFn?: (x: number, z: number) => number) {
  if (![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)) return false;
  const vx = to.x - from.x, vy = to.y - from.y, vz = to.z - from.z;
  const slab = (start: number, delta: number, lo: number, hi: number): [number, number] | null => {
    if (Math.abs(delta) < 1e-12) return start > lo && start < hi ? [0, 1] : null;
    const a = (lo - start) / delta, b = (hi - start) / delta;
    const enter = Math.max(0, Math.min(a, b)), leave = Math.min(1, Math.max(a, b));
    return leave > enter + 1e-12 ? [enter, leave] : null;
  };
  for (const s of solids) {
    const vertical = slab(from.y, vy, s.y - PLAYER_HEIGHT + BODY_SKIN, solidTop(s) - BODY_SKIN);
    if (!vertical) continue;
    let horizontal: [number, number] | null = null;
    if (s.kind === "box") {
      const c = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0);
      const ox = from.x - s.x, oz = from.z - s.z;
      const hx = (s.w ?? 1) / 2 + PLAYER_RADIUS - BODY_SKIN;
      const hz = (s.d ?? 1) / 2 + PLAYER_RADIUS - BODY_SKIN;
      const x = slab(ox * c + oz * sn, vx * c + vz * sn, -hx, hx);
      const z = slab(-ox * sn + oz * c, -vx * sn + vz * c, -hz, hz);
      if (x && z) horizontal = [Math.max(x[0], z[0]), Math.min(x[1], z[1])];
    } else {
      const ox = from.x - s.x, oz = from.z - s.z;
      const r = (s.r ?? 1) + PLAYER_RADIUS - BODY_SKIN;
      const a = vx * vx + vz * vz, b = 2 * (ox * vx + oz * vz), c = ox * ox + oz * oz - r * r;
      if (a < 1e-12) { if (c < 0) horizontal = [0, 1]; }
      else {
        const disc = b * b - 4 * a * c;
        if (disc > 0) horizontal = [Math.max(0, (-b - Math.sqrt(disc)) / (2 * a)), Math.min(1, (-b + Math.sqrt(disc)) / (2 * a))];
      }
    }
    if (horizontal && Math.min(vertical[1], horizontal[1]) > Math.max(vertical[0], horizontal[0]) + 1e-12) return false;
  }
  // Terrain is a height field, not an authored thin obstacle. Sample the path
  // at sub-radius spacing; do not treat high terrain as a
  // legal support just because supportY's geometric fallback returns its Y.
  const steps = Math.max(1, Math.ceil(Math.hypot(vx, vy, vz) / (PLAYER_RADIUS / 4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = from.x + vx * t, y = from.y + vy * t, z = from.z + vz * t;
    if (heightFn && heightFn(x, z) > y + BODY_SKIN) return false;
  }
  return true;
}

/** Exit the expanded authored footprint along an actual wall's outward normal. */
export function outsideTopPoint(s: Solid, p: BodyPosition, normal: { x: number; z: number }): BodyPosition | null {
  const length = Math.hypot(normal.x, normal.z);
  if (!Number.isFinite(length) || length < 1e-8) return null;
  const dx = normal.x / length, dz = normal.z / length;
  let exit: number;
  if (s.kind === "cyl") {
    const ox = p.x - s.x, oz = p.z - s.z, r = (s.r ?? 1) + PLAYER_RADIUS + BODY_SKIN * 2;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    exit = -b + Math.sqrt(disc);
  } else {
    const c = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0);
    const ox = p.x - s.x, oz = p.z - s.z;
    const axes = [
      { p: ox * c + oz * sn, d: dx * c + dz * sn, h: (s.w ?? 1) / 2 + PLAYER_RADIUS + BODY_SKIN * 2 },
      { p: -ox * sn + oz * c, d: -dx * sn + dz * c, h: (s.d ?? 1) / 2 + PLAYER_RADIUS + BODY_SKIN * 2 },
    ];
    let enter = -Infinity;
    exit = Infinity;
    for (const a of axes) {
      if (Math.abs(a.d) < 1e-10) { if (Math.abs(a.p) >= a.h) return null; continue; }
      const t1 = (-a.h - a.p) / a.d, t2 = (a.h - a.p) / a.d;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
    }
    if (exit < Math.max(0, enter)) return null;
  }
  if (!Number.isFinite(exit) || exit < 0) return null;
  return { x: p.x + dx * (exit + BODY_SKIN), y: p.y, z: p.z + dz * (exit + BODY_SKIN) };
}

/** Fit the entire foot radius onto an authored top, preserving rotated boxes. */
export function fittedTopPoint(s: Solid, p: BodyPosition): BodyPosition | null {
  const inset = PLAYER_RADIUS + BODY_SKIN * 2;
  if (!s.standable) return null;
  if (s.kind === "cyl") {
    const r = (s.r ?? 1) - inset;
    if (r <= 0) return null;
    const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz);
    const scale = d > r ? r / d : 1;
    return { x: s.x + dx * scale, y: solidTop(s), z: s.z + dz * scale };
  }
  const hx = (s.w ?? 1) / 2 - inset, hz = (s.d ?? 1) / 2 - inset;
  if (hx <= 0 || hz <= 0) return null;
  const c = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0);
  const dx = p.x - s.x, dz = p.z - s.z;
  const x = clamp(dx * c + dz * sn, -hx, hx), z = clamp(-dx * sn + dz * c, -hz, hz);
  return { x: s.x + x * c - z * sn, y: solidTop(s), z: s.z + x * sn + z * c };
}

export { PLAYER_HEIGHT, PLAYER_RADIUS };
