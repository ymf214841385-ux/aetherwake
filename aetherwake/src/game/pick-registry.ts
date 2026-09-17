/**
 * Shared pick registry between Scene (three objects) and GameClient (DOM clicks).
 */

import type * as THREE from "three";
import type { Pickable } from "./world-picking.ts";

let camera: THREE.Camera | null = null;
let canvas: HTMLCanvasElement | null = null;
let pickables: Pickable[] = [];
let occluders: THREE.Object3D[] = [];

export function setPickCamera(cam: THREE.Camera | null) {
  camera = cam;
}

export function setPickCanvas(el: HTMLCanvasElement | null) {
  canvas = el;
}

export function setPickables(list: Pickable[]) {
  pickables = list;
}

export function setOccluders(list: THREE.Object3D[]) {
  occluders = list;
}

export function getPickContext() {
  if (!camera || !canvas) return null;
  return { camera, canvas, pickables, occluders };
}
