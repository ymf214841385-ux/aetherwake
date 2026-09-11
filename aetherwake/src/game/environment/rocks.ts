import * as THREE from "three";
import { boxProjectUv, fbm3, recenterOnGround, Seeded } from "./proc.ts";
import type { LodLevel } from "./types.ts";

type Fracture = { nx: number; ny: number; nz: number; d: number };

type RockSpec = {
  seed: number;
  stretch: [number, number, number];
  flatten: number;
  noiseAmp: number;
  noiseFreq: number;
  ridges: number;
  fractures: Fracture[];
  lumps: { x: number; y: number; z: number; r: number; s: number }[];
};

/** Distinct silhouettes — not scaled spheres. */
const SPECS: RockSpec[] = [
  {
    seed: 11,
    stretch: [1.35, 0.62, 1.05],
    flatten: 0.55,
    noiseAmp: 0.22,
    noiseFreq: 1.6,
    ridges: 0.18,
    fractures: [
      { nx: 0.72, ny: 0.2, nz: 0.4, d: 0.62 },
      { nx: -0.3, ny: 0.85, nz: 0.15, d: 0.7 },
    ],
    lumps: [{ x: 0.35, y: 0.1, z: -0.2, r: 0.45, s: 0.18 }],
  },
  {
    seed: 29,
    stretch: [0.7, 1.45, 0.78],
    flatten: 0.32,
    noiseAmp: 0.16,
    noiseFreq: 1.3,
    ridges: 0.28,
    fractures: [{ nx: 0.55, ny: 0.1, nz: -0.7, d: 0.58 }],
    lumps: [
      { x: 0.15, y: 0.55, z: 0.1, r: 0.35, s: 0.14 },
      { x: -0.2, y: 0.2, z: 0.25, r: 0.3, s: 0.1 },
    ],
  },
  {
    seed: 47,
    stretch: [1.55, 0.42, 0.95],
    flatten: 0.7,
    noiseAmp: 0.12,
    noiseFreq: 2.1,
    ridges: 0.08,
    fractures: [
      { nx: 0.1, ny: 0.95, nz: 0.05, d: 0.38 },
      { nx: 0.82, ny: 0.15, nz: 0.2, d: 0.7 },
      { nx: -0.75, ny: 0.2, nz: 0.4, d: 0.68 },
    ],
    lumps: [],
  },
  {
    seed: 61,
    stretch: [0.95, 0.85, 1.15],
    flatten: 0.4,
    noiseAmp: 0.28,
    noiseFreq: 1.1,
    ridges: 0.12,
    fractures: [{ nx: -0.4, ny: 0.5, nz: 0.7, d: 0.72 }],
    lumps: [
      { x: 0.4, y: -0.05, z: 0.15, r: 0.5, s: 0.22 },
      { x: -0.3, y: 0.15, z: -0.25, r: 0.38, s: 0.16 },
    ],
  },
  {
    seed: 83,
    stretch: [1.1, 0.95, 0.55],
    flatten: 0.38,
    noiseAmp: 0.2,
    noiseFreq: 1.8,
    ridges: 0.34,
    fractures: [
      { nx: 0.2, ny: 0.15, nz: 0.92, d: 0.48 },
      { nx: 0.65, ny: 0.55, nz: -0.3, d: 0.66 },
    ],
    lumps: [{ x: 0.05, y: 0.4, z: -0.05, r: 0.42, s: 0.2 }],
  },
  {
    seed: 97,
    stretch: [0.82, 0.7, 1.4],
    flatten: 0.48,
    noiseAmp: 0.18,
    noiseFreq: 1.45,
    ridges: 0.22,
    fractures: [{ nx: 0.9, ny: 0.25, nz: 0.05, d: 0.6 }],
    lumps: [
      { x: -0.25, y: 0.05, z: 0.45, r: 0.4, s: 0.15 },
      { x: 0.2, y: 0.25, z: -0.3, r: 0.33, s: 0.12 },
    ],
  },
];

