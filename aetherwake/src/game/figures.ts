import * as THREE from "three";
import { WATER_LEVEL } from "./height";
import type { AnimState, LimbSet } from "./wandererRig";
import {
  TOWER_DOCK_RADIUS,
  TOWER_LEDGE_H,
  TOWER_LEDGE_RADIUS,
  citadelWallMetrics,
  towerLedgePlacements,
} from "./world";

const mats = {
  skin: new THREE.MeshLambertMaterial({ color: "#c99570" }),
  hair: new THREE.MeshLambertMaterial({ color: "#241910" }),
  tunic: new THREE.MeshLambertMaterial({ color: "#2f7a6e" }),
  wrap: new THREE.MeshLambertMaterial({ color: "#c45c4a" }),
  pants: new THREE.MeshLambertMaterial({ color: "#3a322c" }),
  boot: new THREE.MeshLambertMaterial({ color: "#4a3020" }),
  steel: new THREE.MeshLambertMaterial({ color: "#b8c0c6" }),
  leather: new THREE.MeshLambertMaterial({ color: "#6b4a32" }),
  slate: new THREE.MeshLambertMaterial({ color: "#8fd4c8", emissive: "#2a6a62", emissiveIntensity: 0.6 }),
  fabric: new THREE.MeshLambertMaterial({ color: "#d8c4a0", side: THREE.DoubleSide }),
  rust: new THREE.MeshLambertMaterial({ color: "#7a3a28" }),
  hide: new THREE.MeshLambertMaterial({ color: "#5a4030" }),
  horn: new THREE.MeshLambertMaterial({ color: "#e8d8b0" }),
  stone: new THREE.MeshLambertMaterial({ color: "#8d8880" }),
  eye: new THREE.MeshLambertMaterial({ color: "#ffb45a", emissive: "#ff8020", emissiveIntensity: 1.2 }),
  dark: new THREE.MeshLambertMaterial({ color: "#1c1618" }),
  crown: new THREE.MeshLambertMaterial({ color: "#8a7a5a" }),
  wood: new THREE.MeshLambertMaterial({ color: "#5a3a22" }),
  leaf: new THREE.MeshLambertMaterial({ color: "#3d7a42" }),
  leaf2: new THREE.MeshLambertMaterial({ color: "#4c8a44" }),
  pine: new THREE.MeshLambertMaterial({ color: "#2d5a3c" }),
  rock: new THREE.MeshLambertMaterial({ color: "#7d766c" }),
  teal: new THREE.MeshLambertMaterial({ color: "#3aa89a", emissive: "#145048", emissiveIntensity: 0.45 }),
  glow: new THREE.MeshLambertMaterial({ color: "#d8fff4", emissive: "#7ec8b8", emissiveIntensity: 1.4 }),
  cracked: new THREE.MeshLambertMaterial({ color: "#8a7060" }),
  metal: new THREE.MeshStandardMaterial({ color: "#8a96a0", metalness: 0.8, roughness: 0.35 }),
  waterIce: new THREE.MeshLambertMaterial({
    color: "#b8e4f0",
    transparent: true,
    opacity: 0.72,
    emissive: "#4a88a0",
    emissiveIntensity: 0.2,
  }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, y = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function sph(r: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
  m.castShadow = true;
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, segs = 6) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export type { AnimState, LimbSet } from "./wandererRig";

export { animateSkinnedWanderer as animateWanderer, disposeRiggedGLB, loadRiggedGLB } from "./wandererRig";

export function createWandererLegacy(): LimbSet {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const torso = box(0.38, 0.48, 0.24, mats.tunic, 0.28);
  hips.add(torso);
  const wrap = box(0.42, 0.08, 0.28, mats.wrap, 0.08);
  hips.add(wrap);
  const scarf = box(0.18, 0.42, 0.06, mats.wrap, 0.18);
  scarf.position.set(0.16, 0.42, 0.02);
  scarf.rotation.z = -0.35;
  hips.add(scarf);
  const satchel = box(0.16, 0.2, 0.1, mats.leather, 0.12);
  satchel.position.set(-0.22, 0.05, 0.02);
  hips.add(satchel);
  const pack = box(0.28, 0.22, 0.12, mats.leather, 0.32);
  pack.position.z = -0.18;
  hips.add(pack);

  const head = new THREE.Group();
  head.position.y = 0.64;
  const skull = sph(0.155, mats.skin);
  const jaw = sph(0.1, mats.skin);
  jaw.position.set(0, -0.08, 0.03);
  jaw.scale.set(0.85, 0.55, 0.7);
  const earL = sph(0.035, mats.skin);
  earL.position.set(-0.15, 0.02, 0);
  const earR = earL.clone();
  earR.position.x = 0.15;
  const hair = sph(0.175, mats.hair);
  hair.position.set(0, 0.05, -0.02);
  hair.scale.set(1.08, 0.72, 1.12);
  const hairTail = box(0.1, 0.26, 0.08, mats.hair, -0.14);
  hairTail.position.z = -0.12;
  hairTail.rotation.x = 0.45;
  const brow = box(0.14, 0.025, 0.04, mats.hair, 0.04);
  brow.position.z = 0.12;
  head.add(skull, jaw, earL, earR, hair, hairTail, brow);
  hips.add(head);

  const larm = new THREE.Group();
  larm.position.set(-0.26, 0.46, 0);
  const lUpper = cyl(0.055, 0.048, 0.28, mats.tunic);
  lUpper.position.y = -0.12;
  const lLower = cyl(0.045, 0.04, 0.26, mats.skin);
  lLower.position.y = -0.36;
  const lHand = sph(0.045, mats.skin);
  lHand.position.y = -0.5;
  larm.add(lUpper, lLower, lHand);
  hips.add(larm);

  const rarm = new THREE.Group();
  rarm.position.set(0.26, 0.46, 0);
  const rUpper = cyl(0.055, 0.048, 0.28, mats.tunic);
  rUpper.position.y = -0.12;
  const rLower = cyl(0.045, 0.04, 0.26, mats.skin);
  rLower.position.y = -0.36;
  const rHand = sph(0.045, mats.skin);
  rHand.position.y = -0.5;
  rarm.add(rUpper, rLower, rHand);
  hips.add(rarm);

  const lleg = new THREE.Group();
  lleg.position.set(-0.11, 0.02, 0);
  const lThigh = cyl(0.075, 0.06, 0.38, mats.pants);
  lThigh.position.y = -0.18;
  const lShin = cyl(0.055, 0.048, 0.34, mats.pants);
  lShin.position.y = -0.5;
  const lboot = box(0.13, 0.11, 0.22, mats.boot, -0.72);
  lboot.position.z = 0.04;
  lleg.add(lThigh, lShin, lboot);
  hips.add(lleg);

  const rleg = new THREE.Group();
  rleg.position.set(0.11, 0.02, 0);
  const rThigh = cyl(0.075, 0.06, 0.38, mats.pants);
  rThigh.position.y = -0.18;
  const rShin = cyl(0.055, 0.048, 0.34, mats.pants);
  rShin.position.y = -0.5;
  const rboot = box(0.13, 0.11, 0.22, mats.boot, -0.72);
  rboot.position.z = 0.04;
  rleg.add(rThigh, rShin, rboot);
  hips.add(rleg);

  const sword = new THREE.Group();
  const blade = box(0.04, 0.72, 0.08, mats.steel, 0.36);
  const hilt = box(0.12, 0.08, 0.12, mats.leather, 0);
  sword.add(blade, hilt);
  sword.position.set(0.22, 0.2, -0.18);
  sword.rotation.z = 0.15;
  sword.rotation.x = -0.2;
  hips.add(sword);

  const slate = box(0.12, 0.16, 0.03, mats.slate, 0);
  slate.position.set(-0.22, 0.12, 0.08);
  slate.rotation.y = 0.4;
  hips.add(slate);

  const glider = new THREE.Group();
  const fabric = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.35, 4, 1, true), mats.fabric);
  fabric.rotation.y = Math.PI / 4;
  fabric.position.y = 0.1;
  const poleL = cyl(0.02, 0.02, 1.4, mats.wood, 4);
  poleL.rotation.z = 0.7;
  poleL.position.set(-0.45, -0.15, 0);
  const poleR = poleL.clone();
  poleR.rotation.z = -0.7;
  poleR.position.set(0.45, -0.15, 0);
  glider.add(fabric, poleL, poleR);
  glider.position.y = 1.35;
  glider.visible = false;
  root.add(glider);

  return { root, torso, head, larm, rarm, lleg, rleg, sword, glider, slate };
}

