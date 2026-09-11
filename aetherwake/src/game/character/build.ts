import * as THREE from "three";
import {
  bagBody,
  bladeGeometry,
  bootShaft,
  bootSole,
  browGeometry,
  collarLathe,
  craniumGeometry,
  earGeometry,
  eyelidGeometry,
  fingerSeg,
  hairCard,
  lashGeometry,
  limbLathe,
  mesh,
  palmGeometry,
  pelvisLathe,
  ponytailGeometry,
  rolledCuff,
  sailGeometry,
  scalpGeometry,
  shoeVamp,
  skirtHem,
  sleeveLathe,
  torsoLathe,
  vestLathe,
  waistLathe,
} from "./geometry.ts";
import { createWandererMaterials, type WandererMats } from "./materials.ts";
import { buildSkinnedParts, buildSkinRig, type PartSpec, type SkinRig } from "./skinning.ts";
import type { LimbSet, LodLevel, RestEuler } from "./types.ts";

function bone(name: string, x: number, y: number, z: number) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  return b;
}

function markRest(b: THREE.Bone, x = 0, y = 0, z = 0) {
  b.rotation.set(x, y, z);
  const rest: RestEuler = { x, y, z, px: b.position.x, py: b.position.y, pz: b.position.z };
  b.userData.rest = rest;
}

function sph(r: number, segs: number) {
  return new THREE.SphereGeometry(r, segs, Math.max(6, segs - 2));
}

type PartSink = {
  parts: PartSpec[];
  add: (
    bone: THREE.Bone,
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
    local?: {
      position?: [number, number, number];
      rotation?: [number, number, number];
      scale?: [number, number, number];
      lockBone?: THREE.Bone;
      weightBones?: readonly string[];
      weightPower?: number;
      maxBones?: number;
      visible?: boolean;
    },
  ) => void;
};

function makeSink(): PartSink {
  const parts: PartSpec[] = [];
  return {
    parts,
    add(bone, geo, material, name, local) {
      parts.push({
        bone,
        geo,
        material,
        name,
        position: local?.position,
        rotation: local?.rotation,
        scale: local?.scale,
        lockBone: local?.lockBone,
        weightBones: local?.weightBones,
        weightPower: local?.weightPower,
        maxBones: local?.maxBones,
        visible: local?.visible,
      });
    },
  };
}

const TORSO_BONES = ["Hips", "Spine", "Chest", "Neck"] as const;
const VEST_BONES = ["Spine", "Chest", "Neck"] as const;
const SKIRT_BONES = ["Hips", "Spine", "L_UpLeg", "R_UpLeg", "L_Leg", "R_Leg"] as const;

type FingerChain = THREE.Bone[];

function addFingers(
  hand: THREE.Bone,
  side: 1 | -1,
  mats: WandererMats,
  segs: number,
): FingerChain[] {
  const chains: FingerChain[] = [];
  const layout: { name: string; x: number; z: number; len: number; thick: number; segs: number; yaw: number }[] = [
    { name: "Thumb", x: side * 0.028, z: 0.018, len: 0.058, thick: 0.011, segs: 2, yaw: side * 0.7 },
    { name: "Index", x: side * 0.018, z: 0.012, len: 0.072, thick: 0.008, segs: 3, yaw: side * 0.08 },
    { name: "Middle", x: side * 0.004, z: 0.014, len: 0.078, thick: 0.0085, segs: 3, yaw: 0 },
    { name: "Ring", x: side * -0.01, z: 0.01, len: 0.07, thick: 0.0075, segs: 3, yaw: side * -0.06 },
    { name: "Pinky", x: side * -0.022, z: 0.004, len: 0.058, thick: 0.0065, segs: 3, yaw: side * -0.14 },
  ];
  const prefix = side < 0 ? "L_" : "R_";
  for (const f of layout) {
    const chain: FingerChain = [];
    let parent = hand;
    let prevLen = 0;
    for (let i = 0; i < f.segs; i++) {
      const frac = f.segs === 2 ? (i === 0 ? 0.52 : 0.48) : i === 0 ? 0.42 : i === 1 ? 0.33 : 0.25;
      const len = f.len * frac;
      const b = bone(`${prefix}${f.name}${i + 1}`, 0, 0, 0);
      if (i === 0) {
        b.position.set(f.x, -0.018, f.z);
        b.rotation.set(0.18, f.yaw, side * (f.name === "Thumb" ? 0.55 : 0.04));
      } else {
        b.position.set(0, -prevLen, 0);
        b.rotation.set(0.16 + i * 0.06, 0, 0);
      }
      markRest(b, b.rotation.x, b.rotation.y, b.rotation.z);
      parent.add(b);
      const r0 = f.thick * (1 - i * 0.18);
      const r1 = f.thick * (0.78 - i * 0.16);
      b.add(mesh(fingerSeg(len, r0, r1, segs), mats.skin));
      chain.push(b);
      parent = b;
      prevLen = len;
    }
    chains.push(chain);
  }
  return chains;
}

