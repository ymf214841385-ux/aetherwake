import * as THREE from "three";
import { WATER_LEVEL } from "../height.ts";
import type { EnvironmentMaps } from "./types.ts";

export const TERRAIN_COLORS = {
  grass: new THREE.Color("#4f6a3c"),
  dirt: new THREE.Color("#7a5c3c"),
  rock: new THREE.Color("#6d6760"),
  wetShore: new THREE.Color("#4a5850"),
  sand: new THREE.Color("#c4b08a"),
};

export type TerrainMaterialSet = {
  grass: THREE.MeshStandardMaterial;
  dirt: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  wetShore: THREE.MeshStandardMaterial;
  splat: THREE.MeshStandardMaterial;
};

function std(opts: THREE.MeshStandardMaterialParameters) {
  const m = new THREE.MeshStandardMaterial(opts);
  m.envMapIntensity = 0.28;
  return m;
}

function bindMaps(
  mat: THREE.MeshStandardMaterial,
  triple: { diff: THREE.Texture; nor: THREE.Texture; rough: THREE.Texture } | undefined,
  extras?: { normalScale?: number },
) {
  if (!triple) return;
  mat.map = triple.diff;
  mat.normalMap = triple.nor;
  mat.normalScale = new THREE.Vector2(extras?.normalScale ?? 0.55, extras?.normalScale ?? 0.55);
  mat.roughnessMap = triple.rough;
  mat.needsUpdate = true;
}

export function createTerrainMaterials(maps?: EnvironmentMaps | null): TerrainMaterialSet {
  const grass = std({
    color: TERRAIN_COLORS.grass,
    roughness: 0.88,
    metalness: 0.0,
    vertexColors: true,
  });
  bindMaps(grass, maps?.grass, { normalScale: 0.4 });

  const dirt = std({
    color: TERRAIN_COLORS.dirt,
    roughness: 0.94,
    metalness: 0.0,
    vertexColors: true,
  });
  bindMaps(dirt, maps?.dirt, { normalScale: 0.5 });

  const rock = std({
    color: TERRAIN_COLORS.rock,
    roughness: 0.7,
    metalness: 0.04,
    vertexColors: true,
  });
  bindMaps(rock, maps?.rock, { normalScale: 0.85 });

  const wetShore = std({
    color: TERRAIN_COLORS.wetShore,
    roughness: 0.32,
    metalness: 0.08,
    vertexColors: true,
  });
  bindMaps(wetShore, maps?.shore, { normalScale: 0.35 });

  const splat = createSplatTerrainMaterial(maps);
  return { grass, dirt, rock, wetShore, splat };
}

/**
 * Height/slope splat over the 160-segment terrain. Vertex colors from colorAt()
 * tint the result (~40%) so biomes stay readable without large flat fills.
 */
function solidTex(r: number, g: number, b: number, srgb = true) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Needles in Three.js r186 ShaderLib.physical (MeshStandardMaterial). */
export const SPLAT_SHADER_NEEDLES = {
  common: "#include <common>",
  worldposVertex: "#include <worldpos_vertex>",
  diffuseColor: "vec4 diffuseColor = vec4( diffuse, opacity );",
  colorFragment: "#include <color_fragment>",
  mapFragment: "#include <map_fragment>",
  roughnessmapFragment: "#include <roughnessmap_fragment>",
} as const;

export type SplatShader = {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
};

function mustReplace(src: string, needle: string, replacement: string, label: string): string {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`aw splat: missing ${label} (${needle})`);
  return src.slice(0, i) + replacement + src.slice(i + needle.length);
}

/**
 * Patch MeshStandardMaterial shaders for world-XZ splat.
 * Three.js color_pars_fragment declares `varying vec4 vColor` under USE_COLOR —
 * `vec3 awVert = vColor` is a GLSL type error and the program fails to compile,
 * which leaves the terrain mesh undrawn (water plane shows through).
 */
