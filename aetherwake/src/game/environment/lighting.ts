import * as THREE from "three";
import type { QualityTier } from "./types.ts";
import { QUALITY_TIERS } from "./quality.ts";

/**
 * Bright readable daytime. Linear fog only — FogExp2 at 0.003 hides mid-field quality.
 * Contact-shadow friendly: modest ortho window around the player, small bias, PCF soft.
 */
export type LightingRig = {
  sunColor: string;
  sunIntensity: number;
  sunDir: THREE.Vector3;
  ambient: number;
  ambientColor: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  exposure: number;
  shadowMapSize: number;
  shadowCamNear: number;
  shadowCamFar: number;
  shadowCamExtent: number;
  shadowBias: number;
  shadowNormalBias: number;
  envMapIntensity: number;
  toneMapping: THREE.ToneMapping;
};

/** Matches Scene.tsx: ang = (day - 0.25) * PI * 2. Noon-ish is ~0.45. */
export const DAYTIME_TOD = 0.45;

export function sunDirFromTimeOfDay(day: number, target = new THREE.Vector3()) {
  const ang = (day - 0.25) * Math.PI * 2;
  return target.set(Math.cos(ang), Math.sin(ang), 0.25).normalize();
}

export const LIGHTING: LightingRig = {
  sunColor: "#f2ead4",
  sunIntensity: 2.2,
  sunDir: sunDirFromTimeOfDay(DAYTIME_TOD, new THREE.Vector3()),
  ambient: 0.3,
  ambientColor: "#efe6d2",
  hemiSky: "#c9deee",
  hemiGround: "#6a6e56",
  hemiIntensity: 0.82,
  fogColor: "#d4dfd2",
  fogNear: 100,
  fogFar: 440,
  exposure: 1.06,
  shadowMapSize: 2048,
  shadowCamNear: 2,
  shadowCamFar: 110,
  shadowCamExtent: 36,
  shadowBias: -0.00028,
  shadowNormalBias: 0.035,
  envMapIntensity: 0.32,
  toneMapping: THREE.ACESFilmicToneMapping,
};

export function lightingForQuality(tier: QualityTier): LightingRig {
  const q = QUALITY_TIERS[tier];
  return { ...LIGHTING, shadowMapSize: q.shadowMapSize };
}

export function createDayFog(rig: LightingRig = LIGHTING) {
  return new THREE.Fog(rig.fogColor, rig.fogNear, rig.fogFar);
}

export function applyRendererPresentation(renderer: THREE.WebGLRenderer, rig: LightingRig = LIGHTING) {
  renderer.toneMapping = rig.toneMapping;
  renderer.toneMappingExposure = rig.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function configureSunShadow(light: THREE.DirectionalLight, rig: LightingRig = LIGHTING) {
  light.castShadow = true;
  light.color.set(rig.sunColor);
  light.intensity = rig.sunIntensity;
  light.shadow.mapSize.set(rig.shadowMapSize, rig.shadowMapSize);
  light.shadow.bias = rig.shadowBias;
  light.shadow.normalBias = rig.shadowNormalBias;
  const cam = light.shadow.camera as THREE.OrthographicCamera;
  const e = rig.shadowCamExtent;
  cam.near = rig.shadowCamNear;
  cam.far = rig.shadowCamFar;
  cam.left = -e;
  cam.right = e;
  cam.top = e;
  cam.bottom = -e;
  cam.updateProjectionMatrix();
}
