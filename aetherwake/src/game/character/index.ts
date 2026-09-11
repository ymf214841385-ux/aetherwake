export type { AnimState, LimbSet, LodLevel } from "./types.ts";
export { createSkinnedWanderer, createWandererLod, WANDERER_BONES, WANDERER_FORWARD, WANDERER_HEIGHT } from "./build.ts";
export { animateSkinnedWanderer } from "./animate.ts";
export { loadRiggedGLB, DEFAULT_GLB_URL } from "./loader.ts";
export { createWandererMaterials } from "./materials.ts";
