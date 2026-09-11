import * as THREE from "three";
import {
  TERRAIN_RES,
  WORLD_SIZE,
  colorAt,
  getHeightField,
  terrainVertexXZ,
} from "../height.ts";

/**
 * Same layout as Scene.tsx buildTerrain():
 * PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res-1, res-1) → rotateX(-PI/2) →
 * overwrite (x, height, z) from terrainVertexXZ + height field → vertex colors → normals.
 *
 * Index winding after this is CCW from +Y (FrontSide). Proof: triangle (a,b,d)
 * with b at +Z and d at +X has (b-a)×(d-a) = +Y on a flat cell; height displace
 * does not flip that for island slopes. Do not DoubleSide the ground mesh.
 */
export function buildDisplacedTerrainGeometry(
  res = TERRAIN_RES,
  size = WORLD_SIZE,
): THREE.BufferGeometry {
  const field = getHeightField();
  const geo = new THREE.PlaneGeometry(size, size, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ix = i % res;
    const iy = Math.floor(i / res);
    const { x, z } = terrainVertexXZ(ix, iy, res);
    const y = field.ys[iy * res + ix]!;
    pos.setXYZ(i, x, y, z);
    const c = colorAt(x, z, y);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.name = "aw-terrain";
  return geo;
}

/** Area-weighted mean of unit face-normal Y from index winding (not vertex normals). */
export function averageIndexedFaceNormalY(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos || !idx) throw new Error("averageIndexedFaceNormalY: indexed position required");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  let sumY = 0;
  let sumLen = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len < 1e-12) continue;
    sumY += n.y;
    sumLen += len;
  }
  if (sumLen < 1e-12) return 0;
  return sumY / sumLen;
}

export function averageVertexNormalY(geo: THREE.BufferGeometry): number {
  const nrm = geo.attributes.normal;
  if (!nrm) throw new Error("averageVertexNormalY: normals required");
  let s = 0;
  for (let i = 0; i < nrm.count; i++) s += nrm.getY(i);
  return s / nrm.count;
}
