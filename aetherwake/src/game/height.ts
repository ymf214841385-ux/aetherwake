/** Analytic heightfield for Valemoor — island, plateau, lake, mountain, river. */

export const WORLD_SIZE = 384;
export const WATER_LEVEL = 3.35;
export const HALF = WORLD_SIZE * 0.5;

function fract(n: number) {
  return n - Math.floor(n);
}

function hash2(ix: number, iz: number) {
  return fract(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453);
}

function fade(t: number) {
  return t * t * (3 - 2 * t);
}

function noise2(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const ux = fade(fx);
  const uz = fade(fz);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x: number, z: number, oct = 5) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < oct; i++) {
    v += noise2(x * f, z * f) * a;
    s += a;
    a *= 0.5;
    f *= 2.03;
  }
  return v / s;
}

export function hash01(x: number, z: number) {
  return fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function distSeg(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((x - ax) * dx + (z - az) * dz) / l2;
  t = Math.min(1, Math.max(0, t));
  const px = ax + dx * t - x;
  const pz = az + dz * t - z;
  return Math.hypot(px, pz);
}

const RIVER: [number, number][] = [
  [32, -108],
  [18, -62],
  [2, -22],
  [-28, 2],
  [-62, 14],
  [-90, 20],
];

function riverDist(x: number, z: number) {
  let m = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i]!;
    const b = RIVER[i + 1]!;
    m = Math.min(m, distSeg(x, z, a[0], a[1], b[0], b[1]));
  }
  return m;
}

/** Plateau center (south), mountain (north), lake (west). +Z is south. */
export const PLATEAU = { x: 16, z: 96 };
export const MOUNTAIN = { x: 30, z: -118 };
export const LAKE = { x: -88, z: 20 };
export const CITADEL = { x: 6, z: -12 };
export const FOREST = { x: 102, z: 18 };

export function computeHeight(x: number, z: number): number {
  const nx = x / HALF;
  const nz = z / HALF;
  const r = Math.hypot(nx, nz);
  const island = Math.pow(Math.max(0, 1 - r * 1.04), 1.28);
  if (island <= 0.002) return -12;

  const hills = (fbm(x * 0.0068, z * 0.0068, 5) - 0.48) * 14;
  const detail = (fbm(x * 0.028 + 9, z * 0.028, 3) - 0.5) * 2.4;

  const pd = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  const plateau = smoothstep(64, 36, pd) * 22;
  const plateauTop = pd < 40 ? 26.4 + (fbm(x * 0.04, z * 0.04, 2) - 0.5) * 1.1 : -1e9;

  const md = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
  const peak = Math.pow(Math.max(0, 1 - md / 98), 1.72) * 64;
  const ridge = (fbm(x * 0.018 + 3, z * 0.018, 3) - 0.5) * peak * 0.12;

  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  const lake = -smoothstep(54, 16, ld) * 17;

  const fd = Math.hypot(x - FOREST.x, z - FOREST.z);
  const forest = smoothstep(78, 28, fd) * (fbm(x * 0.02, z * 0.02, 3) - 0.35) * 10;

  const cd = Math.hypot(x - CITADEL.x, z - CITADEL.z);
  const keep = smoothstep(36, 12, cd) * 9;

  const rd = riverDist(x, z);
  const river = -smoothstep(11, 2.2, rd) * 7.5;

  let h =
    5.5 +
    hills +
    detail +
    plateau +
    peak +
    ridge +
    lake +
    forest +
    keep +
    river;

  if (plateauTop > -1e8) h = Math.max(h, plateauTop);
  h *= island;

  // Soft beach shelf just above / below water near the rim
  if (h > -1 && h < 5 && r > 0.72) {
    h = h * 0.7 + 1.6;
  }
  return h;
}

export function heightAt(x: number, z: number): number {
  return computeHeight(x, z);
}

export function normalAt(x: number, z: number, e = 0.65) {
  const hL = heightAt(x - e, z);
  const hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e);
  const hU = heightAt(x, z + e);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * e;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / l, y: ny / l, z: nz / l };
}

export type Biome = "ocean" | "sand" | "grass" | "plateau" | "forest" | "rock" | "snow";

export function biomeAt(x: number, z: number, h: number): Biome {
  if (h < WATER_LEVEL + 0.15) return "ocean";
  const n = normalAt(x, z);
  if (n.y < 0.58) return "rock";
  if (h > 46) return "snow";
  if (h < WATER_LEVEL + 2.4) return "sand";
  const pd = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  if (pd < 48 && h > 22) return "plateau";
  const fd = Math.hypot(x - FOREST.x, z - FOREST.z);
  if (fd < 70 && h > 6 && h < 34) return "forest";
  return "grass";
}

export function colorAt(x: number, z: number, h: number) {
  const n = normalAt(x, z);
  const slope = 1 - n.y;
  const b = biomeAt(x, z, h);
  let r = 0.32;
  let g = 0.42;
  let bch = 0.22;
  switch (b) {
    case "ocean":
      r = 0.14;
      g = 0.28;
      bch = 0.26;
      break;
    case "sand":
      r = 0.76;
      g = 0.68;
      bch = 0.48;
      break;
    case "plateau":
      r = 0.45;
      g = 0.56;
      bch = 0.28;
      break;
    case "forest":
      r = 0.18;
      g = 0.34;
      bch = 0.18;
      break;
    case "rock":
      r = 0.42;
      g = 0.38;
      bch = 0.34;
      break;
    case "snow":
      r = 0.9;
      g = 0.93;
      bch = 0.95;
      break;
    default: {
      const t = fbm(x * 0.04, z * 0.04, 2);
      r = 0.28 + t * 0.12;
      g = 0.46 + t * 0.14;
      bch = 0.2;
    }
  }
  if (slope > 0.28 && b !== "snow") {
    const k = Math.min(1, (slope - 0.28) * 2.2);
    r = r * (1 - k) + 0.48 * k;
    g = g * (1 - k) + 0.36 * k;
    bch = bch * (1 - k) + 0.26 * k;
  }
  const mott = (hash01(Math.floor(x * 0.4), Math.floor(z * 0.4)) - 0.5) * 0.06;
  r = Math.min(1, Math.max(0, r + mott));
  g = Math.min(1, Math.max(0, g + mott));
  bch = Math.min(1, Math.max(0, bch + mott * 0.5));
  return { r, g, b: bch };
}

export function inBounds(x: number, z: number) {
  return Math.abs(x) < HALF - 4 && Math.abs(z) < HALF - 4;
}
