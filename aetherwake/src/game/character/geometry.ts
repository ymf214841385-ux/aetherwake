import * as THREE from "three";

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * THREE.LatheGeometry winds outward only when the 2D profile runs increasing-Y
 * (bottom → top). Descending profiles produce inward faces (FrontSide culls the shell).
 *
 * Default phiStart is π so the UV/normal seam sits on -Z (the back). phi=0 in
 * Three's lathe is +Z, which is the character's face — a front seam reads as a
 * carved-wood centerline.
 */
export function latheOutward(
  pts: THREE.Vector2[],
  segs: number,
  phiStart = Math.PI,
  phiLength = Math.PI * 2,
) {
  const profile = pts.map((p) => p.clone());
  if (profile.length >= 2 && profile[0]!.y > profile[profile.length - 1]!.y) {
    profile.reverse();
  }
  return new THREE.LatheGeometry(profile, segs, phiStart, phiLength);
}

export function radialNormalCounts(geo: THREE.BufferGeometry, minR = 0.02) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  let inward = 0;
  let outward = 0;
  let skipped = 0;
  if (!pos || !nrm) return { inward, outward, skipped };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r <= minR) {
      skipped++;
      continue;
    }
    const dot = nrm.getX(i) * x + nrm.getZ(i) * z;
    if (dot > 0) outward++;
    else inward++;
  }
  return { inward, outward, skipped };
}

export function organic(geo: THREE.BufferGeometry, amount: number, seed = 1) {
  const pos = geo.attributes.position;
  if (!pos) return geo;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 17.2 + seed * 1.7) * Math.cos(y * 13.7 + seed * 2.1) * Math.sin(z * 11.3 + seed);
    const r = Math.hypot(x, z) || 1;
    const d = 1 + n * amount * (0.35 + Math.min(1, r * 8));
    pos.setX(i, x * d);
    pos.setZ(i, z * d);
  }
  geo.computeVertexNormals();
  return geo;
}

function smoothBump(dx: number, dy: number, dz: number, r: number) {
  const d = Math.hypot(dx, dy, dz);
  if (d >= r) return 0;
  const t = 1 - d / r;
  return t * t * (3 - 2 * t);
}

/**
 * Adult cranial oval with features sculpted into the surface (sockets, brow,
 * bridge, lips, chin). Face is +Z. Not a balloon + glued primitives.
 */
