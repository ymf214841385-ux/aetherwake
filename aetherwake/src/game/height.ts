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
export const WIND_VALLEY = { x: 14, z: 88 };
export const WIND_RUIN = { x: 28, z: 74 };
export const SPAWN = { x: 16, z: 102 };

const PATH: [number, number][] = [
  [16, 104],
  [18, 96],
  [14, 88],
  [11, 78],
  [10, 68],
  [18, 70],
  [28, 74],
  [32, 42],
  [36, 8],
  [22, -2],
  [6, -12],
  [10, -48],
  [14, -78],
  [30, -104],
  [48, -128],
];

const PATH_WEST: [number, number][] = [
  [16, 102],
  [-8, 88],
  [-36, 64],
  [-58, 48],
  [-72, 36],
  [-92, 22],
  [-108, 8],
];

const PATH_EAST: [number, number][] = [
  [36, 8],
  [70, 16],
  [96, 24],
  [118, 28],
];

const FLATS: { x: number; z: number; r: number; y: number }[] = [
  { x: 16, z: 102, r: 6.5, y: 11.4 },
  { x: 22, z: 90, r: 2.4, y: 14.2 },
  { x: 22, z: 90, r: 1.6, y: 17.6 },
  { x: 8, z: 78, r: 3.2, y: 9.6 },
  { x: 28, z: 74, r: 5.5, y: 10.4 },
  { x: 4, z: 84, r: 4.0, y: 6.8 },
  { x: 10, z: 68, r: 7.5, y: 11.1 },
  { x: 36, z: 8, r: 9.5, y: 9.6 },
  // Rime sits in the lake. Inner 0.35*r is the only fully dry disk; r=6.5 left a
  // ~2 m pad under the 4.4 m shrine body and the approach ring was water.
  { x: -72, z: 36, r: 12.5, y: 8.4 },
  { x: 118, z: 28, r: 8.0, y: 10.2 },
  { x: 14, z: -78, r: 8.0, y: 13.4 },
  { x: -108, z: 8, r: 7.0, y: 7.8 },
  { x: 48, z: -128, r: 7.5, y: 16.8 },
  { x: 6, z: -12, r: 8.0, y: 12.2 },
];

function coastalMask(x: number, z: number) {
  const r = Math.hypot(x / HALF, z / HALF);
  if (r < 0.78) return 1;
  if (r > 1.04) return 0;
  return Math.pow(Math.max(0, 1 - (r - 0.78) / 0.26), 1.35);
}

function polylineDist(x: number, z: number, pts: [number, number][]) {
  let m = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    m = Math.min(m, distSeg(x, z, a[0], a[1], b[0], b[1]));
  }
  return m;
}

function pathDist(x: number, z: number) {
  return Math.min(polylineDist(x, z, PATH), polylineDist(x, z, PATH_WEST), polylineDist(x, z, PATH_EAST));
}

export function computeHeight(x: number, z: number): number {
  const nx = x / HALF;
  const nz = z / HALF;
  const r = Math.hypot(nx, nz);
  const coast = coastalMask(x, z);
  if (coast <= 0.002) return -12;

  const hills = (fbm(x * 0.0068, z * 0.0068, 5) - 0.48) * 7.2;
  const detail = (fbm(x * 0.028 + 9, z * 0.028, 3) - 0.5) * 1.6;

  const pd = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  const plateau = smoothstep(70, 34, pd) * 8.5;

  const md = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
  const peak = Math.pow(Math.max(0, 1 - md / 102), 1.55) * 48;
  const ridge = (fbm(x * 0.016 + 3, z * 0.016, 3) - 0.5) * peak * 0.14;

  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  const lake = -smoothstep(58, 14, ld) * 14;

  const fd = Math.hypot(x - FOREST.x, z - FOREST.z);
  const forest = smoothstep(78, 28, fd) * (fbm(x * 0.02, z * 0.02, 3) - 0.35) * 7;

  const cd = Math.hypot(x - CITADEL.x, z - CITADEL.z);
  const keep = smoothstep(36, 12, cd) * 7;

  const rd = riverDist(x, z);
  const river = -smoothstep(11, 2.2, rd) * 6.2;

  const vd = Math.hypot(x - WIND_VALLEY.x, z - WIND_VALLEY.z);
  const valley = -smoothstep(22, 8, vd) * 2.4;

  let h = 7.2 + hills + detail + plateau + peak + ridge + lake + forest + keep + river + valley;

  const pth = pathDist(x, z);
  if (pth < 5.5) {
    const k = smoothstep(5.5, 1.4, pth);
    const road = Math.max(WATER_LEVEL + 2.4, Math.min(h, 18.5));
    h = h * (1 - k) + road * k;
  }

  for (const f of FLATS) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r) {
      const k = smoothstep(f.r, f.r * 0.35, d);
      h = h * (1 - k) + f.y * k;
    }
  }

  const ruin = Math.hypot(x - WIND_RUIN.x, z - WIND_RUIN.z);
  if (ruin < 8) h = Math.max(h, 10.1 * smoothstep(8, 3, ruin) + h * (1 - smoothstep(8, 3, ruin)));

  h *= coast;
  if (h > -1 && h < 5 && r > 0.74) h = h * 0.7 + 1.6;
  return h;
}

