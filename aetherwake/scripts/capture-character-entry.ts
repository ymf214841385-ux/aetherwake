import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createSkinnedWanderer } from "../src/game/character/build.ts";
import { animateSkinnedWanderer } from "../src/game/character/animate.ts";
import type { AnimState } from "../src/game/character/types.ts";

const params = new URLSearchParams(location.search);
const view = (params.get("view") || "front").toLowerCase();
const state = (params.get("state") || "idle") as AnimState;
const label = params.get("label") || view.toUpperCase();
const labelEl = document.getElementById("label");
if (labelEl) labelEl.textContent = label;

const width = 960;
const height = 1280;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#c5d2c8");
scene.fog = new THREE.Fog("#c5d2c8", 6, 14);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(36, width / height, 0.08, 40);
const face = view === "face";
if (view === "front") camera.position.set(0.04, 0.9, 3.2);
else if (view === "side") camera.position.set(3.2, 0.9, 0);
else if (view === "back") camera.position.set(-0.04, 0.9, -3.2);
else if (face) camera.position.set(0.03, 1.63, 0.52);
else camera.position.set(1.55, 0.92, 3.15);
camera.lookAt(0, face ? 1.61 : 0.9, face ? 0.06 : 0);

const hemi = new THREE.HemisphereLight("#c9deee", "#6a6e56", 0.85);
scene.add(hemi);
const amb = new THREE.AmbientLight("#efe6d2", 0.32);
scene.add(amb);
const sun = new THREE.DirectionalLight("#f2ead4", 1.85);
sun.position.set(2.8, 5.2, 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.00028;
sun.shadow.normalBias = 0.035;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 16;
sun.shadow.camera.left = -3;
sun.shadow.camera.right = 3;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -1;
scene.add(sun);
const fill = new THREE.DirectionalLight("#d7e4f0", face ? 0.7 : 0.45);
fill.position.copy(camera.position);
scene.add(fill);
if (face) {
  const faceKey = new THREE.DirectionalLight("#fff4e8", 0.55);
  faceKey.position.set(0.35, 1.72, 0.8);
  scene.add(faceKey);
}
const rim = new THREE.DirectionalLight("#fff6e8", 0.35);
rim.position.set(-2.2, 2.4, -1.6);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(3.2, 48),
  new THREE.MeshStandardMaterial({ color: "#6a7a58", roughness: 0.92, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const wanderer = createSkinnedWanderer({ lod: 0 });
scene.add(wanderer.root);

function settle(st: AnimState, tEnd: number) {
  wanderer.root.userData.lastT = undefined;
  wanderer.root.userData.lastState = undefined;
  wanderer.root.userData.attackStart = undefined;
  const steps = 36;
  if (st === "attack") {
    animateSkinnedWanderer(wanderer, 0, "attack", 0.12);
    for (let i = 1; i <= steps; i++) animateSkinnedWanderer(wanderer, (0.1 * i) / steps, "attack", 0.12);
    return;
  }
  const start = Math.max(0, tEnd - 0.9);
  for (let i = 0; i <= steps; i++) {
    animateSkinnedWanderer(wanderer, start + ((tEnd - start) * i) / steps, st, 0.12);
  }
}

const tFor: Partial<Record<AnimState, number>> = {
  idle: 1.35,
  walk: 1.18,
  run: 0.94,
  climb: 1.05,
  glide: 1.22,
  attack: 0.1,
};
settle(state, tFor[state] ?? 1.2);
wanderer.root.updateMatrixWorld(true);

renderer.render(scene, camera);
(window as unknown as { __AW_CAPTURE_READY?: boolean }).__AW_CAPTURE_READY = true;