export function craniumGeometry(segs = 24) {
  const wSeg = Math.max(16, segs);
  const hSeg = Math.max(12, segs - 2);
  const g = new THREE.SphereGeometry(0.112, wSeg, hSeg);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Adult head: narrower oval, jaw shorter than cranium — not a doll sphere.
    x *= 0.72;
    y = y * 1.045 + 0.002;
    z *= 0.88;

    const r = Math.hypot(x, z) || 1;
    const nz = z / r;
    const face = Math.max(0, nz);
    const back = Math.max(0, -nz);

    // Layered face depth (brow / cheek / chin), not a single z*=0.74 flatten.
    const faceDepth =
      0.82 + face * 0.13 * (1 - Math.max(0, (y - 0.02) / 0.1)) + back * 0.2;
    z *= faceDepth;
    x *= 0.9 + Math.abs(nz) * 0.05;

    if (y > 0.03 && z > 0) {
      const fh = Math.min(1, (y - 0.03) / 0.085);
      z *= 1 - fh * 0.26 * face;
      y -= fh * 0.02 * face;
    }

    if (y < -0.01) {
      const j = Math.min(1, (-0.01 - y) / 0.105);
      const chinBias = Math.max(0, 1 - Math.abs(x) / 0.03);
      // Preserve a compact chin pad below the cheek plane. The former strong
      // centre pinch made the lower face read as a toy-like triangle.
      x *= 1 - j * (0.12 + chinBias * 0.045) * (1 - face * 0.3);
      z *= 1 - j * 0.16 * (1 - face * 0.5);
      if (Math.abs(x) > 0.032 && y < -0.03 && y > -0.07 && z > -0.02) {
        x += Math.sign(x) * 0.006 * j;
      }
    }

    const chin = smoothBump(x, y + 0.1, z - 0.058, 0.05);
    z += chin * 0.024 * face;
    y -= chin * 0.005;

    const mentalCrease = smoothBump(x * 1.6, y + 0.072, z - 0.086, 0.022);
    z -= mentalCrease * 0.007 * face;

    const jaw = smoothBump(Math.abs(x) - 0.048, y + 0.055, z - 0.012, 0.044);
    x += Math.sign(x || 1) * jaw * 0.016;
    z -= jaw * 0.008 * (1 - face);

    const browL = smoothBump(x + 0.032, (y - 0.042) * 1.3, z - 0.09, 0.032);
    const browR = smoothBump(x - 0.032, (y - 0.042) * 1.3, z - 0.09, 0.032);
    const brow = browL + browR;
    z += brow * 0.018 * face;
    y += brow * 0.0025 * face;

    const glabella = smoothBump(x * 2.2, y - 0.038, z - 0.092, 0.024);
    z += glabella * 0.01 * face;

    const cheek = smoothBump(Math.abs(x) - 0.046, y + 0.0, z - 0.066, 0.038);
    z += cheek * 0.014 * face;
    x += Math.sign(x || 1) * cheek * 0.006;

    const buccal = smoothBump(Math.abs(x) - 0.038, y + 0.03, z - 0.072, 0.03);
    z -= buccal * 0.009 * face;

    for (const sx of [-0.03, 0.03]) {
      const d = Math.hypot(x - sx, (y - 0.016) * 1.3, (z - 0.082) * 0.85);
      if (d < 0.024) {
        const k = (1 - d / 0.024) ** 2;
        z -= k * 0.014 * face;
        y -= k * 0.002;
        x += Math.sign(sx) * k * 0.002;
      }
    }

    // Nose is sculpted into the same facial surface. This replaces the old
    // pasted sphere with a bridge, tip, and alar transition that remain
    // continuous with the brow and cheek topology.
    const bridge = smoothBump(x * 3.0, (y - 0.006) * 1.05, z - 0.088, 0.04);
    z += bridge * 0.027 * face * (1 - Math.min(1, Math.abs(x) * 26));
    y += bridge * 0.002 * face;

    const nasalTip = smoothBump(x * 2.3, y + 0.018, z - 0.1, 0.023);
    z += nasalTip * 0.014 * face;
    y -= nasalTip * 0.0015 * face;

    const noseWing = smoothBump(Math.abs(x) - 0.012, y + 0.018, z - 0.094, 0.02);
    z += noseWing * 0.008 * face;
    x += Math.sign(x || 1) * noseWing * 0.003;

    const mouthHollow = smoothBump(x * 1.6, y + 0.052, z - 0.088, 0.032);
    z -= mouthHollow * 0.01 * face;
    for (const sx of [-0.018, 0.018]) {
      const d = Math.hypot(x - sx, y + 0.05, z - 0.09);
      if (d < 0.014) z -= (1 - d / 0.014) ** 2 * 0.007 * face;
    }

    const lipUpper = smoothBump(x * 1.55, y + 0.046, z - 0.09, 0.02);
    z += lipUpper * 0.008 * face;
    const lipLower = smoothBump(x * 1.4, y + 0.064, z - 0.088, 0.018);
    z += lipLower * 0.007 * face;

    if (Math.abs(x) < 0.008 && y < 0.006 && y > -0.046 && z > 0.08) {
      z -= (1 - Math.abs(x) / 0.008) * 0.0032 * face;
    }

    pos.setXYZ(i, x, y, z);
  }
  const pos2 = g.attributes.position;
  for (let i = 0; i < pos2.count; i++) {
    const x = pos2.getX(i);
    const y = pos2.getY(i);
    const z = pos2.getZ(i);
    if (z > 0.015) continue;
    const n = Math.sin(x * 14 + 2.4) * Math.cos(y * 11 + 1.1) * Math.sin(z * 9 + 2.4);
    const d = 1 + n * 0.01;
    pos2.setX(i, x * d);
    pos2.setZ(i, z * d);
  }
  g.computeVertexNormals();
  return g;
}