export type Climate = "temperate" | "lakeside" | "forest" | "highland" | "frost";

export function climateAt(x: number, z: number, h: number): Climate {
  const md = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
  if (md < 78 && h > 36) return "frost";
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (ld < 48) return "lakeside";
  const fd = Math.hypot(x - FOREST.x, z - FOREST.z);
  if (fd < 70) return "forest";
  if (h > 28) return "highland";
  return "temperate";
}

/** Vertex count along one edge of the shared collision/visual grid. Must match Scene PlaneGeometry. */
export const TERRAIN_RES = 160;

type HeightField = {
  res: number;
  ys: Float32Array;
};

let heightField: HeightField | null = null;

export function terrainVertexXZ(ix: number, iy: number, res: number) {
  const seg = WORLD_SIZE / (res - 1);
  return { x: Math.fround(ix * seg - HALF), z: Math.fround(iy * seg - HALF) };
}

export function buildHeightField(res = TERRAIN_RES): HeightField {
  const ys = new Float32Array(res * res);
  for (let iy = 0; iy < res; iy++) {
    for (let ix = 0; ix < res; ix++) {
      const { x, z } = terrainVertexXZ(ix, iy, res);
      ys[iy * res + ix] = computeHeight(x, z);
    }
  }
  heightField = { res, ys };
  return heightField;
}

export function getHeightField(): HeightField {
  return heightField ?? buildHeightField();
}

export function resetHeightField() {
  heightField = null;
}

function barycentric(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  const v0x = bx - ax;
  const v0z = bz - az;
  const v1x = cx - ax;
  const v1z = cz - az;
  const v2x = px - ax;
  const v2z = pz - az;
  const den = v0x * v1z - v1x * v0z;
  if (Math.abs(den) < 1e-12) return { u: 0, v: 0, w: 1 };
  const v = (v2x * v1z - v1x * v2z) / den;
  const w = (v0x * v2z - v2x * v0z) / den;
  const u = 1 - v - w;
  return { u, v, w };
}

/**
 * Height on the same triangles as THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res-1, res-1)
 * after rotateX(-PI/2). Diagonals match Three's (a,b,d) / (b,c,d) indices.
 */
export function heightAt(x: number, z: number): number {
  const { res, ys } = getHeightField();
  const seg = WORLD_SIZE / (res - 1);
  const fx = (x + HALF) / seg;
  const fy = (z + HALF) / seg;
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return -12;
  const ix = Math.min(res - 2, Math.max(0, Math.floor(fx)));
  const iy = Math.min(res - 2, Math.max(0, Math.floor(fy)));
  const u = Math.min(1, Math.max(0, fx - ix));
  const v = Math.min(1, Math.max(0, fy - iy));
  const h00 = ys[iy * res + ix]!;
  const h10 = ys[iy * res + ix + 1]!;
  const h01 = ys[(iy + 1) * res + ix]!;
  const h11 = ys[(iy + 1) * res + ix + 1]!;
  const a = terrainVertexXZ(ix, iy, res);
  const b = terrainVertexXZ(ix, iy + 1, res);
  const c = terrainVertexXZ(ix + 1, iy + 1, res);
  const d = terrainVertexXZ(ix + 1, iy, res);
  if (u + v <= 1) {
    const w = barycentric(x, z, a.x, a.z, b.x, b.z, d.x, d.z);
    return w.u * h00 + w.v * h01 + w.w * h10;
  }
  const w = barycentric(x, z, b.x, b.z, c.x, c.z, d.x, d.z);
  return w.u * h01 + w.v * h11 + w.w * h10;
}

