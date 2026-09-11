import * as THREE from "three";
import { HALF, LAKE, WATER_LEVEL, WORLD_SIZE } from "../height.ts";

export type WaterMaterial = THREE.MeshStandardMaterial & {
  userData: { awWater: { uTime: { value: number } } };
};

export function createWaterMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.22,
    metalness: 0.06,
    transparent: true,
    opacity: 0.86,
    depthWrite: true,
    envMapIntensity: 0.55,
  });

  const uTime = { value: 0 };
  const uWaterLevel = { value: WATER_LEVEL };
  const uHalf = { value: HALF };
  const uLake = { value: new THREE.Vector2(LAKE.x, LAKE.z) };
  const uShallow = { value: new THREE.Color("#5c7e72") };
  const uDeep = { value: new THREE.Color("#102430") };
  const uFoam = { value: new THREE.Color("#dce6de") };
  const uRippleStrength = { value: 0.042 };

  mat.userData.awWater = { uTime };
  mat.customProgramCacheKey = () => "aw-water-v1";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uWaterLevel = uWaterLevel;
    shader.uniforms.uHalf = uHalf;
    shader.uniforms.uLake = uLake;
    shader.uniforms.uShallow = uShallow;
    shader.uniforms.uDeep = uDeep;
    shader.uniforms.uFoam = uFoam;
    shader.uniforms.uRippleStrength = uRippleStrength;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
uniform float uTime;
uniform float uRippleStrength;
varying vec3 vAwWorldPos;
varying float vAwRipple;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
{
  float rip = sin( transformed.x * 0.31 + uTime * 0.75 ) * uRippleStrength
    + sin( transformed.y * 0.24 + uTime * 0.58 ) * uRippleStrength * 0.7;
  transformed.z += rip;
  vAwRipple = rip;
}
`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vAwWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
uniform float uTime;
uniform float uWaterLevel;
uniform float uHalf;
uniform vec2 uLake;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
varying vec3 vAwWorldPos;
varying float vAwRipple;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `{
  float lake = length( vAwWorldPos.xz - uLake );
  float radial = length( vAwWorldPos.xz ) / max( uHalf, 1.0 );
  float depth = 1.4;
  depth += smoothstep( 56.0, 12.0, lake ) * 9.0;
  depth += smoothstep( 0.76, 1.05, radial ) * 11.0;
  #ifdef AW_USE_DEPTH
    depth = mix( depth, vAwDepth, 0.85 );
  #endif
  float foam = 1.0 - smoothstep( 0.08, 1.45, depth );
  vec3 col = mix( uShallow, uDeep, smoothstep( 0.45, 7.5, depth ) );
  col = mix( col, uFoam, foam * 0.5 );
  float sparkle = pow( abs( vAwRipple ) * 18.0, 2.0 ) * 0.08;
  col += vec3( 0.12, 0.14, 0.13 ) * sparkle;
  diffuseColor.rgb *= col;
  roughnessFactor = mix( 0.34, 0.14, smoothstep( 0.4, 6.0, depth ) );
  roughnessFactor = mix( roughnessFactor, 0.55, foam );
}
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `vec4 diffuseColor = vec4( diffuse, opacity );
float roughnessFactor = roughness;
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `roughnessFactor = roughnessFactor;
`,
    );
  };

  return mat;
}

export function updateWaterMaterial(mat: THREE.Material, time: number) {
  const u = (mat as THREE.MeshStandardMaterial).userData.awWater as { uTime: { value: number } } | undefined;
  if (u) u.uTime.value = time;
}

export type WaterHandle = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  update: (time: number) => void;
  dispose: () => void;
};

export function createWaterMesh(opts?: {
  size?: number;
  segments?: number;
  heightAt?: (x: number, z: number) => number;
}): WaterHandle {
  const size = opts?.size ?? WORLD_SIZE * 1.4;
  const segments = opts?.segments ?? 32;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  const material = createWaterMaterial();

  if (opts?.heightAt) {
    const pos = geo.attributes.position!;
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      depth[i] = WATER_LEVEL - opts.heightAt(x, z);
    }
    geo.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
    material.defines = { ...material.defines, AW_USE_DEPTH: 1 };
    material.onBeforeCompile = chainedDepth(material.onBeforeCompile);
  }

  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, WATER_LEVEL, 0);
  mesh.receiveShadow = true;
  mesh.name = "aw-water";
  return {
    mesh,
    material,
    update: (time) => updateWaterMaterial(material, time),
    dispose: () => {
      geo.dispose();
      material.dispose();
    },
  };
}

function chainedDepth(
  prev: THREE.MeshStandardMaterial["onBeforeCompile"],
): THREE.MeshStandardMaterial["onBeforeCompile"] {
  return (shader, renderer) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
attribute float aDepth;
varying float vAwDepth;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vAwDepth = aDepth;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying float vAwDepth;`,
    );
    if (prev) prev(shader, renderer);
  };
}

/** Scene currently bobs the whole plane; prefer vertex ripples, keep a tiny rest pose. */
export function waterRestY(time: number) {
  return WATER_LEVEL + Math.sin(time * 0.6) * 0.02;
}
