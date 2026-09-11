import * as THREE from "three";

/**
 * True vertex skinning for the procedural wanderer.
 *
 * Body and clothing parts are baked into bind-pose world space (root local),
 * then bound to the shared skeleton with proximity weights: a vertex blends
 * the bones whose bind segments are nearest, so elbows/knees/shoulders/spine
 * deform continuously instead of rigid sub-parts shearing apart. This is what
 * separates a skinned character from an assembled doll.
 *
 * Head/face/hair stay rigid children of the Head bone (a head is effectively
 * rigid; this keeps the face features perfectly registered). Fingers stay
 * rigid on their tiny bones. Sword/slate/glider stay rigid attachments.
 */

export type BoneSeg = {
  name: string;
  index: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
};

export type SkinRig = {
  segs: BoneSeg[];
  boneIndex: Map<string, number>;
  boneCount: number;
};

/** Bones that drive skin deformation. Order matches the skeleton bone list. */
export const SKIN_DRIVER_BONES = [
  "Hips",
  "Spine",
  "Chest",
  "Neck",
  "Head",
  "L_Clavicle",
  "R_Clavicle",
  "L_UpperArm",
  "R_UpperArm",
  "L_ForeArm",
  "R_ForeArm",
  "L_Hand",
  "R_Hand",
  "L_UpLeg",
  "R_UpLeg",
  "L_Leg",
  "R_Leg",
  "L_Foot",
  "R_Foot",
  "L_Toe",
  "R_Toe",
] as const;

/** Bind-pose segments from bone origins toward their first child bone. */
export function buildSkinRig(root: THREE.Object3D, bones: THREE.Bone[]): SkinRig {
  root.updateMatrixWorld(true);
  const all = new Map<string, THREE.Bone>();
  for (const b of bones) all.set(b.name, b);
  // skinIndex must address the bound Skeleton's bones array (full traverse
  // order, including finger bones), not the driver list order — otherwise
  // every weight lands on the wrong bone.
  const skeletonIndex = new Map<string, number>();
  bones.forEach((b, i) => skeletonIndex.set(b.name, i));
  const segs: BoneSeg[] = [];
  const boneIndex = new Map<string, number>();
  SKIN_DRIVER_BONES.forEach((name) => {
    const bone = all.get(name);
    const a = new THREE.Vector3();
    let b: THREE.Vector3;
    if (bone) {
      bone.getWorldPosition(a);
      let child: THREE.Vector3 | null = null;
      for (const c of bone.children) {
        if ((c as THREE.Bone).isBone && boneIndex.has(c.name)) continue;
        if ((c as THREE.Bone).isBone) {
          child = new THREE.Vector3();
          (c as THREE.Bone).getWorldPosition(child);
          break;
        }
      }
      if (child) {
        b = child;
      } else {
        // Leaf driver (Head, Hand, Foot, Toe): extend along local -Y (limbs)
        // or a short stub; the exact direction only nudges weighting.
        const dir = new THREE.Vector3(0, -0.1, 0).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
        b = a.clone().add(dir);
      }
    } else {
      a.set(0, 0, 0);
      b = a.clone().add(new THREE.Vector3(0, -0.1, 0));
    }
    const i = skeletonIndex.get(name);
    if (i === undefined) {
      throw new Error(`skinning: driver bone ${name} missing from skeleton`);
    }
    boneIndex.set(name, i);
    segs.push({ name, index: i, a, b });
  });
  return { segs, boneIndex, boneCount: bones.length };
}

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _q = new THREE.Vector3();

function distPointSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  _ab.subVectors(b, a);
  const l2 = _ab.lengthSq() || 1;
  _ap.subVectors(p, a);
  const t = Math.min(1, Math.max(0, _ap.dot(_ab) / l2));
  _q.copy(a).addScaledVector(_ab, t);
  return p.distanceTo(_q);
}

export type WeightOpts = {
  /** How many bones a vertex may blend. */
  maxBones?: number;
  /** Sharpness: higher = crisper part interiors, softer only near joints. */
  power?: number;
  /** Softening term (m^power) so exact-axis vertices stay finite. */
  soft?: number;
  /** If set, only these driver bone names are considered. */
  filter?: ReadonlySet<string>;
};

/**
 * Proximity skin weights, normalized by the part's own radius so a wide vest
 * does not turn to mush while a thin wrist still blends at the wrist joint.
 *
 * Mutates `geo`: adds skinIndex/skinWeight (Uint16/Float32, 4 channels).
 */