export function applySplatShaderPatch(
  shader: SplatShader,
  uniforms: Record<string, { value: unknown }>,
): SplatShader {
  Object.assign(shader.uniforms, uniforms);

  shader.vertexShader = mustReplace(
    shader.vertexShader,
    SPLAT_SHADER_NEEDLES.common,
    `#include <common>
varying vec3 vAwWorldPos;
varying vec3 vAwWorldN;`,
    "vertex common",
  );
  shader.vertexShader = mustReplace(
    shader.vertexShader,
    SPLAT_SHADER_NEEDLES.worldposVertex,
    `#include <worldpos_vertex>
vAwWorldPos = (modelMatrix * vec4( transformed, 1.0 )).xyz;
vAwWorldN = normalize( mat3( modelMatrix ) * objectNormal );`,
    "worldpos_vertex",
  );

  shader.fragmentShader = mustReplace(
    shader.fragmentShader,
    SPLAT_SHADER_NEEDLES.common,
    `#include <common>
varying vec3 vAwWorldPos;
varying vec3 vAwWorldN;
uniform sampler2D uGrassMap;
uniform sampler2D uDirtMap;
uniform sampler2D uRockMap;
uniform sampler2D uShoreMap;
uniform sampler2D uGrassRough;
uniform sampler2D uDirtRough;
uniform sampler2D uRockRough;
uniform sampler2D uShoreRough;
uniform float uWaterLevel;`,
    "fragment common",
  );

  shader.fragmentShader = mustReplace(
    shader.fragmentShader,
    SPLAT_SHADER_NEEDLES.diffuseColor,
    `vec4 diffuseColor = vec4( diffuse, opacity );
float awRough = roughness;
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  vec3 awVert = vColor.rgb;
#else
  vec3 awVert = vec3( 1.0 );
#endif
`,
    "diffuseColor",
  );

  shader.fragmentShader = mustReplace(
    shader.fragmentShader,
    SPLAT_SHADER_NEEDLES.colorFragment,
    `/* aw splat: vertex tint applied in map_fragment via awVert */`,
    "color_fragment",
  );

  shader.fragmentShader = mustReplace(
    shader.fragmentShader,
    SPLAT_SHADER_NEEDLES.mapFragment,
    `{
  vec3 awN = normalize( vAwWorldN );
  float slope = 1.0 - clamp( awN.y, 0.0, 1.0 );
  float h = vAwWorldPos.y;
  float shoreBand = smoothstep( uWaterLevel + 2.5, uWaterLevel + 0.12, h )
    * smoothstep( uWaterLevel - 0.8, uWaterLevel + 0.05, h );
  float rockW = smoothstep( 0.22, 0.55, slope );
  float shoreW = shoreBand * ( 1.0 - rockW * 0.65 );
  float greenness = awVert.g / max( awVert.r + awVert.g + awVert.b, 0.001 );
  float dirtW = ( 1.0 - rockW ) * ( 1.0 - shoreW ) * smoothstep( 0.44, 0.33, greenness );
  float grassW = clamp( 1.0 - rockW - shoreW - dirtW, 0.0, 1.0 );
  float sum = grassW + dirtW + rockW + shoreW + 1e-4;
  grassW /= sum; dirtW /= sum; rockW /= sum; shoreW /= sum;

  vec2 uvG = vAwWorldPos.xz * 0.058;
  vec2 uvD = vAwWorldPos.xz * 0.11;
  vec2 uvR = vAwWorldPos.xz * 0.2;
  vec2 uvS = vAwWorldPos.xz * 0.14;

  vec3 colG = texture2D( uGrassMap, uvG ).rgb;
  vec3 colD = texture2D( uDirtMap, uvD ).rgb;
  vec3 colR = texture2D( uRockMap, uvR ).rgb;
  vec3 colS = texture2D( uShoreMap, uvS ).rgb;
  float rG = texture2D( uGrassRough, uvG ).g;
  float rD = texture2D( uDirtRough, uvD ).g;
  float rR = texture2D( uRockRough, uvR ).g;
  float rS = texture2D( uShoreRough, uvS ).g * 0.55;
  vec3 albedo = colG * grassW + colD * dirtW + colR * rockW + colS * shoreW;
  albedo *= mix( vec3( 1.0 ), awVert, 0.42 );
  albedo *= mix( vec3( 1.0 ), vec3( 0.72, 0.78, 0.76 ), shoreW * 0.7 );
  diffuseColor.rgb *= albedo;
  awRough = rG * grassW + rD * dirtW + rR * rockW + rS * shoreW;
}
`,
    "map_fragment",
  );

  shader.fragmentShader = mustReplace(
    shader.fragmentShader,
    SPLAT_SHADER_NEEDLES.roughnessmapFragment,
    `float roughnessFactor = awRough;
`,
    "roughnessmap_fragment",
  );

  return shader;
}

