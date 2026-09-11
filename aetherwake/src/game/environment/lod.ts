import * as THREE from "three";
import type { InstanceItem, LodLevel } from "./types.ts";

export const LOD_DISTANCES = {
  tree: { high: 22, mid: 58, low: 130, cull: 210 },
  rock: { high: 18, mid: 50, low: 110, cull: 180 },
  grass: { high: 12, mid: 28, low: 50, cull: 72 },
} as const;

export type LodBand = { high: number; mid: number; low: number; cull: number };

export function lodLevelAt(distance: number, band: LodBand): LodLevel | "cull" {
  if (distance <= band.high) return "high";
  if (distance <= band.mid) return "mid";
  if (distance <= band.cull) return "low";
  return "cull";
}

export function bucketByLod(items: InstanceItem[], origin: THREE.Vector3, band: LodBand) {
  const high: number[] = [];
  const mid: number[] = [];
  const low: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const d = Math.hypot(it.x - origin.x, it.z - origin.z);
    const lod = lodLevelAt(d, band);
    if (lod === "high") high.push(i);
    else if (lod === "mid") mid.push(i);
    else if (lod === "low") low.push(i);
  }
  return { high, mid, low };
}

export function writeInstanceMatrices(
  mesh: THREE.InstancedMesh,
  items: InstanceItem[],
  indices: number[] | null,
  dummy: THREE.Object3D,
) {
  const src = indices ?? items.map((_, i) => i);
  let written = 0;
  for (let n = 0; n < src.length; n++) {
    const it = items[src[n]!];
    if (!it) continue;
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(0, it.rot, 0);
    dummy.scale.setScalar(it.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(written, dummy.matrix);
    written++;
  }
  mesh.count = written;
  mesh.instanceMatrix.needsUpdate = true;
}