export function triangleNormalAt(x: number, z: number) {
  const { res, ys } = getHeightField();
  const seg = WORLD_SIZE / (res - 1);
  const fx = (x + HALF) / seg;
  const fy = (z + HALF) / seg;
  const ix = Math.min(res - 2, Math.max(0, Math.floor(fx)));
  const iy = Math.min(res - 2, Math.max(0, Math.floor(fy)));
  const u = fx - ix;
  const v = fy - iy;
  const h00 = ys[iy * res + ix]!;
  const h10 = ys[iy * res + ix + 1]!;
  const h01 = ys[(iy + 1) * res + ix]!;
  const h11 = ys[(iy + 1) * res + ix + 1]!;
  const a = terrainVertexXZ(ix, iy, res);
  const b = terrainVertexXZ(ix, iy + 1, res);
  const d = terrainVertexXZ(ix + 1, iy, res);
  let ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number;
  if (u + v <= 1) {
    ax = a.x;
    ay = h00;
    az = a.z;
    bx = b.x;
    by = h01;
    bz = b.z;
    cx = d.x;
    cy = h10;
    cz = d.z;
  } else {
    ax = b.x;
    ay = h01;
    az = b.z;
    bx = terrainVertexXZ(ix + 1, iy + 1, res).x;
    by = h11;
    bz = terrainVertexXZ(ix + 1, iy + 1, res).z;
    cx = d.x;
    cy = h10;
    cz = d.z;
  }
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return { x: nx / len, y: ny / len, z: nz / len };
}

export function vertexHeight(ix: number, iy: number) {
  const { res, ys } = getHeightField();
  const x = Math.min(res - 1, Math.max(0, ix));
  const y = Math.min(res - 1, Math.max(0, iy));
  return ys[y * res + x]!;
}

export function normalAt(x: number, z: number, _e = 0.65) {
  return triangleNormalAt(x, z);
}

export type Biome = "ocean" | "sand" | "grass" | "plateau" | "forest" | "rock" | "snow";

export function biomeAt(x: number, z: number, h: number): Biome {
  if (h < WATER_LEVEL + 0.15) return "ocean";
  const n = normalAt(x, z);
  if (n.y < 0.58) return "rock";
  const climate = climateAt(x, z, h);
  if (climate === "frost") return "snow";
  if (h < WATER_LEVEL + 2.4) return "sand";
  const pd = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  if (pd < 52 && h > 9 && climate !== "lakeside") return "plateau";
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
      r = 0.22;
      g = 0.42;
      bch = 0.4;
      break;
    case "sand":
      r = 0.82;
      g = 0.74;
      bch = 0.52;
      break;
    case "plateau":
      r = 0.55;
      g = 0.68;
      bch = 0.34;
      break;
    case "forest":
      r = 0.28;
      g = 0.48;
      bch = 0.24;
      break;
    case "rock":
      r = 0.58;
      g = 0.54;
      bch = 0.48;
      break;
    case "snow":
      r = 0.92;
      g = 0.94;
      bch = 0.96;
      break;
    default: {
      const t = fbm(x * 0.04, z * 0.04, 2);
      r = 0.38 + t * 0.14;
      g = 0.56 + t * 0.16;
      bch = 0.26;
    }
  }
  const pth = pathDist(x, z);
  if (pth < 3.6 && b !== "ocean" && b !== "snow") {
    const k = smoothstep(3.6, 0.8, pth);
    r = r * (1 - k) + 0.62 * k;
    g = g * (1 - k) + 0.5 * k;
    bch = bch * (1 - k) + 0.32 * k;
  }
  if (slope > 0.28 && b !== "snow") {
    const k = Math.min(1, (slope - 0.28) * 2.2);
    r = r * (1 - k) + 0.62 * k;
    g = g * (1 - k) + 0.56 * k;
    bch = bch * (1 - k) + 0.48 * k;
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