function lodDetail(lod: LodLevel) {
  if (lod === "high") return 2;
  if (lod === "mid") return 1;
  return 0;
}

function displaceRock(geo: THREE.BufferGeometry, spec: RockSpec) {
  const rng = new Seeded(spec.seed);
  const pos = geo.attributes.position!;
  const ridgeDir = new THREE.Vector3(rng.signed(), 0.15, rng.signed()).normalize();
  const tmp = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    tmp.x *= spec.stretch[0];
    tmp.y *= spec.stretch[1];
    tmp.z *= spec.stretch[2];

    const n = fbm3(tmp.x * spec.noiseFreq + spec.seed, tmp.y * spec.noiseFreq, tmp.z * spec.noiseFreq, 4);
    tmp.addScaledVector(tmp.clone().normalize(), (n - 0.5) * spec.noiseAmp * 2.2);

    const along = tmp.dot(ridgeDir);
    const ridge = Math.exp(-along * along * 2.6) * spec.ridges * 1.15;
    tmp.addScaledVector(ridgeDir, ridge * (n - 0.28));

    for (const f of spec.fractures) {
      const d = tmp.x * f.nx + tmp.y * f.ny + tmp.z * f.nz;
      if (d > f.d) {
        const excess = d - f.d;
        tmp.x -= f.nx * excess * 1.15;
        tmp.y -= f.ny * excess * 1.15;
        tmp.z -= f.nz * excess * 1.15;
      } else if (d > f.d - 0.08) {
        const k = 1 - (f.d - d) / 0.08;
        tmp.addScaledVector(tmp.clone().normalize(), -k * 0.04);
      }
    }

    for (const lump of spec.lumps) {
      const dx = tmp.x - lump.x;
      const dy = tmp.y - lump.y;
      const dz = tmp.z - lump.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      if (dist < lump.r) {
        const k = (1 - dist / lump.r) * lump.s;
        tmp.x += (dx / dist) * k;
        tmp.y += (dy / dist) * k;
        tmp.z += (dz / dist) * k;
      }
    }

    if (tmp.y < -0.15) {
      const k = spec.flatten;
      tmp.y = tmp.y * (1 - k) + -0.15 * k;
      tmp.x *= 1 + ( -0.15 - tmp.y) * 0.35 * k;
      tmp.z *= 1 + ( -0.15 - tmp.y) * 0.35 * k;
    }

    pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  mossTint(geo);
  boxProjectUv(geo, 0.48);
  recenterOnGround(geo, 0.1);
}

function mossTint(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position!;
  const nrm = geo.attributes.normal!;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    const y = pos.getY(i);
    const moss = Math.max(0, ny - 0.35) * 0.18 * Math.max(0, y);
    col[i * 3] = 0.78 - moss * 0.25;
    col[i * 3 + 1] = 0.76 + moss * 0.12;
    col[i * 3 + 2] = 0.72 - moss * 0.18;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

export function createRockGeometry(index: number, lod: LodLevel = "high") {
  const spec = SPECS[index % SPECS.length]!;
  const geo = new THREE.IcosahedronGeometry(1, lodDetail(lod));
  displaceRock(geo, spec);
  geo.name = `aw-rock-${index}-${lod}`;
  return geo;
}

/** High-detail unique boulders for instancing (shared geo, per-instance transform). */
export function createRockGeometries(): THREE.BufferGeometry[] {
  return SPECS.map((_, i) => createRockGeometry(i, "high"));
}

export function createRockLodSets(): { high: THREE.BufferGeometry; mid: THREE.BufferGeometry; low: THREE.BufferGeometry }[] {
  return SPECS.map((_, i) => ({
    high: createRockGeometry(i, "high"),
    mid: createRockGeometry(i, "mid"),
    low: createRockGeometry(i, "low"),
  }));
}

export const ROCK_VARIANT_COUNT = SPECS.length;
