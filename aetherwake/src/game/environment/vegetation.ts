import * as THREE from "three";
import { WATER_LEVEL, hash01 as worldHash, heightAt } from "../height.ts";
import { applyMatrix, fbm3, mergeGeometries, Seeded } from "./proc.ts";
import type { InstanceItem, LodGeometries, LodLevel } from "./types.ts";

function subdiv(lod: LodLevel, high: number, mid: number, low: number) {
  if (lod === "high") return high;
  if (lod === "mid") return mid;
  return low;
}

function displaceMesh(geo: THREE.BufferGeometry, amp: number, freq: number, seed: number) {
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = fbm3(x * freq + seed, y * freq, z * freq + seed * 0.3, 3);
    const nx = x;
    const ny = y;
    const nz = z;
    const len = Math.hypot(nx, ny, nz) || 1;
    const k = (n - 0.5) * 2 * amp;
    pos.setXYZ(i, x + (nx / len) * k, y + (ny / len) * k * 0.7, z + (nz / len) * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function makeTrunk(opts: {
  height: number;
  rBottom: number;
  rTop: number;
  lean: number;
  twist: number;
  lod: LodLevel;
  seed: number;
}) {
  const radial = subdiv(opts.lod, 9, 7, 5);
  const tubular = subdiv(opts.lod, 7, 4, 2);
  const rng = new Seeded(opts.seed);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const lean = opts.lean * t * t;
    pts.push(
      new THREE.Vector3(
        lean + rng.signed() * 0.02 * t,
        opts.height * t,
        opts.twist * t * 0.35 + rng.signed() * 0.015 * t,
      ),
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.min(1, Math.max(0, y / opts.height));
    const r = opts.rBottom + (opts.rTop - opts.rBottom) * t;
    const ridge = 1 + Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 6.0 + y * 3.5) * 0.045;
    pos.setX(i, pos.getX(i) * r * ridge);
    pos.setZ(i, pos.getZ(i) * r * ridge);
  }
  if (opts.lod === "high") {
    const stubCount = 2;
    const parts: THREE.BufferGeometry[] = [geo];
    for (let s = 0; s < stubCount; s++) {
      const y = opts.height * (0.45 + s * 0.22);
      const stub = new THREE.CylinderGeometry(opts.rTop * 0.45, opts.rTop * 0.7, opts.height * 0.18, 5);
      const ang = rng.range(0, Math.PI * 2);
      parts.push(
        applyMatrix(stub, (m) => {
          m.makeRotationZ(rng.range(0.7, 1.15) * (s % 2 === 0 ? 1 : -1));
          m.setPosition(Math.cos(ang) * opts.rBottom * 0.4, y, Math.sin(ang) * opts.rBottom * 0.4);
        }),
      );
    }
    const merged = mergeGeometries(parts);
    geo.dispose();
    merged.computeVertexNormals();
    return merged;
  }
  geo.computeVertexNormals();
  return geo;
}

function tintFoliage(geo: THREE.BufferGeometry, seed: number, pine: boolean) {
  const pos = geo.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const n = fbm3(pos.getX(i) * 1.8 + seed, y * 1.4, pos.getZ(i) * 1.8, 2);
    const shade = 0.72 + n * 0.38 + Math.max(0, y) * 0.04;
    if (pine) {
      col[i * 3] = 0.22 * shade;
      col[i * 3 + 1] = 0.38 * shade;
      col[i * 3 + 2] = 0.26 * shade;
    } else {
      col[i * 3] = 0.28 * shade;
      col[i * 3 + 1] = 0.42 * shade;
      col[i * 3 + 2] = 0.22 * shade;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

function makeBroadleafCrown(lod: LodLevel, seed: number, scale: number) {
  const rng = new Seeded(seed);
  const det = subdiv(lod, 1, 1, 0);
  const blobCount = subdiv(lod, 8, 5, 2);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < blobCount; i++) {
    const r = (0.42 + rng.next() * 0.48) * scale;
    const g = new THREE.IcosahedronGeometry(r, det);
    displaceMesh(g, 0.22 * r, 2.8 / r, seed + i * 13);
    const ox = rng.signed() * 0.7 * scale;
    const oy = rng.range(-0.12, 0.58) * scale;
    const oz = rng.signed() * 0.62 * scale;
    g.translate(ox, oy, oz);
    parts.push(g);
  }
  if (lod === "high") {
    for (let b = 0; b < 3; b++) {
      const len = rng.range(0.35, 0.55) * scale;
      const branch = new THREE.CylinderGeometry(0.018 * scale, 0.032 * scale, len, 5);
      const ang = rng.range(0, Math.PI * 2);
      parts.push(
        applyMatrix(branch, (m) => {
          m.makeRotationZ(rng.range(0.6, 1.15) * (b % 2 === 0 ? 1 : -1));
          m.setPosition(Math.cos(ang) * 0.15 * scale, rng.range(-0.05, 0.2) * scale, Math.sin(ang) * 0.15 * scale);
        }),
      );
    }
  }
  const crown = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const pos = crown.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -0.18 * scale) pos.setY(i, y * 0.5 - 0.1 * scale);
  }
  crown.computeVertexNormals();
  tintFoliage(crown, seed, false);
  return crown;
}

