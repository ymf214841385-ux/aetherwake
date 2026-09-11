import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bladeGeometry, sailGeometry } from "./geometry.ts";
import type { LimbSet } from "./types.ts";

const NAME_ALIASES: Record<string, string[]> = {
  Hips: ["Hips", "hips", "mixamorigHips", "mixamorig:Hips", "pelvis", "Root"],
  Chest: ["Chest", "chest", "Spine1", "Spine2", "mixamorigSpine1", "mixamorigSpine2", "spine_02", "UpperChest"],
  Head: ["Head", "head", "mixamorigHead", "mixamorig:Head"],
  // GLTFLoader sanitizes Blender's dotted bone names when creating Object3Ds:
  // `upper_arm.R` becomes `upper_armR` and `hand.R` becomes `handR`.
  L_UpperArm: ["L_UpperArm", "LeftArm", "mixamorigLeftArm", "mixamorig:LeftArm", "upper_arm.L", "upper_armL", "LeftUpperArm"],
  R_UpperArm: ["R_UpperArm", "RightArm", "mixamorigRightArm", "mixamorig:RightArm", "upper_arm.R", "upper_armR", "RightUpperArm"],
  L_UpLeg: ["L_UpLeg", "LeftUpLeg", "mixamorigLeftUpLeg", "mixamorig:LeftUpLeg", "thigh.L", "thighL", "LeftUpperLeg"],
  R_UpLeg: ["R_UpLeg", "RightUpLeg", "mixamorigRightUpLeg", "mixamorig:RightUpLeg", "thigh.R", "thighR", "RightUpperLeg"],
};

// Measured from the v4 GLB rather than guessed from the rendered frame:
// `hand.R` is a 0.22965 m long distal bone and its local +Y runs wrist → palm.
// The procedural grip occupies local Y [-0.11, 0.01].  Placing its parent at
// +0.145 centers that grip at +0.095 (about 41% along the palm) and leaves the
// blade beginning beyond the hand.  Identity rotation retains that measured
// palm axis through the authored Attack sweep.
export const V4_HAND_R_SWORD_SOCKET = {
  position: new THREE.Vector3(0, 0.145, 0),
  rotation: new THREE.Euler(0, 0, 0),
} as const;

function findNamed(root: THREE.Object3D, names: string[]): THREE.Object3D | undefined {
  for (const n of names) {
    const o = root.getObjectByName(n);
    if (o) return o;
  }
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (found) return;
    if (names.includes(o.name)) found = o;
  });
  return found;
}

export function resolveCharacterRigNodes(root: THREE.Object3D) {
  const hips = findNamed(root, NAME_ALIASES.Hips) ?? root;
  const chest = findNamed(root, NAME_ALIASES.Chest) ?? hips;
  return {
    hips,
    chest,
    head: findNamed(root, NAME_ALIASES.Head) ?? chest,
    larm: findNamed(root, NAME_ALIASES.L_UpperArm) ?? chest,
    rarm: findNamed(root, NAME_ALIASES.R_UpperArm) ?? chest,
    lleg: findNamed(root, NAME_ALIASES.L_UpLeg) ?? hips,
    rleg: findNamed(root, NAME_ALIASES.R_UpLeg) ?? hips,
  };
}

function markHierarchyRest(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone || o.name) {
      o.userData.rest = {
        x: o.rotation.x,
        y: o.rotation.y,
        z: o.rotation.z,
        px: o.position.x,
        py: o.position.y,
        pz: o.position.z,
      };
    }
  });
}

function collectSkeleton(root: THREE.Object3D): THREE.Skeleton | undefined {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  if (!bones.length) return undefined;
  return new THREE.Skeleton(bones);
}

export function createRuntimeGear() {
  const leather = new THREE.MeshStandardMaterial({ color: "#382218", roughness: 0.72, metalness: 0.02 });
  const steel = new THREE.MeshStandardMaterial({ color: "#8b9499", roughness: 0.36, metalness: 0.82 });
  const steelDark = new THREE.MeshStandardMaterial({ color: "#30373c", roughness: 0.42, metalness: 0.74 });
  const fabric = new THREE.MeshStandardMaterial({ color: "#d8c4a0", roughness: 0.84, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: "#5a3a22", roughness: 0.82 });

  const sword = new THREE.Group();
  sword.name = "RuntimeSword";
  // Reuse the existing in-game weapon silhouette. The grip origin is the
  // hand socket, so the palm closes around the handle rather than the blade.
  const blade = new THREE.Mesh(bladeGeometry(), steel);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.03), steelDark);
  guard.position.y = 0.01;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.1, 8), leather);
  grip.position.y = -0.05;
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.08, 8), leather);
  wrap.position.y = -0.05;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), steelDark);
  pommel.position.y = -0.11;
  sword.add(blade, guard, grip, wrap, pommel);
  // This is the legacy/default loaded-rig placement. The dotted v4 hand gets
  // its measured palm socket in ensureGear below; other rigs retain their
  // existing gameplay presentation.
  sword.position.set(0.02, -0.05, 0.02);
  sword.rotation.set(-0.2, 0, 0.12);

  const slate = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.145, 0.022), new THREE.MeshStandardMaterial({ color: "#426f6d", roughness: 0.48 }));
  slate.name = "RuntimeSlate";
  slate.position.set(-0.015, -0.03, 0.035);

  const glider = new THREE.Group();
  glider.name = "RuntimeGlider";
  const sail = new THREE.Mesh(sailGeometry(1.55, 0.85), fabric);
  sail.position.set(0, 0.12, -0.02);
  const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.5, 6), wood);
  spar.rotation.z = Math.PI / 2;
  spar.position.set(0, 0.42, 0.02);
  glider.add(sail, spar);
  for (let i = 0; i < 5; i++) {
    const x = (i / 4 - 0.5) * 1.35;
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.01, 0.82, 5), wood);
    rib.position.set(x, 0.1, 0.02);
    rib.rotation.set(0.12, 0, -x * 0.18);
    glider.add(rib);
  }
  glider.position.set(0, 0.38, -0.12);
  glider.visible = false;
  return { sword, slate, glider };
}