export function animateWandererLegacy(f: LimbSet, t: number, state: AnimState, attackT: number) {
  f.root.rotation.x = 0;
  f.torso.rotation.x = 0;
  f.larm.rotation.set(0, 0, 0.12);
  f.rarm.rotation.set(0, 0, -0.12);
  f.lleg.rotation.set(0, 0, 0);
  f.rleg.rotation.set(0, 0, 0);
  f.sword.rotation.set(-0.2, 0, 0.15);
  const s = state === "run" ? 11 : state === "walk" || state === "swim" ? 7 : 2.2;
  const amp = state === "run" ? 0.7 : state === "walk" ? 0.45 : state === "climb" ? 0.55 : 0.08;
  const swing = Math.sin(t * s) * amp;
  if (state === "glide") {
    f.larm.rotation.z = 1.15;
    f.rarm.rotation.z = -1.15;
    f.larm.rotation.x = 0.2;
    f.rarm.rotation.x = 0.2;
    f.lleg.rotation.x = 0.2;
    f.rleg.rotation.x = 0.25;
    f.glider.visible = true;
    f.glider.rotation.z = Math.sin(t * 2) * 0.06;
  } else {
    f.glider.visible = false;
    if (state === "attack") {
      const k = Math.min(1, attackT / 0.22);
      f.rarm.rotation.x = -1.6 * k;
      f.rarm.rotation.z = -0.4 * k;
      f.sword.rotation.x = -1.2 * k;
      f.larm.rotation.z = 0.2;
      f.lleg.rotation.x = swing * 0.2;
      f.rleg.rotation.x = -swing * 0.2;
    } else if (state === "bow") {
      f.larm.rotation.x = -1.1;
      f.rarm.rotation.x = -1.0;
      f.rarm.rotation.z = 0.4;
    } else if (state === "climb") {
      f.larm.rotation.x = swing;
      f.rarm.rotation.x = -swing;
      f.lleg.rotation.x = -swing;
      f.rleg.rotation.x = swing;
    } else if (state === "jump") {
      f.larm.rotation.x = -0.6;
      f.rarm.rotation.x = 0.4;
      f.lleg.rotation.x = -0.5;
      f.rleg.rotation.x = 0.35;
    } else if (state === "fall") {
      f.larm.rotation.z = 0.7;
      f.rarm.rotation.z = -0.7;
      f.lleg.rotation.x = 0.25;
      f.rleg.rotation.x = 0.15;
    } else if (state === "hit") {
      f.torso.rotation.x = 0.25;
      f.larm.rotation.x = -0.8;
      f.rarm.rotation.x = -0.5;
    } else if (state === "death") {
      f.root.rotation.x = 1.2;
      f.larm.rotation.z = 0.8;
      f.rarm.rotation.z = -0.4;
    } else {
      f.larm.rotation.x = -swing;
      f.rarm.rotation.x = swing;
      f.larm.rotation.z = 0.12;
      f.rarm.rotation.z = -0.12;
      f.lleg.rotation.x = swing;
      f.rleg.rotation.x = -swing;
      f.sword.rotation.x = -0.2;
    }
  }
  f.torso.position.y = 0.28 + Math.abs(Math.sin(t * s)) * (state === "idle" ? 0.012 : 0.03);
}