function makePineCrown(lod: LodLevel, seed: number, scale: number) {
  const rng = new Seeded(seed);
  const layers = subdiv(lod, 5, 3, 1);
  const segs = subdiv(lod, 9, 6, 5);
  const parts: THREE.BufferGeometry[] = [];
  let y = 0.12 * scale;
  for (let i = 0; i < layers; i++) {
    const t = i / Math.max(1, layers - 1);
    const w = (1.22 - t * 0.78) * scale * rng.range(0.92, 1.08);
    const h = (0.78 - t * 0.1) * scale;
    const cone = new THREE.ConeGeometry(w, h, segs);
    const pos = cone.attributes.position!;
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v);
      const py = pos.getY(v);
      const pz = pos.getZ(v);
      const ang = Math.atan2(pz, px);
      const n = fbm3(px * 2.4 + seed, py * 1.6, pz * 2.4, 3);
      const jag = 1 + Math.sin(ang * 8 + i * 1.7) * 0.14 + (n - 0.5) * 0.28;
      if (py > -h * 0.45) {
        pos.setX(v, px * jag);
        pos.setZ(v, pz * jag);
        pos.setY(v, py + Math.sin(ang * 6) * 0.04 * scale);
      }
    }
    cone.computeVertexNormals();
    cone.rotateY(rng.range(0, 0.8));
    cone.translate(rng.signed() * 0.08 * scale, y + h * 0.5, rng.signed() * 0.08 * scale);
    parts.push(cone);
    y += h * 0.46;
  }
  const crown = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  tintFoliage(crown, seed, true);
  return crown;
}

export type TreeVariant = {
  trunk: LodGeometries;
  crown: LodGeometries;
  kind: "broadleaf" | "pine";
  crownLift: number;
};

function buildBroadleaf(seed: number, scale: number): TreeVariant {
  const height = 2.3 * scale;
  const make = (lod: LodLevel) => {
    const trunk = makeTrunk({
      height,
      rBottom: 0.16 * scale,
      rTop: 0.07 * scale,
      lean: (hash01ish(seed) - 0.5) * 0.45 * scale,
      twist: (hash01ish(seed + 3) - 0.5) * 0.25 * scale,
      lod,
      seed,
    });
    const crown = makeBroadleafCrown(lod, seed + 9, 1.05 * scale);
    crown.translate(0, height * 0.92, 0);
    return { trunk, crown };
  };
  const high = make("high");
  const mid = make("mid");
  const low = make("low");
  return {
    kind: "broadleaf",
    crownLift: height * 0.92,
    trunk: { high: high.trunk, mid: mid.trunk, low: low.trunk },
    crown: { high: high.crown, mid: mid.crown, low: low.crown },
  };
}