export function createSplatTerrainMaterial(maps?: EnvironmentMaps | null) {
  const mat = std({
    color: "#ffffff",
    roughness: 0.82,
    metalness: 0.02,
    vertexColors: true,
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
  const grassDiff = maps?.grass.diff ?? solidTex(78, 112, 58);
  const dirtDiff = maps?.dirt.diff ?? solidTex(122, 90, 54);
  const rockDiff = maps?.rock.diff ?? solidTex(109, 103, 96);
  const shoreDiff = maps?.shore.diff ?? solidTex(74, 90, 82);
  const grassRough = maps?.grass.rough ?? solidTex(220, 220, 220, false);
  const dirtRough = maps?.dirt.rough ?? solidTex(240, 240, 240, false);
  const rockRough = maps?.rock.rough ?? solidTex(178, 178, 178, false);
  const shoreRough = maps?.shore.rough ?? solidTex(80, 80, 80, false);
  // Fallback only: if the splat patch is skipped, MeshStandard + vertexColors still draws ground.
  // World-space splat samples uGrassMap, not this mesh UV (which is 0-1 over 384 m).
  mat.map = grassDiff;
  for (const t of [grassDiff, dirtDiff, rockDiff, shoreDiff, grassRough, dirtRough, rockRough, shoreRough]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }

  const splatUniforms = {
    uGrassMap: { value: grassDiff },
    uDirtMap: { value: dirtDiff },
    uRockMap: { value: rockDiff },
    uShoreMap: { value: shoreDiff },
    uGrassRough: { value: grassRough },
    uDirtRough: { value: dirtRough },
    uRockRough: { value: rockRough },
    uShoreRough: { value: shoreRough },
    uWaterLevel: { value: WATER_LEVEL },
  };

  mat.userData.awSplat = { uWaterLevel: splatUniforms.uWaterLevel };
  mat.customProgramCacheKey = () => `aw-splat-v2-${maps ? "tex" : "col"}`;
  mat.onBeforeCompile = (shader) => {
    try {
      applySplatShaderPatch(shader, splatUniforms);
    } catch (err) {
      console.warn("aw splat: patch skipped, using MeshStandard fallback", err);
    }
  };

  return mat;
}

export function createPropMaterials(maps?: EnvironmentMaps | null) {
  const boulder = std({
    color: "#7a746c",
    roughness: 0.76,
    metalness: 0.05,
  });
  bindMaps(boulder, maps?.boulder, { normalScale: 0.7 });
  if (boulder.map) boulder.map.repeat.set(1.4, 1.4);

  const bark = std({
    color: "#5c4a3a",
    roughness: 0.9,
    metalness: 0.0,
  });
  bindMaps(bark, maps?.bark, { normalScale: 0.6 });

  const pineBark = std({
    color: "#4a3a2c",
    roughness: 0.92,
    metalness: 0.0,
  });
  bindMaps(pineBark, maps?.bark, { normalScale: 0.5 });

  const leaf = std({
    color: "#3a5634",
    roughness: 0.76,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const leafB = std({
    color: "#486238",
    roughness: 0.78,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const pine = std({
    color: "#2a4634",
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const grass = std({
    color: "#4d6a3e",
    roughness: 0.86,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  attachGrassWind(grass);

  return { boulder, bark, pineBark, leaf, leafB, pine, grass };
}

function attachGrassWind(mat: THREE.MeshStandardMaterial) {
  const uTime = { value: 0 };
  mat.userData.awGrass = { uTime };
  mat.customProgramCacheKey = () => "aw-grass-wind";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
uniform float uTime;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
{
  vec3 iPos = vec3( 0.0 );
  #ifdef USE_INSTANCING
    iPos = instanceMatrix[ 3 ].xyz;
  #endif
  float wind = sin( uTime * 1.35 + iPos.x * 0.37 + iPos.z * 0.29 ) * 0.13
    + sin( uTime * 0.7 + iPos.z * 0.11 ) * 0.05;
  transformed.xz += vec2( wind, wind * 0.55 ) * max( transformed.y, 0.0 );
}
`,
    );
  };
}

export function updateGrassWind(mat: THREE.Material, time: number) {
  const u = (mat as THREE.MeshStandardMaterial).userData.awGrass as { uTime: { value: number } } | undefined;
  if (u) u.uTime.value = time;
}

export function disposeMaterials(set: { [k: string]: THREE.Material }) {
  for (const m of Object.values(set)) m.dispose();
}