function buildHead(head: THREE.Bone, mats: WandererMats, lod: LodLevel) {
  // Head stays a rigid unit: face features stay registered on the cranium.
  // Neck blending is handled by the skinned NeckMesh.
  const hs = lod === 0 ? 28 : 12;
  const skull = mesh(craniumGeometry(hs), mats.skin);
  skull.name = "Cranium";
  skull.position.set(0, 0.002, 0.004);
  head.add(skull);

  const browL = mesh(browGeometry(), mats.brow);
  browL.name = "BrowL";
  browL.position.set(-0.03, 0.028, 0.09);
  browL.rotation.set(0.18, -0.22, 0.14);
  browL.scale.set(0.95, 0.9, 0.85);
  const browR = mesh(browGeometry(), mats.brow);
  browR.name = "BrowR";
  browR.position.set(0.03, 0.028, 0.09);
  browR.rotation.set(0.18, 0.22, -0.14);
  browR.scale.set(-0.95, 0.9, 0.85);
  head.add(browL, browR);

  // Nose, philtrum, mouth groove and lips are all sculpted in Cranium. Eyes
  // remain separate optical geometry, but no facial-feature discs are glued
  // onto the skin surface.

  const earL = mesh(earGeometry(), mats.skin);
  earL.name = "EarL";
  earL.position.set(-0.077, 0.002, 0.002);
  earL.rotation.set(0.08, -0.16, 0.08);
  earL.scale.set(0.82, 0.84, 0.84);
  const earR = mesh(earGeometry(), mats.skin);
  earR.name = "EarR";
  earR.position.set(0.077, 0.002, 0.002);
  earR.rotation.set(0.08, 0.16, -0.08);
  earR.scale.set(-0.82, 0.84, 0.84);
  head.add(earL, earR);

  const eye = (sx: number) => {
    const g = new THREE.Group();
    g.name = sx < 0 ? "EyeL" : "EyeR";
    const white = mesh(sph(0.0078, 16), mats.eyeWhite);
    white.name = "Sclera";
    white.scale.set(1.0, 0.52, 0.8);
    const irisDisk = mesh(new THREE.CircleGeometry(0.0048, 24), mats.iris);
    irisDisk.name = "Iris";
    irisDisk.position.z = 0.0068;
    const pupil = mesh(new THREE.CircleGeometry(0.0017, 14), mats.pupil);
    pupil.name = "Pupil";
    pupil.position.z = 0.0072;
    const hi = mesh(sph(0.0006, 6), mats.highlight);
    hi.position.set(sx * -0.001, 0.0009, 0.0076);
    const lidU = mesh(eyelidGeometry(true), mats.skin);
    lidU.position.set(0, 0.0052, 0.0004);
    const lidLo = mesh(eyelidGeometry(false), mats.skin);
    lidLo.position.set(0, -0.0046, 0.0004);
    const lash = mesh(lashGeometry(), mats.brow);
    lash.position.set(0, 0.0056, 0.002);
    lash.scale.set(0.78, 0.7, 0.7);
    g.add(white, irisDisk, pupil, hi, lidU, lidLo, lash);
    g.position.set(sx * 0.026, 0.016, 0.094);
    g.rotation.set(0.04, sx * 0.08, sx * 0.04);
    g.scale.set(0.86, 0.76, 0.88);
    return g;
  };
  head.add(eye(-1), eye(1));

  const scalp = mesh(scalpGeometry(hs), mats.hair);
  scalp.name = "Scalp";
  scalp.position.set(0, 0.014, -0.006);
  scalp.scale.set(0.8, 0.96, 0.9);
  head.add(scalp);

  const crown = mesh(sph(0.05, hs), mats.hair);
  crown.name = "HairCrown";
  crown.position.set(0, 0.07, -0.018);
  crown.scale.set(0.76, 0.2, 0.76);
  head.add(crown);

  const nape = mesh(new THREE.SphereGeometry(0.05, 10, 8), mats.hair);
  nape.name = "HairNape";
  nape.position.set(0, -0.02, -0.088);
  nape.scale.set(1.05, 0.7, 0.72);
  head.add(nape);

  const tail = mesh(ponytailGeometry(), mats.hair);
  tail.name = "HairTail";
  tail.position.set(0.008, 0.01, -0.095);
  tail.rotation.set(0.62, 0.1, 0.05);
  head.add(tail);

  // The reference uses tied hair, not a helmet cap: a compact bun anchors the
  // tail at the nape and gives the profile/back a deliberate silhouette.
  const bun = mesh(sph(0.031, 12), mats.hair);
  bun.name = "HairBun";
  bun.position.set(0, 0.028, -0.105);
  bun.scale.set(1.12, 0.8, 0.72);
  head.add(bun);

  const sideL = mesh(sph(0.038, 8), mats.hair);
  sideL.name = "HairSideL";
  sideL.position.set(-0.067, 0.026, -0.032);
  sideL.scale.set(0.3, 0.62, 0.52);
  const sideR = sideL.clone();
  sideR.name = "HairSideR";
  sideR.position.set(0.067, 0.026, -0.034);
  sideR.scale.set(0.3, 0.62, 0.52);
  head.add(sideL, sideR);

  if (lod === 0) {
    const cardA = hairCard(0.032, 0.055);
    const cardB = hairCard(0.022, 0.042);
    const places: [number, number, number, number, number, number, boolean][] = [
      [-0.018, 0.1, 0.012, -1.05, 0.16, 0.08, true],
      [0.02, 0.098, 0.01, -1.02, -0.18, -0.06, true],
      [0.0, 0.108, -0.006, -1.12, 0.02, 0, false],
      [-0.048, 0.086, -0.02, -0.62, 0.65, 0.1, false],
      [0.048, 0.084, -0.02, -0.6, -0.68, -0.08, false],
      [-0.07, 0.048, -0.042, -0.08, 1.28, 0.14, true],
      [0.07, 0.046, -0.042, -0.06, -1.3, -0.12, true],
      [-0.046, 0.078, -0.062, 0.16, 2.0, 0.05, false],
      [0.044, 0.076, -0.06, 0.14, -2.05, -0.04, false],
      [0.004, 0.09, -0.08, 0.32, 0.04, 0, true],
      [-0.012, 0.082, -0.084, 0.34, 0.22, 0.04, false],
      [-0.056, 0.004, -0.066, 0.38, 1.42, 0.1, false],
      [0.056, 0.002, -0.064, 0.36, -1.4, -0.08, false],
      [0.01, -0.04, -0.12, 0.7, 0.08, 0.04, false],
      [-0.01, -0.08, -0.13, 0.78, -0.06, 0, true],
      [0.006, -0.12, -0.125, 0.85, 0.05, 0.03, false],
    ];
    for (const [x, y, z, rx, ry, rz, wide] of places) {
      const c = mesh(wide ? cardA : cardB, mats.hairCard);
      c.name = "HairCard";
      c.position.set(x, y, z);
      c.rotation.set(rx, ry, rz);
      head.add(c);
    }
  }
}