export function assignSkinWeights(geo: THREE.BufferGeometry, rig: SkinRig, opts: WeightOpts = {}) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const maxBones = Math.min(4, Math.max(2, opts.maxBones ?? 3));
  const power = opts.power ?? 2.6;
  const soft = opts.soft ?? 0.0009;
  const v = new THREE.Vector3();

  // Part radius: 90th percentile distance from vertices to their nearest segment.
  const nearest = new Float32Array(count);
  const samples: number[] = [];
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i);
    let best = Infinity;
    for (const s of rig.segs) {
      const d = distPointSeg(v, s.a, s.b);
      if (d < best) best = d;
    }
    nearest[i] = best;
    if (i % 7 === 0) samples.push(best);
  }
  samples.sort((x, y) => x - y);
  const radius = Math.max(0.05, samples[Math.floor(samples.length * 0.9)] ?? 0.2);

  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const cand: { idx: number; w: number }[] = [];
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i);
    cand.length = 0;
    for (const s of rig.segs) {
      if (opts.filter && !opts.filter.has(s.name)) continue;
      const d = distPointSeg(v, s.a, s.b) / radius;
      cand.push({ idx: s.index, w: 1 / (Math.pow(d, power) + soft) });
    }
    cand.sort((x, y) => y.w - x.w);
    const use = cand.slice(0, maxBones);
    let sum = 0;
    for (const c of use) sum += c.w;
    if (use.length === 0 || sum <= 0) {
      skinIndex[i * 4] = rig.segs[0]?.index ?? 0;
      skinWeight[i * 4] = 1;
      continue;
    }
    for (let k = 0; k < 4; k++) {
      if (k < use.length) {
        skinIndex[i * 4 + k] = use[k]!.idx;
        skinWeight[i * 4 + k] = use[k]!.w / sum;
      } else {
        skinIndex[i * 4 + k] = 0;
        skinWeight[i * 4 + k] = 0;
      }
    }
  }
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  return { radius };
}

export type PartSpec = {
  /** Bone the part was authored against (bind space anchor). */
  bone: THREE.Bone;
  /** Geometry in bone-local space (a fresh instance per part; never shared). */
  geo: THREE.BufferGeometry;
  material: THREE.Material;
  name: string;
  /** Local transform relative to the bone, as the old rigid parent used. */
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  visible?: boolean;
  /**
   * If set, every vertex is weighted 100% to this bone (still a SkinnedMesh
   * on the shared skeleton). Used for rigid gear like boots so a shaft/sole
   * pair does not tear when proximity would split them across Leg/Foot.
   */
  lockBone?: THREE.Bone;
  /** Limit proximity weights to these driver names (keeps skirts off the arms). */
  weightBones?: readonly string[];
  /** Override proximity sharpness (higher = less mush on wide shells like the vest). */
  weightPower?: number;
  maxBones?: number;
};

/**
 * Bake parts into bind-pose root space, assign skin weights, and return
 * SkinnedMeshes bound to `skeleton` with an identity bind matrix. Call after
 * root.updateMatrixWorld(true) on the rest pose and after the Skeleton was
 * constructed (bone inverses captured from the same pose).
 */
export function buildSkinnedParts(
  root: THREE.Object3D,
  parts: PartSpec[],
  skeleton: THREE.Skeleton,
  rig: SkinRig,
): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  const boneWorld = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  for (const part of parts) {
    boneWorld.copy(part.bone.matrixWorld);
    local.compose(
      new THREE.Vector3(...(part.position ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]))),
      new THREE.Vector3(...(part.scale ?? [1, 1, 1])),
    );
    world.multiplyMatrices(boneWorld, local);
    part.geo.applyMatrix4(world);
    if (part.lockBone) {
      const idx = rig.boneIndex.get(part.lockBone.name);
      if (idx === undefined) {
        throw new Error(`skinning: lockBone ${part.lockBone.name} missing from rig`);
      }
      const count = (part.geo.attributes.position as THREE.BufferAttribute).count;
      const skinIndex = new Uint16Array(count * 4);
      const skinWeight = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        skinIndex[i * 4] = idx;
        skinWeight[i * 4] = 1;
      }
      part.geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
      part.geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
    } else {
      assignSkinWeights(part.geo, rig, {
        filter: part.weightBones ? new Set(part.weightBones) : undefined,
        power: part.weightPower,
        maxBones: part.maxBones,
      });
    }
    part.geo.computeBoundingBox();
    part.geo.computeBoundingSphere();
    const sm = new THREE.SkinnedMesh(part.geo, part.material);
    sm.name = part.name;
    sm.castShadow = true;
    sm.receiveShadow = true;
    sm.frustumCulled = false;
    if (part.visible === false) sm.visible = false;
    sm.bind(skeleton, new THREE.Matrix4());
    root.add(sm);
    out.push(sm);
  }
  return out;
}
