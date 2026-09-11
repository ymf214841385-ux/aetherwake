import type * as THREE from "three";

export type LimbSet = {
  root: THREE.Group;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  larm: THREE.Object3D;
  rarm: THREE.Object3D;
  lleg: THREE.Object3D;
  rleg: THREE.Object3D;
  sword: THREE.Object3D;
  glider: THREE.Object3D;
  slate: THREE.Object3D;
  skeleton?: THREE.Skeleton;
};

export type AnimState =
  | "idle"
  | "walk"
  | "run"
  | "jump"
  | "fall"
  | "land"
  | "climb"
  | "glide"
  | "attack"
  | "swim"
  | "bow"
  | "hit"
  | "death";

export type LodLevel = 0 | 1;

export type RestEuler = { x: number; y: number; z: number; px: number; py: number; pz: number };