function buildTorso(
  hips: THREE.Bone,
  spine: THREE.Bone,
  chest: THREE.Bone,
  neck: THREE.Bone,
  sink: PartSink,
  mats: WandererMats,
  lod: LodLevel,
) {
  const segs = lod === 0 ? 20 : 10;
  const A = sink.add;
  // Pelvis sits under the tunic skirt (linen, not black shorts).
  A(hips, pelvisLathe(0.2, segs), mats.tunicSolid, "Pelvis", { position: [0, 0.03, 0], weightBones: SKIRT_BONES });
  A(hips, waistLathe(0.3, segs), mats.tunicSolid, "WaistFill", {
    position: [0, 0.05, 0],
    scale: [0.88, 1, 0.9],
    weightBones: TORSO_BONES,
    weightPower: 3.6,
    maxBones: 2,
  });
  // Hip-length linen overshirt: the reference exposes fitted trousers rather
  // than reading as a knee-length skirt.
  A(hips, skirtHem(0.22, segs), mats.tunicSolid, "SkirtHem", {
    position: [0, 0.105, 0],
    scale: [0.84, 0.96, 0.86],
    weightBones: SKIRT_BONES,
  });
  A(
    hips,
    new THREE.TorusGeometry(0.162, 0.011, 5, segs),
    mats.leather,
    "Belt",
    { position: [0, 0.08, 0], rotation: [Math.PI / 2, 0, 0], scale: [1.04, 0.55, 0.86] },
  );
  A(hips, new THREE.BoxGeometry(0.032, 0.02, 0.01), mats.steelDark, "Buckle", { position: [0, 0.08, 0.152] });

  A(spine, limbLathe(0.34, 0.118, 0.112, 0.108, segs), mats.tunicSolid, "Belly", {
    position: [0, 0.18, 0],
    scale: [0.9, 1, 0.86],
    weightBones: TORSO_BONES,
    weightPower: 3.6,
    maxBones: 2,
  });
  A(chest, torsoLathe(0.56, segs), mats.tunic, "Torso", {
    position: [0, -0.3, 0],
    scale: [0.98, 1, 0.92],
    weightBones: TORSO_BONES,
  });
  // One continuous outer shell. The previous lining, two overlapping front
  // slabs, and torus hem intersected one another and made visible waist holes.
  A(chest, vestLathe(0.42, Math.max(segs, 28)), mats.vest, "Vest", {
    position: [0, -0.2, 0],
    scale: [0.9, 1.0, 0.92],
    weightBones: VEST_BONES,
    weightPower: 4.2,
    maxBones: 2,
  });
  A(chest, new THREE.BoxGeometry(0.012, 0.022, 0.006), mats.steelDark, "VestClasp", {
    position: [0, 0.055, 0.171],
    lockBone: chest,
  });
  A(chest, collarLathe(12), mats.sleeve, "Collar", { position: [0, 0.24, 0.008] });
  A(chest, new THREE.CylinderGeometry(0.05, 0.07, 0.08, 12), mats.sleeve, "Shirt", { position: [0, 0.22, 0.008] });

  A(neck, limbLathe(0.18, 0.042, 0.038, 0.034, 12), mats.skin, "NeckMesh", { position: [0, 0.1, 0] });
  A(neck, sph(0.01, 6), mats.skinWarm, "Adam", { position: [0, 0.048, 0.036], scale: [0.75, 0.65, 0.55] });

  // Satchel/strap/pouch: stiff leather goods ride rigid on the Hips bone.
  const satchel = new THREE.Group();
  satchel.name = "Satchel";
  const bag = mesh(bagBody(0.13, 0.15, 0.07), mats.leather);
  const flap = mesh(bagBody(0.12, 0.07, 0.03), mats.leather);
  flap.position.set(0, 0.04, 0.038);
  flap.rotation.x = -0.45;
  flap.scale.set(1, 0.7, 0.55);
  const bagBuckle = mesh(sph(0.012, 6), mats.steelDark);
  bagBuckle.position.set(0, 0.02, 0.055);
  bagBuckle.scale.set(1.3, 0.7, 0.6);
  satchel.add(bag, flap, bagBuckle);
  satchel.position.set(-0.17, 0.04, 0.04);
  satchel.rotation.z = 0.22;
  hips.add(satchel);

  // A fitted cross-body strap replaces the oversized torus that read as a
  // handle looping around the head in front and side views.
  const strapPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.145, 0.48, 0.165),
    new THREE.Vector3(-0.08, 0.4, 0.19),
    new THREE.Vector3(0.005, 0.31, 0.2),
    new THREE.Vector3(0.09, 0.2, 0.19),
    new THREE.Vector3(0.145, 0.08, 0.165),
  ]);
  const strap = mesh(new THREE.TubeGeometry(strapPath, 20, 0.009, 6, false), mats.strap);
  strap.name = "SatchelStrap";
  hips.add(strap);

  const pouch = mesh(bagBody(0.055, 0.07, 0.04), mats.leather);
  pouch.position.set(0.15, 0.02, 0.05);
  hips.add(pouch);
}