/** Segmented alar: root / bridge / tip / wing. Not a flattened sphere. */
export function noseGeometry() {
  const g = new THREE.SphereGeometry(0.016, 14, 12);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    y = y * 1.32 + 0.004;
    const t = Math.min(1, Math.max(0, (y + 0.022) / 0.04));
    const wing = Math.max(0, 1 - Math.abs(y + 0.014) / 0.012);
    x *= 0.38 + t * 0.2 + wing * 0.5;
    z *= 0.98;
    if (z < 0) z *= 0.22;
    const tip = smoothBump(x * 2.2, y + 0.016, z - 0.02, 0.016);
    z += tip * 0.007;
    x += Math.sign(x || 1) * wing * 0.0028;
    z += wing * 0.0035;
    if (y > 0.01) {
      x *= 0.58;
      z *= 0.78;
    }
    z += 0.003;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function lipGeometry(upper: boolean) {
  const g = new THREE.SphereGeometry(upper ? 0.0125 : 0.012, 16, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    x *= upper ? 1.32 : 1.2;
    y *= upper ? 0.22 : 0.28;
    z *= 0.5;
    if (upper) {
      const bow = Math.max(0, 1 - Math.abs(Math.abs(x) - 0.006) * 55);
      y += bow * 0.0016;
    }
    y -= Math.abs(x) * (upper ? 0.038 : 0.016);
    x *= 1 - Math.min(0.32, Math.abs(x) * 8);
    if (z < 0) z *= 0.14;
    z += 0.0022;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function browGeometry() {
  const g = new THREE.CapsuleGeometry(0.0034, 0.038, 4, 10);
  g.rotateZ(Math.PI / 2);
  g.scale(1.08, 0.48, 0.64);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const peak = Math.exp(-((x - 0.008) ** 2) / 0.00012);
    pos.setY(i, pos.getY(i) + peak * 0.0012);
    if (x > 0.01) {
      const t = Math.min(1, (x - 0.01) / 0.012);
      pos.setY(i, pos.getY(i) * (1 - t * 0.35));
      pos.setZ(i, pos.getZ(i) * (1 - t * 0.25));
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Upper lid covers more of the globe so the eye reads as a slit, not a sticker. */
export function eyelidGeometry(upper: boolean) {
  const phi = upper ? Math.PI * 0.5 : Math.PI * 0.38;
  const g = new THREE.SphereGeometry(0.0102, 12, 6, 0, Math.PI * 2, 0, phi);
  if (!upper) g.rotateZ(Math.PI);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    x *= 1.18;
    y *= upper ? 0.58 : 0.48;
    z *= 0.8;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function lashGeometry() {
  const g = new THREE.TorusGeometry(0.0128, 0.0013, 4, 12, Math.PI * 0.86);
  g.rotateX(0.92);
  g.scale(1.18, 0.42, 0.72);
  g.computeVertexNormals();
  return g;
}

/** Organic ear: helix + concha + lobe, authored pointing +X. */
export function earGeometry() {
  const g = new THREE.SphereGeometry(0.03, 12, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    y *= 1.38;
    z *= 0.62;
    x *= 0.52;
    if (y < -0.012) {
      x *= 0.8;
      y = -0.012 + (y + 0.012) * 1.25;
      z *= 0.82;
    }
    if (y > 0.02) {
      z += 0.006;
      x *= 0.9;
    }
    const concha = Math.hypot(y - 0.002, z - 0.004, x - 0.01);
    if (concha < 0.02) {
      x -= (1 - concha / 0.02) ** 2 * 0.014;
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function palmGeometry() {
  const g = new THREE.SphereGeometry(0.038, 12, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    y *= 1.42;
    x *= 0.98;
    z *= 0.48;
    y -= 0.01;
    if (y < -0.02) x *= 0.82;
    if (z < 0) z *= 0.7;
    if (y > 0.02) {
      x *= 0.9;
      z *= 0.85;
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function skirtHem(h: number, segs = 24) {
  const pts = [
    new THREE.Vector2(0.001, -h - 0.01),
    new THREE.Vector2(0.168, -h - 0.006),
    new THREE.Vector2(0.2, -h + 0.014),
    new THREE.Vector2(0.196, -h * 0.84),
    new THREE.Vector2(0.184, -h * 0.55),
    new THREE.Vector2(0.17, -h * 0.22),
    new THREE.Vector2(0.16, 0.04),
    new THREE.Vector2(0.154, 0.14),
  ];
  const g = latheOutward(pts, segs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const t = Math.min(1, Math.max(0, -y / h));
    const fold =
      1 +
      Math.sin(ang * 7) * 0.05 * t +
      Math.sin(ang * 3.1 + 0.4) * 0.032 * t +
      Math.sin(ang * 11 + 1.2) * 0.014 * t * t;
    const front = Math.max(0, Math.cos(ang));
    const hemDrop = t * t * front * 0.016;
    pos.setX(i, x * fold * 1.06);
    pos.setZ(i, z * fold * 0.94);
    pos.setY(i, y + Math.sin(ang * 7) * 0.012 * t - hemDrop);
  }
  g.computeVertexNormals();
  return g;
}

export function limbLathe(len: number, r0: number, r1: number, r2: number, segs = 14) {
  const pts = [
    new THREE.Vector2(0.001, -len - 0.006),
    new THREE.Vector2(r2 * 0.78, -len - 0.001),
    new THREE.Vector2(r2 * 1.1, -len * 0.985),
    new THREE.Vector2(r2 * 1.22, -len * 0.94),
    new THREE.Vector2(r2 * 1.05, -len * 0.86),
    new THREE.Vector2(r1 * 1.18, -len * 0.68),
    new THREE.Vector2(r1 * 1.12, -len * 0.5),
    new THREE.Vector2(r1 * 1.02, -len * 0.32),
    new THREE.Vector2(r0 * 1.16, -len * 0.14),
    new THREE.Vector2(r0 * 1.32, -len * 0.045),
    new THREE.Vector2(r0 * 0.82, 0.004),
    new THREE.Vector2(0.001, 0.01),
  ];
  const g = latheOutward(pts, segs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, -y / len));
    const muscle = Math.sin(t * Math.PI);
    const distalJoint = Math.max(0, 1 - Math.abs(t - 0.94) / 0.1);
    const proximalJoint = Math.max(0, 1 - Math.abs(t - 0.05) / 0.12);
    const flatten = 0.72 + muscle * 0.2 + distalJoint * 0.22 + proximalJoint * 0.1;
    pos.setX(i, x * (1.04 + muscle * 0.06 + proximalJoint * 0.08));
    pos.setZ(i, z * flatten);
  }
  organic(g, 0.007, len * 10 + r0 * 40);
  g.computeVertexNormals();
  return g;
}

/** Deltoid volume that overlaps torso and upper arm — not a ball joint. */
export function shoulderCap(segs = 14) {
  const g = new THREE.SphereGeometry(0.038, segs, Math.max(8, segs - 2));
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    x *= 1.12;
    y *= 0.38;
    z *= 0.86;
    if (y > 0.006) y *= 0.45;
    if (y < -0.01) {
      const t = Math.min(1, (-0.01 - y) / 0.04);
      x *= 1 - t * 0.4;
      z *= 1 - t * 0.2;
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Upper-arm sleeve that stops above the elbow. Distal radius matches the
 * rolled cuff (~2 mm). Shoulder is a fitted deltoid, not a lantern.
 * Default length 0.30 sits ~2 cm above the 0.32 m UpperArm→ForeArm joint.
 */
export function sleeveLathe(len = 0.3, segs = 16) {
  const pts = [
    new THREE.Vector2(0.001, -len - 0.002),
    new THREE.Vector2(0.024, -len * 0.985),
    new THREE.Vector2(0.025, -len * 0.9),
    new THREE.Vector2(0.027, -len * 0.72),
    new THREE.Vector2(0.029, -len * 0.52),
    new THREE.Vector2(0.032, -len * 0.3),
    new THREE.Vector2(0.036, -len * 0.08),
    new THREE.Vector2(0.028, 0.004),
    new THREE.Vector2(0.001, 0.006),
  ];
  const g = latheOutward(pts, segs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, -y / len));
    const flatten = 0.8 + Math.sin(t * Math.PI) * 0.06;
    pos.setX(i, x);
    pos.setZ(i, z * flatten);
  }
  g.computeVertexNormals();
  return g;
}

/** Overlapping vest front flap (replaces a zipper-like center box). */
export function frontFlap(w = 0.05, h = 0.28) {
  const g = new THREE.BoxGeometry(w, h, 0.008, 2, 6, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setZ(i, z + Math.abs(x) * 0.12 + Math.sin(y * 10) * 0.0015);
  }
  g.computeVertexNormals();
  return g;
}

export function rolledCuff(r: number, h: number, segs = 12) {
  const pts = [
    new THREE.Vector2(r * 0.9, -h * 0.5),
    new THREE.Vector2(r * 1.16, -h * 0.42),
    new THREE.Vector2(r * 1.2, 0),
    new THREE.Vector2(r * 1.14, h * 0.42),
    new THREE.Vector2(r * 0.92, h * 0.5),
  ];
  const g = latheOutward(pts, segs);
  g.computeVertexNormals();
  return g;
}

export function torsoLathe(h: number, segs = 20) {
  const pts = [
    new THREE.Vector2(0.001, -0.04),
    new THREE.Vector2(0.138, -0.038),
    new THREE.Vector2(0.146, 0.02),
    new THREE.Vector2(0.134, h * 0.18),
    new THREE.Vector2(0.142, h * 0.36),
    new THREE.Vector2(0.158, h * 0.52),
    new THREE.Vector2(0.168, h * 0.68),
    new THREE.Vector2(0.152, h * 0.82),
    new THREE.Vector2(0.112, h * 0.93),
    new THREE.Vector2(0.07, h),
    new THREE.Vector2(0.001, h + 0.004),
  ];
  const g = latheOutward(pts, segs);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const flatten = 0.68 + Math.abs(z) * 0.03;
    let nz = z * flatten;
    const pec = Math.max(0, 1 - Math.hypot(Math.abs(x) - 0.052, y - h * 0.66) * 8);
    nz += pec * 0.014;
    const wrinkle = Math.sin(y * 16 + x * 8) * 0.0022 * (y / h);
    nz += wrinkle;
    pos.setZ(i, nz);
    const shade = 0.94 + pec * 0.05 + (y / h) * 0.03;
    col[i * 3] = shade;
    col[i * 3 + 1] = shade;
    col[i * 3 + 2] = shade * 0.98;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  organic(g, 0.01, 4.2);
  g.computeVertexNormals();
  return g;
}

/**
 * Fitted leather vest as a closed shell. Front opening is overlapping flaps
 * in build.ts, not a lathe gap — gap-edge triangles were reading as white
 * side spikes once DoubleSide + skinning pulled the cut.
 */
export function vestLathe(h: number, segs = 32) {
  const pts = [
    new THREE.Vector2(0.158, -0.06),
    new THREE.Vector2(0.17, -0.042),
    new THREE.Vector2(0.168, -0.012),
    new THREE.Vector2(0.164, 0.04),
    new THREE.Vector2(0.17, h * 0.3),
    new THREE.Vector2(0.178, h * 0.5),
    new THREE.Vector2(0.17, h * 0.72),
    new THREE.Vector2(0.148, h * 0.9),
    new THREE.Vector2(0.12, h + 0.006),
  ];
  // Keep the shell closed: a lathe cut was the source of the side-facing
  // triangles reported in motion. The overlapping plackets supply the opening.
  // Place the closed-shell seam on the back. A zero-width seam at +Z still
  // left a ray-visible front crack even though no intentional opening existed.
  const g = latheOutward(pts, segs, Math.PI, Math.PI * 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const ang = Math.atan2(x, z);
    const r = Math.hypot(x, z) || 1;
    const seam = Math.abs(ang);
    if (z > 0.02 && seam < 0.2) {
      const k = 1 - seam / 0.2;
      z -= k * 0.008;
      x *= 1 - k * 0.05;
    }
    if (z > 0.04 && Math.abs(ang) < 0.22 && y > h * 0.62) {
      const t = (y - h * 0.62) / (h * 0.38);
      x += Math.sign(x || 1) * t * 0.005;
      z -= t * 0.004;
    }
    const side = Math.pow(Math.abs(Math.sin(ang)), 1.1);
    if (y > h * 0.1) {
      const t = (y - h * 0.1) / (h * 0.9);
      const scoop = side * (0.004 + t * t * 0.018);
      const nr = Math.max(0.13, r - scoop);
      x *= nr / r;
      z *= nr / r;
    }
    const pec = Math.max(0, 1 - Math.hypot(Math.abs(x) - 0.055, y - h * 0.44) * 7);
    z += pec * 0.005;
    const front = Math.max(0, z / r);
    const backB = Math.max(0, -z / r);
    if (y < h * 0.15) y += front * 0.006 - backB * 0.003;
    const wrinkle = Math.sin(y * 22 + x * 9) * 0.0014 + Math.sin(x * 15) * 0.0008;
    pos.setXYZ(i, x * 1.01, y, z * 0.94 + wrinkle);
  }
  g.computeVertexNormals();
  return g;
}

/** Leather binding around the armhole — a rim, not a hole. Locked to Chest in build. */
export function vestArmholeRim(segs = 16) {
  const g = new THREE.TorusGeometry(0.045, 0.0065, 6, segs, Math.PI * 0.94);
  g.rotateY(Math.PI / 2);
  g.rotateZ(0.34);
  g.computeVertexNormals();
  return g;
}

export function vestHemBand(segs = 20) {
  const g = new THREE.TorusGeometry(0.182, 0.017, 6, segs);
  g.rotateX(Math.PI / 2);
  g.scale(1.06, 0.62, 0.9);
  g.computeVertexNormals();
  return g;
}

/** Closed tunic volume that covers the waist seam between vest, belly, and skirt. */
export function waistLathe(h: number, segs = 16) {
  const pts = [
    new THREE.Vector2(0.001, -0.04),
    new THREE.Vector2(0.15, -0.038),
    new THREE.Vector2(0.172, 0.02),
    new THREE.Vector2(0.176, h * 0.4),
    new THREE.Vector2(0.166, h * 0.75),
    new THREE.Vector2(0.142, h),
    new THREE.Vector2(0.001, h + 0.004),
  ];
  const g = latheOutward(pts, segs);
  g.scale(1.12, 1, 0.94);
  organic(g, 0.01, 5.1);
  g.computeVertexNormals();
  return g;
}

/**
 * Short layered scalp. Hairline sits near the brow plane on +Z so the
 * forehead is a thin adult band, not a receded bald dome. Mid-face rays
 * from y=1.62 still hit skin first.
 */
export function scalpGeometry(segs = 24) {
  const g = new THREE.SphereGeometry(0.12, Math.max(16, segs), Math.max(12, segs - 2));
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    x *= 0.95;
    y = y * 0.94 + 0.026;
    z *= 0.94;

    const r = Math.hypot(x, z) || 1;
    const nz = z / r;
    const face = Math.max(0, nz);
    const back = Math.max(0, -nz);
    let hairlineY = 0.09 * face - 0.055 * back + 0.018 * (1 - Math.abs(nz));
    hairlineY += face * 0.005 * Math.exp(-(x * x) / 0.0004);
    const templeDrop = Math.min(1, Math.abs(x) / 0.07) * 0.022;
    const sideburn = Math.min(1, Math.abs(x) / 0.06) * face * 0.01;
    const cut = hairlineY - templeDrop - sideburn;

    if (y < cut) {
      const t = Math.min(1, (cut - y) / 0.05);
      // Keep only a narrow, recessed lower edge; a full lower hemisphere
      // produces a smooth plastic helmet around the jaw.
      const s = 1 - t * 0.52;
      x *= s;
      z *= s;
      y = cut - t * 0.012;
      if (nz > 0.2) z *= 1 - t * 0.05;
    } else if (y < cut + 0.02 && nz > 0.15) {
      const t = 1 - (y - cut) / 0.02;
      z += t * 0.004 * face;
      y += t * 0.002;
    }

    if (y > 0.07) {
      const crown = Math.min(1, (y - 0.07) / 0.05);
      y += crown * 0.006;
    }
    if (z < 0) {
      z *= 1.06;
      y -= 0.012 * Math.min(1, -z / 0.1);
    }
    x *= 1.02;
    pos.setXYZ(i, x, y, z);
  }
  organic(g, 0.012, 3.1);
  g.computeVertexNormals();
  return g;
}

export function ponytailGeometry() {
  const pts = [
    new THREE.Vector2(0.001, 0.004),
    new THREE.Vector2(0.022, -0.004),
    new THREE.Vector2(0.028, -0.02),
    new THREE.Vector2(0.032, -0.05),
    new THREE.Vector2(0.028, -0.09),
    new THREE.Vector2(0.022, -0.14),
    new THREE.Vector2(0.016, -0.18),
    new THREE.Vector2(0.008, -0.21),
    new THREE.Vector2(0.001, -0.225),
  ];
  const g = latheOutward(pts, 12);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.min(1, Math.max(0, -y / 0.22));
    const wave = Math.sin(t * 6.5) * 0.01 * t;
    const wave2 = Math.sin(t * 3.2 + 1.1) * 0.006 * t;
    pos.setZ(i, pos.getZ(i) + wave + wave2 * 0.5);
    pos.setX(i, pos.getX(i) * (1 + Math.sin(t * 5) * 0.08 * t));
    if (t > 0.7) pos.setY(i, y - (t - 0.7) * 0.01);
  }
  g.computeVertexNormals();
  return g;
}

export function pelvisLathe(h: number, segs = 16) {
  const pts = [
    new THREE.Vector2(0.001, -h * 0.5),
    new THREE.Vector2(0.122, -h * 0.48),
    new THREE.Vector2(0.162, -h * 0.22),
    new THREE.Vector2(0.17, h * 0.12),
    new THREE.Vector2(0.15, h * 0.46),
    new THREE.Vector2(0.001, h * 0.5),
  ];
  const g = latheOutward(pts, segs);
  g.scale(1.04, 1, 0.8);
  organic(g, 0.012, 8);
  g.computeVertexNormals();
  return g;
}

export function hairCard(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h, 2, 8);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + h * 0.5) / h;
    const wave = Math.sin(t * 9 + w * 20) * 0.007 * (1 - t);
    pos.setX(i, pos.getX(i) * (0.18 + 0.82 * t) + wave);
    pos.setZ(i, Math.sin((1 - t) * Math.PI) * 0.014 + Math.sin(t * 7) * 0.004);
  }
  g.translate(0, -h * 0.5, 0);
  g.computeVertexNormals();
  return g;
}

export function clothPanel(w: number, h: number, segsW = 6, segsH = 8) {
  const g = new THREE.PlaneGeometry(w, h, segsW, segsH);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const folds = Math.sin(x * 26) * 0.016 + Math.sin((y + x) * 12) * 0.012 + Math.sin(y * 8) * 0.01;
    pos.setZ(i, folds + Math.abs(x) * 0.1);
    pos.setY(i, y - Math.abs(x) * 0.05 - Math.max(0, -y) * 0.04);
  }
  g.translate(0, -h * 0.42, 0);
  g.computeVertexNormals();
  return g;
}

export function sailGeometry(span: number, chord: number) {
  const g = new THREE.PlaneGeometry(span, chord, 10, 7);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nx = x / (span * 0.5);
    const ny = y / (chord * 0.5);
    const sag = (1 - nx * nx) * 0.16;
    pos.setZ(i, sag + ny * 0.04);
    pos.setY(i, y - (1 - nx * nx) * 0.08);
  }
  g.computeVertexNormals();
  return g;
}

export function bladeGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.016, 0.02);
  shape.lineTo(0.014, 0.58);
  shape.lineTo(0, 0.7);
  shape.lineTo(-0.014, 0.58);
  shape.lineTo(-0.016, 0.02);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.007,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 1,
  });
  g.translate(0, 0, -0.0035);
  g.computeVertexNormals();
  return g;
}