export function createBramblekin() {
  const root = new THREE.Group();
  const body = cyl(0.22, 0.28, 0.55, mats.rust, 6);
  body.position.y = 0.55;
  body.rotation.x = 0.25;
  const head = sph(0.2, mats.hide);
  head.position.set(0, 0.95, 0.12);
  const hornL = cyl(0.02, 0.05, 0.28, mats.horn, 4);
  hornL.position.set(-0.12, 1.12, 0.05);
  hornL.rotation.z = 0.5;
  const hornR = hornL.clone();
  hornR.position.x = 0.12;
  hornR.rotation.z = -0.5;
  const club = box(0.1, 0.55, 0.1, mats.wood, 0);
  club.position.set(0.32, 0.7, 0.1);
  club.rotation.z = -0.4;
  const eyeL = sph(0.035, mats.eye);
  eyeL.position.set(-0.07, 0.98, 0.28);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.07;
  root.add(body, head, hornL, hornR, club, eyeL, eyeR);
  const legL = cyl(0.07, 0.05, 0.4, mats.hide, 5);
  legL.position.set(-0.12, 0.2, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;
  root.add(legL, legR);
  root.userData.legs = [legL, legR];
  return root;
}

export function createSentinel() {
  const root = new THREE.Group();
  const base = cyl(0.4, 0.5, 0.3, mats.stone, 8);
  base.position.y = 0.2;
  const body = cyl(0.32, 0.38, 1.1, mats.stone, 8);
  body.position.y = 0.9;
  const head = sph(0.28, mats.stone);
  head.position.y = 1.62;
  const eye = sph(0.1, mats.eye);
  eye.position.set(0, 1.64, 0.24);
  root.add(base, body, head, eye);
  root.userData.eye = eye;
  return root;
}

export function createBoss() {
  const root = new THREE.Group();
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.8, 6), mats.dark);
  cloak.position.y = 1.5;
  const head = sph(0.32, mats.dark);
  head.position.y = 2.85;
  const antL = cyl(0.03, 0.02, 0.7, mats.crown, 4);
  antL.position.set(-0.18, 3.25, 0);
  antL.rotation.z = 0.45;
  const antR = antL.clone();
  antR.position.x = 0.18;
  antR.rotation.z = -0.45;
  const blade = box(0.12, 2.2, 0.18, mats.steel, 0);
  blade.position.set(1.1, 1.6, 0.2);
  blade.rotation.z = -0.3;
  root.add(cloak, head, antL, antR, blade);
  return root;
}

