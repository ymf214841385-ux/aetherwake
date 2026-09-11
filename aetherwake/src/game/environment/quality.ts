import type { LodLevel, QualityTier } from "./types.ts";

export type QualitySettings = {
  grassDensity: number;
  /** Recommended grass instance cap (camera-local scatter, not whole 384 world). */
  grassCount: number;
  shadowMapSize: number;
  terrainAnisotropy: number;
  waterSegments: number;
  rockLod: LodLevel;
  treeLod: LodLevel;
  grassLod: LodLevel;
  pixelRatioCap: number;
  envMap: boolean;
  splatNormals: boolean;
  treeVariants: number;
};

export const QUALITY_TIERS: Record<QualityTier, QualitySettings> = {
  low: {
    grassDensity: 0.4,
    grassCount: 420,
    shadowMapSize: 512,
    terrainAnisotropy: 1,
    waterSegments: 16,
    rockLod: "low",
    treeLod: "low",
    grassLod: "low",
    pixelRatioCap: 1,
    envMap: false,
    splatNormals: false,
    treeVariants: 1,
  },
  mid: {
    grassDensity: 0.75,
    grassCount: 900,
    shadowMapSize: 1024,
    terrainAnisotropy: 4,
    waterSegments: 32,
    rockLod: "mid",
    treeLod: "mid",
    grassLod: "mid",
    pixelRatioCap: 1.5,
    envMap: true,
    splatNormals: true,
    treeVariants: 2,
  },
  high: {
    grassDensity: 1,
    grassCount: 1600,
    shadowMapSize: 2048,
    terrainAnisotropy: 8,
    waterSegments: 48,
    rockLod: "high",
    treeLod: "high",
    grassLod: "high",
    pixelRatioCap: 2,
    envMap: true,
    splatNormals: true,
    treeVariants: 3,
  },
};

export function resolveQualityTier(pref: QualityTier | "auto" = "auto"): QualityTier {
  if (pref !== "auto") return pref;
  if (typeof navigator === "undefined") return "mid";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile || (mem !== undefined && mem <= 4) || cores <= 4) return "low";
  if (mem !== undefined && mem >= 8 && cores >= 8) return "high";
  return "mid";
}