function buildArms(
  lArm: THREE.Bone,
  rArm: THREE.Bone,
  lFore: THREE.Bone,
  rFore: THREE.Bone,
  lHand: THREE.Bone,
  rHand: THREE.Bone,
  sink: PartSink,
  mats: WandererMats,
  lod: LodLevel,
) {
  const segs = lod === 0 ? 14 : 8;
  const A = sink.add;
  const sleeves: [THREE.Bone, THREE.Bone, string, 1 | -1][] = [
    [lArm, lFore, "SleeveL", -1],
    [rArm, rFore, "SleeveR", 1],
  ];
  for (const [arm, fore, name, side] of sleeves) {
    const clav = side < 0 ? "L_Clavicle" : "R_Clavicle";
    const upper = side < 0 ? "L_UpperArm" : "R_UpperArm";
    const lower = side < 0 ? "L_ForeArm" : "R_ForeArm";
    // Deliberately overlaps both torso and forearm. A short upper-arm-only
    // tube was numerically skinned but visibly detached at shoulder and elbow.
    A(arm, sleeveLathe(0.346, segs), mats.sleeve, name, {
      position: [side * -0.022, 0.025, 0.006],
      weightBones: [clav, upper, lower],
      weightPower: 4.1,
      maxBones: 3,
    });
    // A second overlapping sleeve section reaches the wrist. This replaces
    // exposed segmented forearms with the reference's continuous green linen.
    A(fore, limbLathe(0.286, 0.04, 0.036, 0.029, segs), mats.sleeve, `${name}Fore`, {
      position: [0, 0.006, 0.002],
      weightBones: [upper, lower, side < 0 ? "L_Hand" : "R_Hand"],
      weightPower: 4.1,
      maxBones: 3,
    });
    A(fore, limbLathe(0.28, 0.042, 0.038, 0.03, segs), mats.skin, name.replace("Sleeve", "Fore"), {
      weightBones: [upper, lower, side < 0 ? "L_Hand" : "R_Hand"],
      visible: false,
    });
    A(fore, limbLathe(0.1, 0.042, 0.04, 0.036, segs), mats.leather, name.replace("Sleeve", "Brace"), {
      position: [0, -0.1, 0],
    });
  }

  const hands: [THREE.Bone, string][] = [
    [lHand, "L"],
    [rHand, "R"],
  ];
  for (const [hand, side] of hands) {
    A(hand, palmGeometry(), mats.skin, `Palm${side}`, { position: [0, -0.036, 0.004] });
    if (lod === 0) {
      for (let k = 0; k < 4; k++) {
        const kn = mesh(sph(0.007, 6), mats.skinWarm);
        kn.position.set(-0.022 + k * 0.014, -0.062, 0.014);
        hand.add(kn);
      }
    }
  }

  if (lod === 0) {
    const fingersL = addFingers(lHand, -1, mats, 6);
    const fingersR = addFingers(rHand, 1, mats, 6);
    lHand.userData.fingers = fingersL;
    rHand.userData.fingers = fingersR;
  } else {
    for (const [hand, side] of hands) {
      const mit = mesh(sph(0.04, 8), mats.skin);
      mit.position.set(0, -0.08, 0.01);
      mit.scale.set(1.1, 0.7, 0.7);
      mit.name = `Mitten${side}`;
      hand.add(mit);
    }
  }
}