export function createTower(height = 38, baseY = 0, needsDock = false) {
  const g = new THREE.Group();
  const wetDrop = needsDock || baseY < WATER_LEVEL + 0.9 ? Math.max(0, baseY - (WATER_LEVEL - 0.6)) : 0;
  const shaftH = height + wetDrop;
  const shaft = cyl(4.0, 4.4, shaftH, mats.stone, 8);
  shaft.position.y = height * 0.5 - wetDrop * 0.5;
  const band = cyl(4.3, 4.3, 0.6, mats.teal, 8);
  band.position.y = height - 1.2;
  const cap = cyl(3.2, 4.6, 1.2, mats.stone, 8);
  cap.position.y = height + 0.4;
  const terminal = box(1.1, 1.4, 1.1, mats.slate, height + 1.4);
  const spire = cyl(0.12, 0.35, 3.2, mats.teal, 5);
  spire.position.y = height + 3.2;
  g.add(shaft, band, cap, terminal, spire);
  for (const p of towerLedgePlacements(baseY)) {
    const ledge = box(p.w, TOWER_LEDGE_H, p.d, mats.stone, p.y);
    ledge.position.x = Math.cos(p.a) * TOWER_LEDGE_RADIUS;
    ledge.position.z = Math.sin(p.a) * TOWER_LEDGE_RADIUS;
    ledge.rotation.y = -p.a;
    g.add(ledge);
  }
  if (needsDock || baseY < WATER_LEVEL + 0.9) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const dock = box(2.6, 0.34, 2.1, mats.wood, WATER_LEVEL + 0.03 - baseY);
      dock.position.x = Math.cos(a) * TOWER_DOCK_RADIUS;
      dock.position.z = Math.sin(a) * TOWER_DOCK_RADIUS;
      dock.rotation.y = -a;
      g.add(dock);
    }
  }
  return g;
}