function buildPine(seed: number, scale: number): TreeVariant {
  const height = 2.6 * scale;
  const make = (lod: LodLevel) => {
    const trunk = makeTrunk({
      height,
      rBottom: 0.12 * scale,
      rTop: 0.05 * scale,
      lean: (hash01ish(seed) - 0.5) * 0.18 * scale,
      twist: 0,
      lod,
      seed,
    });
    const crown = makePineCrown(lod, seed + 5, 0.95 * scale);
    crown.translate(0, height * 0.42, 0);
    return { trunk, crown };
  };
  const high = make("high");
  const mid = make("mid");
  const low = make("low");
  return {
    kind: "pine",
    crownLift: height * 0.42,
    trunk: { high: high.trunk, mid: mid.trunk, low: low.trunk },
    crown: { high: high.crown, mid: mid.crown, low: low.crown },
  };
}

function hash01ish(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export function createGrassClumpGeometry(lod: LodLevel = "high") {
  const bladeCount = subdiv(lod, 12, 7, 4);
  const segs = subdiv(lod, 4, 3, 2);
  const rng = new Seeded(lod === "high" ? 4 : lod === "mid" ? 5 : 6);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let b = 0; b < bladeCount; b++) {
    const yaw = rng.range(0, Math.PI * 2);
    const cx = Math.cos(yaw) * rng.range(0.02, 0.11);
    const cz = Math.sin(yaw) * rng.range(0.02, 0.11);
    const h = rng.range(0.28, 0.55);
    const w0 = rng.range(0.016, 0.032);
    const leanX = rng.signed() * 0.22;
    const leanZ = rng.signed() * 0.22;
    const base = positions.length / 3;
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const width = w0 * (1 - t * 0.85);
      const y = h * t;
      const flare = t * t;
      const px = cx + leanX * flare;
      const pz = cz + leanZ * flare;
      const pxL = px - dz * width;
      const pzL = pz + dx * width;
      const pxR = px + dz * width;
      const pzR = pz - dx * width;
      positions.push(pxL, y, pzL, pxR, y, pzR);
      const nx = -leanX * 0.4;
      const nz = -leanZ * 0.4;
      const ny = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / len, ny / len, nz / len, nx / len, ny / len, nz / len);
      uvs.push(0, t, 1, t);
      const shade = 0.55 + t * 0.45;
      colors.push(0.32 * shade, 0.46 * shade, 0.24 * shade, 0.38 * shade, 0.52 * shade, 0.26 * shade);
    }
    for (let s = 0; s < segs; s++) {
      const i = base + s * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.name = `aw-grass-${lod}`;
  return geo;
}

export function createVegetationKit(): {
  broadleaf: TreeVariant[];
  pine: TreeVariant[];
  grass: LodGeometries;
} {
  return {
    broadleaf: [buildBroadleaf(21, 1), buildBroadleaf(44, 0.92), buildBroadleaf(67, 1.12)],
    pine: [buildPine(12, 1), buildPine(38, 1.18)],
    grass: {
      high: createGrassClumpGeometry("high"),
      mid: createGrassClumpGeometry("mid"),
      low: createGrassClumpGeometry("low"),
    },
  };
}

/** Matches Scene GrassField scatter around the plateau spawn, density-scaled. */
export function scatterGrass(opts: {
  count: number;
  originX?: number;
  originZ?: number;
  spanX?: number;
  spanZ?: number;
  heightFn?: (x: number, z: number) => number;
}): InstanceItem[] {
  const originX = opts.originX ?? 16;
  const originZ = opts.originZ ?? 88;
  const spanX = opts.spanX ?? 90;
  const spanZ = opts.spanZ ?? 70;
  const hFn = opts.heightFn ?? heightAt;
  const list: InstanceItem[] = [];
  for (let i = 0; i < opts.count; i++) {
    const x = originX + (worldHash(i, 3) - 0.5) * spanX;
    const z = originZ + (worldHash(i, 8) - 0.5) * spanZ;
    const h = hFn(x, z);
    if (h < WATER_LEVEL + 0.6) continue;
    if (Math.hypot(x - 16, z - 102) < 5) continue;
    list.push({
      x,
      y: h,
      z,
      s: 0.7 + worldHash(i, 11) * 0.8,
      rot: worldHash(i, 4) * 6,
      kind: 0,
    });
  }
  return list;
}

export function pickTreeVariant(kind: number, index: number, variantCount: number) {
  return Math.abs(kind + index) % Math.max(1, variantCount);
}
