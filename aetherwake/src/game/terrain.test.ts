import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  TERRAIN_RES,
  WORLD_SIZE,
  buildHeightField,
  heightAt,
  terrainVertexXZ,
} from "./height.ts";

function threeTerrainMesh() {
  buildHeightField(TERRAIN_RES);
  const res = TERRAIN_RES;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const ix = i % res;
    const iy = Math.floor(i / res);
    const { x, z } = terrainVertexXZ(ix, iy, res);
    const y = heightAt(x, z);
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

function rayY(mesh: THREE.Mesh, x: number, z: number) {
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(mesh, false);
  return hits[0]?.point.y ?? null;
}

describe("B12 visual triangle vs collision height", () => {
  it("vertex layout matches Three.js PlaneGeometry after rotateX", () => {
    const res = TERRAIN_RES;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res - 1, res - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position!;
    for (const [ix, iy] of [
      [0, 0],
      [res - 1, 0],
      [0, res - 1],
      [3, 7],
      [80, 40],
    ] as const) {
      const i = iy * res + ix;
      const { x, z } = terrainVertexXZ(ix, iy, res);
      assert.ok(Math.abs(pos.getX(i) - x) < 1e-4, `ix=${ix} iy=${iy} x ${pos.getX(i)} vs ${x}`);
      assert.ok(Math.abs(pos.getZ(i) - z) < 1e-4, `ix=${ix} iy=${iy} z ${pos.getZ(i)} vs ${z}`);
    }
  });

  it("diagonal midpoints match Three raycast, including the reported coastal cell", () => {
    const mesh = threeTerrainMesh();
    const samples: [number, number][] = [
      [65.2075471698, -188.3773584906],
      [16, 102],
      [10, 68],
      [30, -118],
      [-88, 20],
      [28, 74],
      [48, -128],
      [0, 0],
      [120, 40],
      [-40, 88],
    ];
    let maxAbs = 0;
    for (const [x, z] of samples) {
      const visual = rayY(mesh, x, z);
      const col = heightAt(x, z);
      assert.ok(visual != null, `no hit at ${x},${z}`);
      const err = Math.abs(visual! - col);
      if (err > maxAbs) maxAbs = err;
      assert.ok(err < 0.02, `x=${x} z=${z} visual=${visual} heightAt=${col} err=${err}`);
    }
    assert.ok(maxAbs < 0.02);
  });

  it("FrontSide (not DoubleSide) still raycasts from +Y after Scene-style displace", () => {
    buildHeightField(TERRAIN_RES);
    const res = TERRAIN_RES;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res - 1, res - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const ix = i % res;
      const iy = Math.floor(i / res);
      const { x, z } = terrainVertexXZ(ix, iy, res);
      pos.setXYZ(i, x, heightAt(x, z), z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const idx = geo.index!;
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
      n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      const len = n.length();
      if (len < 1e-12) continue;
      sumY += n.y;
      sumLen += len;
    }
    const faceY = sumY / sumLen;
    assert.ok(faceY > 0.55, `index winding faceY=${faceY} — FrontSide would cull the ground`);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(16, 400, 102), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(mesh, false);
    assert.ok(hits[0], "FrontSide miss at spawn — winding flipped");
    geo.dispose();
  });

  it("dense grid of cell diagonal midpoints stays under 2cm", () => {
    const mesh = threeTerrainMesh();
    const res = TERRAIN_RES;
    const seg = WORLD_SIZE / (res - 1);
    let maxErr = 0;
    let maxAt = [0, 0];
    for (let iy = 0; iy < res - 1; iy += 7) {
      for (let ix = 0; ix < res - 1; ix += 7) {
        const a = terrainVertexXZ(ix, iy, res);
        const c = terrainVertexXZ(ix + 1, iy + 1, res);
        const x = (a.x + c.x) * 0.5;
        const z = (a.z + c.z) * 0.5;
        const visual = rayY(mesh, x, z);
        if (visual == null) continue;
        const err = Math.abs(visual - heightAt(x, z));
        if (err > maxErr) {
          maxErr = err;
          maxAt = [x, z];
        }
      }
    }
    assert.ok(maxErr < 0.02, `maxErr=${maxErr} at ${maxAt} (cell ${seg})`);
  });
});