export function attachMeasuredV4SwordSocket(hand: THREE.Object3D, sword: THREE.Object3D) {
  hand.add(sword);
  sword.position.copy(V4_HAND_R_SWORD_SOCKET.position);
  sword.rotation.copy(V4_HAND_R_SWORD_SOCKET.rotation);
  sword.userData.attachment = "v4-hand.R-measured-palm-axis";
}

export function ensureGear(set: LimbSet) {
  if (!set.sword.parent) {
    const hand = set.rarm.getObjectByName("R_Hand") ?? set.rarm.getObjectByName("hand.R") ?? set.rarm.getObjectByName("handR") ?? set.rarm;
    if (hand.name === "hand.R" || hand.name === "handR") attachMeasuredV4SwordSocket(hand, set.sword);
    else hand.add(set.sword);
  }
  if (!set.glider.parent) {
    set.torso.add(set.glider);
  }
  if (!set.slate.parent) {
    (set.larm.getObjectByName("L_Hand") ?? set.larm.getObjectByName("hand.L") ?? set.larm.getObjectByName("handL") ?? set.larm).add(set.slate);
  }
}

const V4_PREVIEW_GLB_URL = "/__terra-preview/wanderer-v4.glb";
// `import.meta.env` is injected by Vite. Keeping this safe for the Node
// character tests lets them exercise the measured attachment helper too.
const useV4Preview = typeof import.meta.env !== "undefined" && import.meta.env.VITE_TERRA_CHARACTER_CANDIDATE === "v4";
// The candidate keeps its authored normal image and UV layout. Browser review
// found high-contrast seams on the photographed face/neck where the exported
// mesh has normal/UV splits, so use a deliberately modest response only in the
// opt-in v4 preview. The source PBR images remain untouched in the GLB.
const V4_RUNTIME_NORMAL_SCALE = 0.45;

// This opt-in URL is served only by the worktree-local Vite preview middleware.
// The shipping v1 URL remains untouched and is the default in every normal run.
export const DEFAULT_GLB_URL = useV4Preview ? V4_PREVIEW_GLB_URL : "/assets/character/wanderer.glb";

function setLoadStatus(status: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  (window as Window & { __AW_CHARACTER_LOAD?: Record<string, unknown> }).__AW_CHARACTER_LOAD = status;
}

function tuneV4PreviewMaterials(root: THREE.Object3D) {
  if (!useV4Preview) return 0;
  let tuned = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.normalMap) continue;
      material.normalScale.setScalar(V4_RUNTIME_NORMAL_SCALE);
      tuned += 1;
    }
  });
  return tuned;
}

export function disposeRiggedGLB(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value && typeof value === "object" && "isTexture" in value && value.isTexture) value.dispose();
        }
        material.dispose();
      }
    }
  });
}

export async function loadRiggedGLB(url = DEFAULT_GLB_URL): Promise<LimbSet | null> {
  try {
    setLoadStatus({ status: "loading", source: url });
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.name = root.name || "WandererGLB";
    markHierarchyRest(root);
    const tunedNormalMaterials = tuneV4PreviewMaterials(root);

    const nodes = resolveCharacterRigNodes(root);

    const gear = createRuntimeGear();
    const set: LimbSet = {
      root,
      torso: nodes.chest,
      head: nodes.head,
      larm: nodes.larm,
      rarm: nodes.rarm,
      lleg: nodes.lleg,
      rleg: nodes.rleg,
      sword: gear.sword,
      glider: gear.glider,
      slate: gear.slate,
      skeleton: collectSkeleton(root),
    };
    ensureGear(set);
    root.userData.source = url;
    root.userData.kind = "wanderer-glb";
    root.userData.mixer = new THREE.AnimationMixer(root);
    root.userData.clips = gltf.animations;
    setLoadStatus({
      status: "ready",
      source: url,
      clips: gltf.animations.map((clip) => ({ name: clip.name, duration: clip.duration })),
      bones: set.skeleton?.bones.length ?? 0,
      normalMapScale: useV4Preview ? V4_RUNTIME_NORMAL_SCALE : 1,
      tunedNormalMaterials,
    });
    return set;
  } catch (error) {
    console.error("Unable to load the authored wanderer GLB", error);
    setLoadStatus({ status: "loadererror", source: url, error: String(error) });
    return null;
  }
}