function buildLegs(
  lUp: THREE.Bone,
  rUp: THREE.Bone,
  lLeg: THREE.Bone,
  rLeg: THREE.Bone,
  lFoot: THREE.Bone,
  rFoot: THREE.Bone,
  sink: PartSink,
  mats: WandererMats,
  lod: LodLevel,
) {
  const segs = lod === 0 ? 14 : 8;
  const A = sink.add;
  const legs: [THREE.Bone, THREE.Bone, string][] = [
    [lUp, lLeg, "L"],
    [rUp, rLeg, "R"],
  ];
  for (const [up, leg, side] of legs) {
    const upName = side === "L" ? "L_UpLeg" : "R_UpLeg";
    const legName = side === "L" ? "L_Leg" : "R_Leg";
    const footName = side === "L" ? "L_Foot" : "R_Foot";
    // Keep split meshes only for skinning regressions; a single visible
    // trouser prevents two overlapping bulbs from segmenting the knee.
    A(up, limbLathe(0.44, 0.088, 0.072, 0.056, segs), mats.skin, `Thigh${side}`, {
      weightBones: ["Hips", upName, legName],
      visible: false,
    });
    A(leg, limbLathe(0.42, 0.054, 0.05, 0.04, segs), mats.skin, `Shin${side}`, {
      weightBones: [upName, legName, footName],
      visible: false,
    });
    A(up, limbLathe(0.86, 0.078, 0.064, 0.044, Math.max(segs, 16)), mats.pants, `Trouser${side}`, {
      weightBones: ["Hips", upName, legName, footName],
      weightPower: 3.8,
      maxBones: 3,
    });
    const foot = side === "L" ? lFoot : rFoot;
    const lock = { lockBone: foot };
    A(foot, bootShaft(0.22, segs), mats.boot, `Boot${side}`, { position: [0, -0.07, 0.008], ...lock });
    A(foot, shoeVamp(segs), mats.boot, `Vamp${side}`, { position: [0, -0.078, 0.036], ...lock });
    A(foot, bootSole(0.19, 0.08, 0.018), mats.sole, `Sole${side}`, { position: [0, -0.098, 0.042], ...lock });
    A(foot, sph(0.028, 8), mats.sole, `Heel${side}`, {
      position: [0, -0.094, -0.018],
      scale: [1.12, 0.5, 0.9],
      ...lock,
    });
    if (lod === 0) {
      A(foot, rolledCuff(0.054, 0.022, 10), mats.leather, `BootCuff${side}`, { position: [0, 0.12, 0.006], ...lock });
      for (let i = 0; i < 3; i++) {
        A(foot, new THREE.CylinderGeometry(0.0024, 0.0024, 0.024, 5), mats.cord, `Lace${side}${i}`, {
          position: [0, -0.058 + i * 0.012, 0.1],
          rotation: [0, 0, Math.PI / 2],
          ...lock,
        });
      }
    }
  }
}