export function fingerSeg(len: number, r0: number, r1: number, segs = 6) {
  const g = new THREE.CapsuleGeometry((r0 + r1) * 0.5, Math.max(0.004, len - (r0 + r1) * 0.5), 3, segs);
  g.translate(0, -len * 0.5, 0);
  return g;
}

export function bootShaft(h: number, segs = 12) {
  const pts = [
    new THREE.Vector2(0.001, -0.024),
    new THREE.Vector2(0.05, -0.02),
    new THREE.Vector2(0.056, 0.008),
    new THREE.Vector2(0.052, h * 0.38),
    new THREE.Vector2(0.056, h * 0.72),
    new THREE.Vector2(0.064, h * 0.96),
    new THREE.Vector2(0.052, h + 0.014),
    new THREE.Vector2(0.001, h + 0.016),
  ];
  const g = latheOutward(pts, segs);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * 1.08;
    const y = pos.getY(i);
    let z = pos.getZ(i) * 1.16;
    if (y < h * 0.28) {
      const t = 1 - Math.max(0, y) / (h * 0.28);
      z += t * 0.042;
      x *= 1 + t * 0.1;
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function bootSole(len: number, w: number, h: number) {
  const g = new THREE.SphereGeometry(0.05, 12, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * (w / 0.1);
    let y = pos.getY(i) * (h / 0.1);
    let z = pos.getZ(i) * (len / 0.1);
    if (y < 0) y *= 0.16;
    if (z > 0) {
      x *= 0.76;
      y += 0.005;
      z *= 1.12;
    } else {
      y -= 0.004;
      x *= 1.12;
      z *= 0.95;
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function shoeVamp(segs = 12) {
  const g = new THREE.SphereGeometry(0.056, segs, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    z = z * 1.45 + 0.012;
    x *= 0.78 + Math.max(0, -z) * 0.14;
    y *= 0.5;
    if (y < 0) y *= 0.18;
    if (z > 0.02) {
      y += 0.01;
      x *= 0.82;
    } else {
      y += 0.016;
      z *= 0.88;
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function bagBody(w: number, h: number, d: number) {
  const g = new THREE.SphereGeometry(0.5, 12, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * w;
    let y = pos.getY(i) * h;
    let z = pos.getZ(i) * d;
    if (y < -h * 0.2) y = -h * 0.2 + (y + h * 0.2) * 0.35;
    if (y > h * 0.15) {
      x *= 0.92;
      z *= 0.9;
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function collarLathe(segs = 14) {
  const pts = [
    new THREE.Vector2(0.05, 0),
    new THREE.Vector2(0.062, 0.006),
    new THREE.Vector2(0.07, 0.024),
    new THREE.Vector2(0.06, 0.04),
    new THREE.Vector2(0.048, 0.038),
  ];
  const g = latheOutward(pts, segs);
  g.scale(1.05, 1, 0.92);
  g.computeVertexNormals();
  return g;
}
