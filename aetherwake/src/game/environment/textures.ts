import * as THREE from "three";
import type { EnvironmentMaps, TextureTriple } from "./types.ts";

export const ENV_PUBLIC_PATH = "/assets/environment";

export const TEXTURE_FILES = {
  grass: {
    diff: `${ENV_PUBLIC_PATH}/grass_diff_1k.jpg`,
    nor: `${ENV_PUBLIC_PATH}/grass_nor_gl_1k.jpg`,
    rough: `${ENV_PUBLIC_PATH}/grass_rough_1k.jpg`,
  },
  dirt: {
    diff: `${ENV_PUBLIC_PATH}/dirt_diff_1k.jpg`,
    nor: `${ENV_PUBLIC_PATH}/dirt_nor_gl_1k.jpg`,
    rough: `${ENV_PUBLIC_PATH}/dirt_rough_1k.jpg`,
  },
  rock: {
    diff: `${ENV_PUBLIC_PATH}/rock_diff_1k.jpg`,
    nor: `${ENV_PUBLIC_PATH}/rock_nor_gl_1k.jpg`,
    rough: `${ENV_PUBLIC_PATH}/rock_rough_1k.jpg`,
  },
  shore: {
    diff: `${ENV_PUBLIC_PATH}/shore_diff_1k.jpg`,
    nor: `${ENV_PUBLIC_PATH}/shore_nor_gl_1k.jpg`,
    rough: `${ENV_PUBLIC_PATH}/shore_rough_1k.jpg`,
  },
  boulder: {
    diff: `${ENV_PUBLIC_PATH}/boulder_diff_1k.jpg`,
    nor: `${ENV_PUBLIC_PATH}/boulder_nor_gl_1k.jpg`,
    rough: `${ENV_PUBLIC_PATH}/boulder_rough_1k.jpg`,
  },
  bark: {
    diff: `${ENV_PUBLIC_PATH}/bark_diff_1k.jpg`,
    nor: `${ENV_PUBLIC_PATH}/bark_nor_gl_1k.jpg`,
    rough: `${ENV_PUBLIC_PATH}/bark_rough_1k.jpg`,
  },
} as const;

export const HDRI_PATH = `${ENV_PUBLIC_PATH}/hdri_day_1k.hdr`;

function configureMap(tex: THREE.Texture, color: boolean, anisotropy: number, repeat: number) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.max(1, anisotropy);
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function applyAnisotropy(maps: EnvironmentMaps, anisotropy: number) {
  const a = Math.max(1, anisotropy);
  const all: THREE.Texture[] = [];
  for (const key of Object.keys(maps) as (keyof EnvironmentMaps)[]) {
    all.push(maps[key].diff, maps[key].nor, maps[key].rough);
  }
  for (const t of all) t.anisotropy = a;
}

function loadOne(loader: THREE.TextureLoader, url: string) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(url, resolve, undefined, () => reject(new Error(`texture failed: ${url}`)));
  });
}

async function loadTriple(
  loader: THREE.TextureLoader,
  files: { diff: string; nor: string; rough: string },
  anisotropy: number,
  repeat: number,
): Promise<TextureTriple> {
  const [diff, nor, rough] = await Promise.all([
    loadOne(loader, files.diff),
    loadOne(loader, files.nor),
    loadOne(loader, files.rough),
  ]);
  configureMap(diff, true, anisotropy, repeat);
  configureMap(nor, false, anisotropy, repeat);
  configureMap(rough, false, anisotropy, repeat);
  return { diff, nor, rough };
}

/** World-space tiling is applied in the splat shader; these repeats are for standalone materials. */
const STANDALONE_REPEAT = {
  grass: 18,
  dirt: 28,
  rock: 42,
  shore: 32,
  boulder: 2.2,
  bark: 1.6,
} as const;

export async function loadEnvironmentMaps(anisotropy = 4): Promise<EnvironmentMaps> {
  const loader = new THREE.TextureLoader();
  const [grass, dirt, rock, shore, boulder, bark] = await Promise.all([
    loadTriple(loader, TEXTURE_FILES.grass, anisotropy, STANDALONE_REPEAT.grass),
    loadTriple(loader, TEXTURE_FILES.dirt, anisotropy, STANDALONE_REPEAT.dirt),
    loadTriple(loader, TEXTURE_FILES.rock, anisotropy, STANDALONE_REPEAT.rock),
    loadTriple(loader, TEXTURE_FILES.shore, anisotropy, STANDALONE_REPEAT.shore),
    loadTriple(loader, TEXTURE_FILES.boulder, anisotropy, STANDALONE_REPEAT.boulder),
    loadTriple(loader, TEXTURE_FILES.bark, anisotropy, STANDALONE_REPEAT.bark),
  ]);
  return { grass, dirt, rock, shore, boulder, bark };
}

export async function loadDayEnvironment(renderer: THREE.WebGLRenderer): Promise<THREE.Texture | null> {
  try {
    const { RGBELoader } = await import("three/examples/jsm/loaders/RGBELoader.js");
    const hdr = await new Promise<THREE.DataTexture>((resolve, reject) => {
      new RGBELoader().load(HDRI_PATH, resolve, undefined, () => reject(new Error("hdri failed")));
    });
    const gen = new THREE.PMREMGenerator(renderer);
    const env = gen.fromEquirectangular(hdr).texture;
    hdr.dispose();
    gen.dispose();
    return env;
  } catch {
    return null;
  }
}

export function disposeMaps(maps: EnvironmentMaps | null | undefined) {
  if (!maps) return;
  for (const key of Object.keys(maps) as (keyof EnvironmentMaps)[]) {
    maps[key].diff.dispose();
    maps[key].nor.dispose();
    maps[key].rough.dispose();
  }
}
