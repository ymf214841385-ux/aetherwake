import * as THREE from "three";

/** Tiny seeded RNG — same family as height.ts hash, local so this package stays self-contained. */
export function fract(n: number) {
  return n - Math.floor(n);
}

export function hash01(a: number, b = 0) {
  return fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
}

export function hash3(x: number, y: number, z: number) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
}

export class Seeded {
  private s: number;
  constructor(seed: number) {
    this.s = seed || 1;
  }
  next() {
    this.s = fract(Math.sin(this.s * 127.1 + 311.7) * 43758.5453 + 0.132);
    return this.s;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  signed() {
    return this.next() * 2 - 1;
  }
}

function fade(t: number) {
  return t * t * (3 - 2 * t);
}

export function valueNoise3(x: number, y: number, z: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);
  const nx00 = n000 + (n100 - n000) * fx;
  const nx10 = n010 + (n110 - n010) * fx;
  const nx01 = n001 + (n101 - n001) * fx;
  const nx11 = n011 + (n111 - n011) * fx;
  const nxy0 = nx00 + (nx10 - nx00) * fy;
  const nxy1 = nx01 + (nx11 - nx01) * fy;
  return nxy0 + (nxy1 - nxy0) * fz;
}

export function fbm3(x: number, y: number, z: number, oct = 4) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < oct; i++) {
    v += valueNoise3(x * f, y * f, z * f) * a;
    s += a;
    a *= 0.5;
    f *= 2.07;
  }
  return v / s;
}

export function mergeGeometries(list: THREE.BufferGeometry[]) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  let hasUv = true;
  let hasColor = true;
  let hasNormal = true;
  for (const g of parts) {
    count += g.attributes.position!.count;
    if (!g.attributes.uv) hasUv = false;
    if (!g.attributes.color) hasColor = false;
    if (!g.attributes.normal) hasNormal = false;
  }
  const pos = new Float32Array(count * 3);
  const nrm = hasNormal ? new Float32Array(count * 3) : null;
  const uv = hasUv ? new Float32Array(count * 2) : null;
  const col = hasColor ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const g of parts) {
    const p = g.attributes.position!;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    const c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos[o * 3] = p.getX(i);
      pos[o * 3 + 1] = p.getY(i);
      pos[o * 3 + 2] = p.getZ(i);
      if (nrm && n) {
        nrm[o * 3] = n.getX(i);
        nrm[o * 3 + 1] = n.getY(i);
        nrm[o * 3 + 2] = n.getZ(i);
      }
      if (uv && u) {
        uv[o * 2] = u.getX(i);
        uv[o * 2 + 1] = u.getY(i);
      }
      if (col && c) {
        col[o * 3] = c.getX(i);
        col[o * 3 + 1] = c.getY(i);
        col[o * 3 + 2] = c.getZ(i);
      }
      o++;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (nrm) out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  else out.computeVertexNormals();
  if (uv) out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

export function applyMatrix(geo: THREE.BufferGeometry, fn: (m: THREE.Matrix4) => void) {
  const g = geo.clone();
  const m = new THREE.Matrix4();
  fn(m);
  g.applyMatrix4(m);
  return g;
}

export function boxProjectUv(geo: THREE.BufferGeometry, scale = 0.55) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position!;
  const nrm = geo.attributes.normal!;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    let u = 0;
    let v = 0;
    if (ax >= ay && ax >= az) {
      u = z;
      v = y;
    } else if (ay >= ax && ay >= az) {
      u = x;
      v = z;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u * scale + 0.5;
    uv[i * 2 + 1] = v * scale + 0.5;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export function recenterOnGround(geo: THREE.BufferGeometry, embed = 0.08) {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const cx = (b.min.x + b.max.x) * 0.5;
  const cz = (b.min.z + b.max.z) * 0.5;
  const y0 = b.min.y + (b.max.y - b.min.y) * embed;
  geo.translate(-cx, -y0, -cz);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}