function buildSword(mats: WandererMats) {
  const sword = new THREE.Group();
  sword.name = "Sword";
  const blade = mesh(bladeGeometry(), mats.steel);
  const guard = mesh(new THREE.BoxGeometry(0.12, 0.018, 0.03), mats.steelDark);
  guard.position.y = 0.01;
  const grip = mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.1, 8), mats.leather);
  grip.position.y = -0.05;
  const wrap = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.08, 8), mats.strap);
  wrap.position.y = -0.05;
  const pommel = mesh(sph(0.018, 8), mats.steelDark);
  pommel.position.y = -0.11;
  sword.add(blade, guard, grip, wrap, pommel);
  return sword;
}

function buildGlider(mats: WandererMats, lod: LodLevel) {
  const glider = new THREE.Group();
  glider.name = "Glider";
  const sail = mesh(sailGeometry(1.55, 0.85), mats.fabric);
  sail.position.set(0, 0.12, -0.02);
  const trim = mesh(sailGeometry(1.58, 0.88), mats.sailTrim);
  trim.position.set(0, 0.12, -0.028);
  trim.scale.set(1.01, 1.01, 1);
  glider.add(trim, sail);
  const ribCount = lod === 0 ? 5 : 3;
  for (let i = 0; i < ribCount; i++) {
    const t = i / Math.max(1, ribCount - 1);
    const x = (t - 0.5) * 1.35;
    const rib = mesh(new THREE.CylinderGeometry(0.012, 0.01, 0.82, 5), mats.wood);
    rib.position.set(x, 0.1, 0.02);
    rib.rotation.z = -x * 0.18;
    rib.rotation.x = 0.12;
    glider.add(rib);
  }
  const spar = mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.5, 6), mats.wood);
  spar.rotation.z = Math.PI / 2;
  spar.position.set(0, 0.42, 0.02);
  glider.add(spar);
  const harnessL = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.55, 5), mats.strap);
  harnessL.position.set(-0.12, -0.18, 0.04);
  harnessL.rotation.z = 0.25;
  const harnessR = harnessL.clone();
  harnessR.position.x *= -1;
  harnessR.rotation.z *= -1;
  glider.add(harnessL, harnessR);
  glider.position.set(0, 0.38, -0.12);
  glider.visible = false;
  return glider;
}

