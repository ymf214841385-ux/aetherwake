import * as THREE from "three";
import { createTerrainMaterials, createPropMaterials, disposeMaterials, updateGrassWind } from "./materials.ts";
import { createRockGeometries, createRockLodSets } from "./rocks.ts";
import { createVegetationKit } from "./vegetation.ts";
import { createWaterMaterial, updateWaterMaterial } from "./water.ts";
import { LIGHTING, applyRendererPresentation, lightingForQuality } from "./lighting.ts";
import { QUALITY_TIERS, resolveQualityTier } from "./quality.ts";
import { disposeMaps, loadDayEnvironment, loadEnvironmentMaps } from "./textures.ts";
import type { EnvironmentMaps, QualityTier } from "./types.ts";

export type { LodLevel, QualityTier, InstanceItem, LodGeometries, EnvironmentMaps, TextureTriple } from "./types.ts";
export { ENV_PUBLIC_PATH, TEXTURE_FILES, HDRI_PATH, loadEnvironmentMaps, loadDayEnvironment, applyAnisotropy, disposeMaps } from "./textures.ts";
export {
  TERRAIN_COLORS,
  createTerrainMaterials,
  createSplatTerrainMaterial,
  createPropMaterials,
  updateGrassWind,
  disposeMaterials,
  applySplatShaderPatch,
  SPLAT_SHADER_NEEDLES,
} from "./materials.ts";
export type { SplatShader } from "./materials.ts";
export {
  buildDisplacedTerrainGeometry,
  averageIndexedFaceNormalY,
  averageVertexNormalY,
} from "./terrainGeo.ts";
export { createRockGeometries, createRockGeometry, createRockLodSets, ROCK_VARIANT_COUNT } from "./rocks.ts";
export { createVegetationKit, createGrassClumpGeometry, scatterGrass, pickTreeVariant } from "./vegetation.ts";
export type { TreeVariant } from "./vegetation.ts";
export { createWaterMaterial, createWaterMesh, updateWaterMaterial, waterRestY } from "./water.ts";
export type { WaterHandle } from "./water.ts";
export { LIGHTING, DAYTIME_TOD, sunDirFromTimeOfDay, lightingForQuality, createDayFog, applyRendererPresentation, configureSunShadow } from "./lighting.ts";
export type { LightingRig } from "./lighting.ts";
export { QUALITY_TIERS, resolveQualityTier } from "./quality.ts";
export type { QualitySettings } from "./quality.ts";
export { LOD_DISTANCES, lodLevelAt, bucketByLod, writeInstanceMatrices } from "./lod.ts";

export type EnvironmentPackage = {
  quality: QualityTier;
  lighting: typeof LIGHTING;
  maps: EnvironmentMaps | null;
  envMap: THREE.Texture | null;
  terrain: ReturnType<typeof createTerrainMaterials>;
  props: ReturnType<typeof createPropMaterials>;
  rocks: {
    geos: THREE.BufferGeometry[];
    lod: ReturnType<typeof createRockLodSets>;
    material: THREE.MeshStandardMaterial;
  };
  vegetation: ReturnType<typeof createVegetationKit>;
  water: THREE.MeshStandardMaterial;
  update: (time: number) => void;
  dispose: () => void;
};

export async function createEnvironment(
  opts: {
    quality?: QualityTier | "auto";
    renderer?: THREE.WebGLRenderer;
    loadTextures?: boolean;
  } = {},
): Promise<EnvironmentPackage> {
  const quality = resolveQualityTier(opts.quality ?? "auto");
  const q = QUALITY_TIERS[quality];
  const lighting = lightingForQuality(quality);
  let maps: EnvironmentMaps | null = null;
  if (opts.loadTextures !== false) {
    try {
      maps = await loadEnvironmentMaps(q.terrainAnisotropy);
    } catch {
      maps = null;
    }
  }
  let envMap: THREE.Texture | null = null;
  if (opts.renderer) {
    applyRendererPresentation(opts.renderer, lighting);
    if (q.envMap) envMap = await loadDayEnvironment(opts.renderer);
  }

  const terrain = createTerrainMaterials(maps);
  const props = createPropMaterials(maps);
  const rockGeos = createRockGeometries();
  const rockLod = createRockLodSets();
  const vegetation = createVegetationKit();
  const water = createWaterMaterial();

  return {
    quality,
    lighting,
    maps,
    envMap,
    terrain,
    props,
    rocks: { geos: rockGeos, lod: rockLod, material: props.boulder },
    vegetation,
    water,
    update: (time: number) => {
      updateWaterMaterial(water, time);
      updateGrassWind(props.grass, time);
    },
    dispose: () => {
      disposeMaps(maps);
      disposeMaterials(terrain);
      disposeMaterials(props);
      water.dispose();
      envMap?.dispose();
      for (const g of rockGeos) g.dispose();
      for (const set of rockLod) {
        set.high.dispose();
        set.mid.dispose();
        set.low.dispose();
      }
      for (const t of [...vegetation.broadleaf, ...vegetation.pine]) {
        t.trunk.high.dispose();
        t.trunk.mid.dispose();
        t.trunk.low.dispose();
        t.crown.high.dispose();
        t.crown.mid.dispose();
        t.crown.low.dispose();
      }
      vegetation.grass.high.dispose();
      vegetation.grass.mid.dispose();
      vegetation.grass.low.dispose();
    },
  };
}
