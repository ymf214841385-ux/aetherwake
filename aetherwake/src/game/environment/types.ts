import type * as THREE from "three";

export type LodLevel = "high" | "mid" | "low";

export type QualityTier = "low" | "mid" | "high";

export type InstanceItem = {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  kind?: number;
};

export type LodGeometries = {
  high: THREE.BufferGeometry;
  mid: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
};

export type TextureTriple = {
  diff: THREE.Texture;
  nor: THREE.Texture;
  rough: THREE.Texture;
};

export type EnvironmentMaps = {
  grass: TextureTriple;
  dirt: TextureTriple;
  rock: TextureTriple;
  shore: TextureTriple;
  boulder: TextureTriple;
  bark: TextureTriple;
};