function buildStowed(chest: THREE.Bone, mats: WandererMats) {
  const stowed = new THREE.Group();
  stowed.name = "GliderStowed";
  const roll = mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.42, 10), mats.fabric);
  roll.rotation.z = Math.PI / 2;
  const pole = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.48, 6), mats.wood);
  pole.rotation.z = Math.PI / 2;
  pole.position.z = -0.04;
  const strap = mesh(new THREE.TorusGeometry(0.05, 0.008, 4, 8), mats.strap);
  strap.rotation.y = Math.PI / 2;
  stowed.add(roll, pole, strap);
  stowed.position.set(0, 0.1, -0.2);
  stowed.rotation.x = 0.18;
  chest.add(stowed);
  return stowed;
}

function buildSlate(mats: WandererMats) {
  const slate = new THREE.Group();
  slate.name = "Slate";
  const body = mesh(new THREE.BoxGeometry(0.072, 0.1, 0.012), mats.slate);
  const frame = mesh(new THREE.BoxGeometry(0.08, 0.11, 0.008), mats.steelDark);
  frame.position.z = -0.005;
  const gem = mesh(sph(0.008, 8), mats.slate);
  gem.position.set(0, 0.036, 0.008);
  slate.add(frame, body, gem);
  return slate;
}

export function createSkinnedWanderer(opts: { lod?: LodLevel } = {}): LimbSet {
  const lod: LodLevel = opts.lod ?? 0;
  const mats = createWandererMaterials();
  const root = new THREE.Group();
  root.name = "Wanderer";
  root.userData.kind = "wanderer";
  root.userData.lod = lod;
  root.userData.mats = mats;

  const hips = bone("Hips", 0, 1.0, 0);
  const spine = bone("Spine", 0, 0.13, 0.01);
  const chest = bone("Chest", 0, 0.16, 0);
  const neck = bone("Neck", 0, 0.22, 0);
  const head = bone("Head", 0, 0.1, 0);
  const lClav = bone("L_Clavicle", -0.04, 0.18, 0.01);
  const rClav = bone("R_Clavicle", 0.04, 0.18, 0.01);
  const lArm = bone("L_UpperArm", -0.16, 0, 0);
  const rArm = bone("R_UpperArm", 0.16, 0, 0);
  const lFore = bone("L_ForeArm", 0, -0.32, 0);
  const rFore = bone("R_ForeArm", 0, -0.32, 0);
  const lHand = bone("L_Hand", 0, -0.27, 0);
  const rHand = bone("R_Hand", 0, -0.27, 0);
  const lUpLeg = bone("L_UpLeg", -0.1, -0.04, 0);
  const rUpLeg = bone("R_UpLeg", 0.1, -0.04, 0);
  const lLeg = bone("L_Leg", 0, -0.44, 0);
  const rLeg = bone("R_Leg", 0, -0.44, 0);
  const lFoot = bone("L_Foot", 0, -0.42, 0.02);
  const rFoot = bone("R_Foot", 0, -0.42, 0.02);
  const lToe = bone("L_Toe", 0, -0.02, 0.12);
  const rToe = bone("R_Toe", 0, -0.02, 0.12);

  hips.add(spine, lUpLeg, rUpLeg);
  spine.add(chest);
  chest.add(neck, lClav, rClav);
  neck.add(head);
  lClav.add(lArm);
  rClav.add(rArm);
  lArm.add(lFore);
  rArm.add(rFore);
  lFore.add(lHand);
  rFore.add(rHand);
  lUpLeg.add(lLeg);
  rUpLeg.add(rLeg);
  lLeg.add(lFoot);
  rLeg.add(rFoot);
  lFoot.add(lToe);
  rFoot.add(rToe);
  root.add(hips);

  markRest(hips);
  markRest(spine, 0.04, 0, 0);
  markRest(chest, 0.02, 0, 0);
  markRest(neck);
  markRest(head);
  markRest(lClav, 0, 0, 0.08);
  markRest(rClav, 0, 0, -0.08);
  markRest(lArm, 0.06, 0, -0.12);
  markRest(rArm, 0.06, 0, 0.12);
  markRest(lFore, -0.18, 0, 0);
  markRest(rFore, -0.18, 0, 0);
  markRest(lHand, 0.1, 0, 0);
  markRest(rHand, 0.1, 0, 0);
  markRest(lUpLeg, 0, 0, 0.04);
  markRest(rUpLeg, 0, 0, -0.04);
  markRest(lLeg, 0.08, 0, 0);
  markRest(rLeg, 0.08, 0, 0);
  markRest(lFoot, -0.08, 0, 0);
  markRest(rFoot, -0.08, 0, 0);
  markRest(lToe);
  markRest(rToe);

  // Rigid units first (they reference bones only).
  buildHead(head, mats, lod);
  const sink = makeSink();
  buildTorso(hips, spine, chest, neck, sink, mats, lod);
  buildArms(lArm, rArm, lFore, rFore, lHand, rHand, sink, mats, lod);
  buildLegs(lUpLeg, rUpLeg, lLeg, rLeg, lFoot, rFoot, sink, mats, lod);

  const sword = buildSword(mats);
  sword.position.set(0.02, -0.05, 0.02);
  sword.rotation.set(-0.2, 0, 0.12);
  rHand.add(sword);

  const slate = buildSlate(mats);
  slate.position.set(-0.03, -0.02, 0.05);
  slate.rotation.set(-0.3, 0.5, 0.2);
  lHand.add(slate);

  const glider = buildGlider(mats, lod);
  chest.add(glider);
  const stowed = buildStowed(chest, mats);
  root.userData.stowed = stowed;

  // Skeleton from the bind (rest) pose; then skin the baked parts to it.
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const skeleton = new THREE.Skeleton(bones);
  const rig: SkinRig = buildSkinRig(root, bones);
  const skinned = buildSkinnedParts(root, sink.parts, skeleton, rig);
  root.userData.skinnedParts = skinned.length;

  return {
    root,
    torso: chest,
    head,
    larm: lArm,
    rarm: rArm,
    lleg: lUpLeg,
    rleg: rUpLeg,
    sword,
    glider,
    slate,
    skeleton,
  };
}

export function createWandererLod(): LimbSet {
  return createSkinnedWanderer({ lod: 1 });
}

export const WANDERER_HEIGHT = 1.8;
export const WANDERER_FORWARD = "+z";
export const WANDERER_BONES = [
  "Hips",
  "Spine",
  "Chest",
  "Neck",
  "Head",
  "L_Clavicle",
  "R_Clavicle",
  "L_UpperArm",
  "R_UpperArm",
  "L_ForeArm",
  "R_ForeArm",
  "L_Hand",
  "R_Hand",
  "L_UpLeg",
  "R_UpLeg",
  "L_Leg",
  "R_Leg",
  "L_Foot",
  "R_Foot",
  "L_Toe",
  "R_Toe",
] as const;