export function createShrine() {
  const g = new THREE.Group();
  const base = box(6.2, 0.6, 6.2, mats.stone, 0.3);
  const mid = box(4.4, 2.2, 4.4, mats.stone, 1.6);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.8, 4), mats.teal);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 3.6;
  const door = box(1.4, 1.8, 0.2, mats.glow, 1.3);
  door.position.z = 2.22;
  g.add(base, mid, roof, door);
  return g;
}

export function createCitadel() {
  const g = new THREE.Group();
  const keep = box(10, 8, 10, mats.stone, 4);
  const wall = citadelWallMetrics();
  const wallN = box(22, wall.h, 1.4, mats.stone, wall.localY);
  wallN.position.z = -11;
  const wallE = box(1.4, wall.h, 22, mats.stone, wall.localY);
  wallE.position.x = 11;
  const wallW = wallE.clone();
  wallW.position.x = -11;
  const gateGap = 4.6;
  const wing = (22 - gateGap) / 2;
  const wallSw = box(wing, wall.h, 1.4, mats.stone, wall.localY);
  wallSw.position.set(-(gateGap / 2 + wing / 2), wall.localY, 11);
  const wallSe = wallSw.clone();
  wallSe.position.x = gateGap / 2 + wing / 2;
  const gate = box(0.45, 3.6, 0.45, mats.dark, 1.8);
  const gateL = gate.clone();
  gateL.position.set(-gateGap / 2, 1.8, 11);
  const gateR = gate.clone();
  gateR.position.set(gateGap / 2, 1.8, 11);
  const t1 = cyl(1.5, 1.7, 9, mats.stone, 6);
  t1.position.set(10, 4.5, 10);
  const t2 = t1.clone();
  t2.position.set(-10, 4.5, 10);
  const t3 = t1.clone();
  t3.position.set(10, 4.5, -10);
  const t4 = t1.clone();
  t4.position.set(-10, 4.5, -10);
  g.add(keep, wallN, wallSw, wallSe, wallE, wallW, gateL, gateR, t1, t2, t3, t4);
  return g;
}

export function createCamp() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.8, 4), mats.hide);
    tent.position.set(Math.cos(i * 2.1) * 2.4, 0.9, Math.sin(i * 2.1) * 2.4);
    tent.rotation.y = i;
    g.add(tent);
  }
  const pit = cyl(0.7, 0.8, 0.2, mats.rock, 6);
  pit.position.y = 0.1;
  g.add(pit);
  return g;
}

export function createAwakening() {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = cyl(0.28, 0.35, 2.4 + (i % 3) * 0.4, mats.stone, 5);
    p.position.set(Math.cos(a) * 4.2, 1.2, Math.sin(a) * 4.2);
    p.rotation.z = Math.sin(a) * 0.08;
    g.add(p);
  }
  const floor = cyl(4.6, 4.6, 0.25, mats.stone, 10);
  floor.position.y = 0.05;
  const glyph = cyl(1.1, 1.1, 0.08, mats.glow, 8);
  glyph.position.y = 0.2;
  g.add(floor, glyph);
  return g;
}

export function createSage() {
  const g = new THREE.Group();
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.5, 6), mats.dark);
  cloak.position.y = 0.85;
  const head = sph(0.16, mats.skin);
  head.position.y = 1.62;
  const hood = sph(0.2, mats.dark);
  hood.position.set(0, 1.68, -0.02);
  g.add(cloak, head, hood);
  return g;
}

export function createIcePillar() {
  const m = cyl(0.95, 1.1, 3.4, mats.waterIce, 6);
  m.position.y = 1.7;
  return m;
}

export function createBomb() {
  const m = sph(0.28, new THREE.MeshLambertMaterial({ color: "#2a2a2e", emissive: "#3a2020", emissiveIntensity: 0.4 }));
  const cap = cyl(0.08, 0.08, 0.12, mats.steel, 5);
  cap.position.y = 0.28;
  const g = new THREE.Group();
  g.add(m, cap);
  return g;
}

export { mats };
