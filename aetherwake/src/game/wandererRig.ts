export type { AnimState, LimbSet, LodLevel } from "./character/types.ts";
export { createSkinnedWanderer, createWandererLod, WANDERER_BONES, WANDERER_FORWARD, WANDERER_HEIGHT } from "./character/build.ts";
export { animateSkinnedWanderer } from "./character/animate.ts";
export { disposeRiggedGLB, loadRiggedGLB, DEFAULT_GLB_URL } from "./character/loader.ts";
export { createWandererMaterials } from "./character/materials.ts";
