import * as THREE from "three";
import { ATTACK_ACTIVE, ATTACK_RECOVER, ATTACK_WINDUP } from "../params.ts";
import type { AnimState, LimbSet, RestEuler } from "./types.ts";

type BoneRef = {
  hips: THREE.Bone;
  spine: THREE.Bone;
  chest: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  lClav: THREE.Bone;
  rClav: THREE.Bone;
  lArm: THREE.Bone;
  rArm: THREE.Bone;
  lFore: THREE.Bone;
  rFore: THREE.Bone;
  lHand: THREE.Bone;
  rHand: THREE.Bone;
  lUp: THREE.Bone;
  rUp: THREE.Bone;
  lLeg: THREE.Bone;
  rLeg: THREE.Bone;
  lFoot: THREE.Bone;
  rFoot: THREE.Bone;
  lToe: THREE.Bone | null;
  rToe: THREE.Bone | null;
};

type Pose = {
  hips: THREE.Euler;
  spine: THREE.Euler;
  chest: THREE.Euler;
  neck: THREE.Euler;
  head: THREE.Euler;
  lClav: THREE.Euler;
  rClav: THREE.Euler;
  lArm: THREE.Euler;
  rArm: THREE.Euler;
  lFore: THREE.Euler;
  rFore: THREE.Euler;
  lHand: THREE.Euler;
  rHand: THREE.Euler;
  lUp: THREE.Euler;
  rUp: THREE.Euler;
  lLeg: THREE.Euler;
  rLeg: THREE.Euler;
  lFoot: THREE.Euler;
  rFoot: THREE.Euler;
  lToe: THREE.Euler;
  rToe: THREE.Euler;
  hipY: number;
  sword: THREE.Euler;
};

const AUTHORED_CLIP_BY_STATE: Partial<Record<AnimState, string>> = {
  idle: "Idle",
  walk: "Walk",
  run: "Run",
  attack: "Attack",
  climb: "Climb",
  glide: "Glide",
};

const CLIP_CROSSFADE_SECONDS = 0.16;
// Gameplay melee lasts 0.40 s (windup + active + recovery), whereas the
// authored candidate's Attack clip is 1.033 s. Play that visual action over
// the real combat window so capture can observe the actual mid-slash rather
// than a visually static early pose. This changes no combat timing or damage.
const ATTACK_PRESENTATION_SECONDS = ATTACK_WINDUP + ATTACK_ACTIVE + ATTACK_RECOVER;

function setAnimationStatus(status: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  (window as Window & { __AW_CHARACTER_ANIMATION?: Record<string, unknown> }).__AW_CHARACTER_ANIMATION = status;
}

const KEYS: (keyof Omit<Pose, "hipY" | "sword">)[] = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "lClav",
  "rClav",
  "lArm",
  "rArm",
  "lFore",
  "rFore",
  "lHand",
  "rHand",
  "lUp",
  "rUp",
  "lLeg",
  "rLeg",
  "lFoot",
  "rFoot",
  "lToe",
  "rToe",
];

function ez(x = 0, y = 0, z = 0) {
  return new THREE.Euler(x, y, z);
}

function restOf(b: THREE.Object3D | null): RestEuler {
  const r = b?.userData.rest as RestEuler | undefined;
  return r ?? { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0 };
}

function cacheBones(f: LimbSet): BoneRef {
  const existing = f.root.userData.boneRef as BoneRef | undefined;
  if (existing) return existing;
  // The authored Meshy/Blender rig uses lower-case dotted names; the previous
  // in-engine rig used PascalCase. Resolve both without renaming nodes, so
  // AnimationMixer tracks keep their original targets.
  const by = (...names: string[]) => {
    for (const name of names) {
      const found = f.root.getObjectByName(name);
      if (found) return found as THREE.Bone;
    }
    return null;
  };
  const ref: BoneRef = {
    hips: by("Hips", "hips", "pelvis") ?? (f.root.children[0] as THREE.Bone),
    spine: by("Spine", "spine") as THREE.Bone,
    chest: f.torso as THREE.Bone,
    neck: by("Neck", "neck") as THREE.Bone,
    head: f.head as THREE.Bone,
    lClav: by("L_Clavicle", "clavicle.L", "clavicleL") as THREE.Bone,
    rClav: by("R_Clavicle", "clavicle.R", "clavicleR") as THREE.Bone,
    lArm: f.larm as THREE.Bone,
    rArm: f.rarm as THREE.Bone,
    lFore: by("L_ForeArm", "forearm.L", "forearmL") as THREE.Bone,
    rFore: by("R_ForeArm", "forearm.R", "forearmR") as THREE.Bone,
    lHand: by("L_Hand", "hand.L", "handL") as THREE.Bone,
    rHand: by("R_Hand", "hand.R", "handR") as THREE.Bone,
    lUp: f.lleg as THREE.Bone,
    rUp: f.rleg as THREE.Bone,
    lLeg: by("L_Leg", "shin.L", "shinL") as THREE.Bone,
    rLeg: by("R_Leg", "shin.R", "shinR") as THREE.Bone,
    lFoot: by("L_Foot", "foot.L", "footL") as THREE.Bone,
    rFoot: by("R_Foot", "foot.R", "footR") as THREE.Bone,
    lToe: by("L_Toe", "toe.L", "toeL"),
    rToe: by("R_Toe", "toe.R", "toeR"),
  };
  f.root.userData.boneRef = ref;
  return ref;
}

function zeroPose(hipY: number): Pose {
  return {
    hips: ez(),
    spine: ez(),
    chest: ez(),
    neck: ez(),
    head: ez(),
    lClav: ez(),
    rClav: ez(),
    lArm: ez(),
    rArm: ez(),
    lFore: ez(),
    rFore: ez(),
    lHand: ez(),
    rHand: ez(),
    lUp: ez(),
    rUp: ez(),
    lLeg: ez(),
    rLeg: ez(),
    lFoot: ez(),
    rFoot: ez(),
    lToe: ez(),
    rToe: ez(),
    hipY,
    sword: ez(-0.2, 0, 0.12),
  };
}

function locomote(p: Pose, t: number, freq: number, amp: number, run: boolean, swim = false) {
  const s = Math.sin(t * freq);
  const c = Math.cos(t * freq);
  const lift = Math.max(0, Math.sin(t * freq * 2));
  p.lUp.x = s * amp;
  p.rUp.x = -s * amp;
  p.lUp.z = 0.03 + s * 0.02;
  p.rUp.z = -0.03 - s * 0.02;
  p.lLeg.x = Math.max(0, s) * amp * 1.12 + (run ? 0.18 : 0.08) + Math.max(0, -c) * amp * 0.16;
  p.rLeg.x = Math.max(0, -s) * amp * 1.12 + (run ? 0.18 : 0.08) + Math.max(0, c) * amp * 0.16;
  const lPlant = Math.max(0, -s);
  const rPlant = Math.max(0, s);
  p.lFoot.x = -p.lLeg.x * 0.42 + (1 - lPlant) * 0.2;
  p.rFoot.x = -p.rLeg.x * 0.42 + (1 - rPlant) * 0.2;
  p.lToe.x = (1 - lPlant) * 0.18;
  p.rToe.x = (1 - rPlant) * 0.18;
  p.lArm.x = -s * amp * (run ? 0.92 : 0.78);
  p.rArm.x = s * amp * (run ? 0.92 : 0.78);
  p.lArm.z = run ? -0.05 : -0.02;
  p.rArm.z = run ? 0.05 : 0.02;
  p.lFore.x = (run ? 0.48 : 0.18) + Math.max(0, s) * amp * 0.4;
  p.rFore.x = (run ? 0.48 : 0.18) + Math.max(0, -s) * amp * 0.4;
  p.lHand.x = 0.08;
  p.rHand.x = 0.08;
  p.hips.y = s * (run ? 0.09 : 0.06);
  p.hips.z = -s * (run ? 0.055 : 0.04);
  p.hips.x = run ? 0.14 : 0.02;
  p.spine.y = -s * (run ? 0.11 : 0.08);
  p.spine.x = run ? 0.05 : 0.015;
  p.chest.y = s * (run ? 0.13 : 0.09);
  p.chest.x = run ? 0.04 : Math.sin(t * 1.6) * 0.012;
  p.head.y = -s * 0.05;
  p.head.x = run ? -0.05 : 0;
  p.lClav.z = 0.04 + (run ? 0.05 : 0);
  p.rClav.z = -0.04 - (run ? 0.05 : 0);
  p.lClav.y = s * 0.05;
  p.rClav.y = s * 0.05;
  p.hipY += lift * (run ? 0.045 : 0.026);
  if (swim) {
    p.lArm.x = s * 0.9;
    p.rArm.x = -s * 0.9;
    p.lFore.x = 0.5 + c * 0.35;
    p.rFore.x = 0.5 - c * 0.35;
    p.lUp.x = c * 0.35;
    p.rUp.x = -c * 0.35;
    p.lLeg.x = 0.4 + s * 0.25;
    p.rLeg.x = 0.4 - s * 0.25;
    p.hips.x = 0.35;
    p.spine.x = 0.2;
    p.head.x = -0.15;
  }
}

function curlFingers(hand: THREE.Bone | undefined, amount: number, t: number) {
  const chains = hand?.userData.fingers as THREE.Bone[][] | undefined;
  if (!chains) return;
  for (let c = 0; c < chains.length; c++) {
    const chain = chains[c]!;
    for (let i = 0; i < chain.length; i++) {
      const b = chain[i]!;
      const r = restOf(b);
      const wiggle = Math.sin(t * 2.2 + c * 0.7 + i) * 0.03 * (1 - amount);
      b.rotation.x = r.x + amount * (0.22 + i * 0.12) + wiggle;
    }
  }
}

function applyPose(ref: BoneRef, p: Pose, k: number, sword: THREE.Object3D) {
  const map: Record<keyof Omit<Pose, "hipY" | "sword">, THREE.Bone | null> = {
    hips: ref.hips,
    spine: ref.spine,
    chest: ref.chest,
    neck: ref.neck,
    head: ref.head,
    lClav: ref.lClav,
    rClav: ref.rClav,
    lArm: ref.lArm,
    rArm: ref.rArm,
    lFore: ref.lFore,
    rFore: ref.rFore,
    lHand: ref.lHand,
    rHand: ref.rHand,
    lUp: ref.lUp,
    rUp: ref.rUp,
    lLeg: ref.lLeg,
    rLeg: ref.rLeg,
    lFoot: ref.lFoot,
    rFoot: ref.rFoot,
    lToe: ref.lToe,
    rToe: ref.rToe,
  };
  for (const key of KEYS) {
    const b = map[key];
    if (!b) continue;
    const r = restOf(b);
    const e = p[key];
    const tx = r.x + e.x;
    const ty = r.y + e.y;
    const tz = r.z + e.z;
    b.rotation.x += (tx - b.rotation.x) * k;
    b.rotation.y += (ty - b.rotation.y) * k;
    b.rotation.z += (tz - b.rotation.z) * k;
  }
  const hr = restOf(ref.hips);
  ref.hips.position.y += (p.hipY - ref.hips.position.y) * k;
  if (Math.abs(ref.hips.position.y - hr.py) < 0.00001 && k >= 0.99) ref.hips.position.y = p.hipY;
  sword.rotation.x += (p.sword.x - sword.rotation.x) * k;
  sword.rotation.y += (p.sword.y - sword.rotation.y) * k;
  sword.rotation.z += (p.sword.z - sword.rotation.z) * k;
}

function flutterCloth(root: THREE.Object3D, t: number, amp: number) {
  // Cloak/scarf are SkinnedMeshes in root space. Rotating them around the
  // feet turns cloth into a marionette; chest/spine motion already carries them.
  void root;
  void t;
  void amp;
}

type FixtureGeometryMetrics = {
  visibleMeshCount: number;
  boundsSize: [number, number, number] | null;
  distanceToAnchor: number | null;
};

function fixtureGeometryMetrics(object: THREE.Object3D, anchor: THREE.Object3D | undefined): FixtureGeometryMetrics {
  if (!object.visible) return { visibleMeshCount: 0, boundsSize: null, distanceToAnchor: null };
  object.updateWorldMatrix(true, true);
  anchor?.updateWorldMatrix(true, false);
  const bounds = new THREE.Box3();
  let visibleMeshCount = 0;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    visibleMeshCount += 1;
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  });
  const size = bounds.isEmpty() ? null : bounds.getSize(new THREE.Vector3());
  const origin = object.getWorldPosition(new THREE.Vector3());
  const anchorOrigin = anchor?.getWorldPosition(new THREE.Vector3());
  return {
    visibleMeshCount,
    boundsSize: size ? [size.x, size.y, size.z] : null,
    distanceToAnchor: anchorOrigin ? origin.distanceTo(anchorOrigin) : null,
  };
}

function fixtureGearMetrics(f: LimbSet) {
  // These measurements are capture-fixture-only: the screenshots remain the
  // visual review evidence, while this makes a named-but-empty attachment fail.
  if (typeof document === "undefined" || document.documentElement.dataset.awHeroFixture !== "true") return undefined;
  const rightHand = f.rarm.getObjectByName("R_Hand") ?? f.rarm.getObjectByName("hand.R") ?? f.rarm.getObjectByName("handR") ?? f.rarm;
  return {
    sword: fixtureGeometryMetrics(f.sword, rightHand),
    glider: fixtureGeometryMetrics(f.glider, f.torso),
  };
}

function fixturePoseMetrics(f: LimbSet) {
  if (typeof document === "undefined" || document.documentElement.dataset.awHeroFixture !== "true") return undefined;
  const rightHand = f.rarm.getObjectByName("R_Hand") ?? f.rarm.getObjectByName("hand.R") ?? f.rarm.getObjectByName("handR") ?? f.rarm;
  f.root.updateMatrixWorld(true);
  let skin: THREE.SkinnedMesh | undefined;
  f.root.traverse((object) => {
    if (!skin && (object as THREE.SkinnedMesh).isSkinnedMesh) skin = object as THREE.SkinnedMesh;
  });
  const upperArm = f.rarm.getWorldPosition(new THREE.Vector3());
  const hand = rightHand.getWorldPosition(new THREE.Vector3());
  if (!skin) return { upperArm: upperArm.toArray(), rightHand: hand.toArray(), skinVertex: null };
  skin.skeleton.update();
  const joint = skin.skeleton.bones.indexOf(f.rarm as THREE.Bone);
  let vertex = skin.userData.awFixtureUpperArmVertex as number | undefined;
  if (vertex === undefined) {
    const indices = skin.geometry.getAttribute("skinIndex");
    const weights = skin.geometry.getAttribute("skinWeight");
    let bestWeight = -1;
    for (let index = 0; index < weights.count; index++) {
      for (let component = 0; component < 4; component++) {
        if (indices.getComponent(index, component) !== joint) continue;
        const weight = weights.getComponent(index, component);
        if (weight > bestWeight) {
          vertex = index;
          bestWeight = weight;
        }
      }
    }
    skin.userData.awFixtureUpperArmVertex = vertex ?? -1;
  }
  let skinVertex: [number, number, number] | null = null;
  if (vertex !== undefined && vertex >= 0) {
    const point = new THREE.Vector3().fromBufferAttribute(skin.geometry.getAttribute("position"), vertex);
    skin.applyBoneTransform(vertex, point);
    skin.localToWorld(point);
    skinVertex = [point.x, point.y, point.z];
  }
  return { upperArm: upperArm.toArray(), rightHand: hand.toArray(), skinVertex };
}

export function animateSkinnedWanderer(f: LimbSet, t: number, state: AnimState, attackT: number) {
  const ud = f.root.userData as {
    lastT?: number;
    lastState?: AnimState;
    attackStart?: number;
    deathStart?: number;
    landStart?: number;
    hitStart?: number;
    clipName?: string;
  };
  const dt = Math.min(0.05, Math.max(0, t - (ud.lastT ?? t)));
  ud.lastT = t;

  const mixer = f.root.userData.mixer as THREE.AnimationMixer | undefined;
  const clips = f.root.userData.clips as THREE.AnimationClip[] | undefined;
  const authoredName = AUTHORED_CLIP_BY_STATE[state];
  if (mixer && clips?.length && authoredName) {
    if (ud.clipName !== authoredName) {
      const previous = ud.clipName ? clips.find((clip) => clip.name === ud.clipName) : undefined;
      if (previous) mixer.clipAction(previous).fadeOut(CLIP_CROSSFADE_SECONDS);
      const clip = clips.find((candidate) => candidate.name === authoredName);
      if (clip) {
        const action = mixer.clipAction(clip).reset().setEffectiveWeight(1);
        if (state === "attack") {
          // Attack has only 0.4 s of gameplay presentation. Fading it in for
          // 0.16 s leaves its first 40% mixed with Idle's A-pose, which makes
          // an authored slash appear static in the capture window.
          mixer.stopAllAction();
          action.setEffectiveTimeScale(clip.duration / ATTACK_PRESENTATION_SECONDS);
          action.setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
          action.play();
        } else {
          action.setEffectiveTimeScale(1);
          action.setLoop(THREE.LoopRepeat, Infinity).clampWhenFinished = false;
          action.fadeIn(CLIP_CROSSFADE_SECONDS).play();
        }
      }
      ud.clipName = authoredName;
    }
    mixer.update(dt);
    const gliding = state === "glide";
    f.glider.visible = gliding;
    const stowed = f.root.userData.stowed as THREE.Object3D | undefined;
    if (stowed) stowed.visible = !gliding;
    const clip = clips.find((candidate) => candidate.name === authoredName);
    const action = clip ? mixer.existingAction(clip) : null;
    const unresolvedTrackTargets = clip
      ? [...new Set(clip.tracks.map((track) => track.name.slice(0, track.name.lastIndexOf("."))).filter((name) => !f.root.getObjectByName(name)))].sort()
      : [];
    setAnimationStatus({
      state,
      clip: authoredName,
      phase: action && clip?.duration ? Math.min(1, action.time / clip.duration) : 0,
      oneShot: state === "attack",
      mixerRootMatches: mixer.getRoot() === f.root,
      effectiveWeight: action?.getEffectiveWeight() ?? 0,
      effectiveTimeScale: action?.getEffectiveTimeScale() ?? 0,
      actionTime: action?.time ?? 0,
      unresolvedTrackTargets,
      fixturePose: fixturePoseMetrics(f),
      gliderVisible: gliding,
      fixtureGear: fixtureGearMetrics(f),
    });
    ud.lastState = state;
    return;
  }
  if (mixer && ud.clipName) {
    mixer.stopAllAction();
    f.root.traverse((object) => {
      const rest = object.userData.rest as RestEuler | undefined;
      if (rest) object.rotation.set(rest.x, rest.y, rest.z);
    });
    ud.clipName = undefined;
  }
  setAnimationStatus({ state, clip: null, phase: null, oneShot: false, gliderVisible: state === "glide" });

  const ref = cacheBones(f);
  if (ud.lastState !== state) {
    if (state === "attack") ud.attackStart = t;
    if (state === "death") ud.deathStart = t;
    if (state === "land") ud.landStart = t;
    if (state === "hit") ud.hitStart = t;
    ud.lastState = state;
  }

  const hipRest = restOf(ref.hips).py || 1;
  const p = zeroPose(hipRest);
  const breath = Math.sin(t * 1.5) * 0.018;
  const look = Math.sin(t * 0.55) * 0.1;
  let grip = 0.15;
  let rate = 10;

  if (state === "idle") {
    rate = 7;
    p.chest.x = breath;
    p.spine.x = breath * 0.5;
    p.head.y = look;
    p.head.x = Math.sin(t * 0.35) * 0.03;
    p.lArm.z = Math.sin(t * 1.1) * 0.015;
    p.rArm.z = -Math.sin(t * 1.1 + 0.4) * 0.015;
    p.lFore.x = 0.05;
    p.rFore.x = 0.05;
    p.hips.y = Math.sin(t * 0.8) * 0.02;
    p.hipY += Math.abs(breath) * 0.15;
    flutterCloth(f.root, t, 0.03);
  } else if (state === "walk") {
    rate = 14;
    locomote(p, t, 7.2, 0.48, false);
    p.head.y += look * 0.3;
    grip = 0.25;
    flutterCloth(f.root, t, 0.05);
  } else if (state === "run") {
    rate = 16;
    locomote(p, t, 10.6, 0.78, true);
    grip = 0.4;
    flutterCloth(f.root, t, 0.1);
  } else if (state === "swim") {
    rate = 12;
    locomote(p, t, 6.4, 0.4, false, true);
    grip = 0.35;
    flutterCloth(f.root, t, 0.12);
  } else if (state === "jump") {
    rate = 18;
    p.lUp.x = -0.72;
    p.rUp.x = -0.55;
    p.lLeg.x = 1.05;
    p.rLeg.x = 0.9;
    p.lFoot.x = 0.2;
    p.rFoot.x = 0.15;
    p.lArm.x = -0.55;
    p.rArm.x = -0.35;
    p.lArm.z = -0.25;
    p.rArm.z = 0.2;
    p.lFore.x = 0.45;
    p.rFore.x = 0.35;
    p.spine.x = -0.12;
    p.chest.x = -0.08;
    p.head.x = 0.08;
    p.hips.x = -0.06;
    p.hipY += 0.03;
    grip = 0.45;
  } else if (state === "fall") {
    rate = 10;
    const w = Math.sin(t * 6);
    p.lArm.z = -0.95;
    p.rArm.z = 0.95;
    p.lArm.x = 0.15 + w * 0.12;
    p.rArm.x = 0.1 - w * 0.12;
    p.lFore.x = 0.25;
    p.rFore.x = 0.25;
    p.lUp.x = 0.22 + w * 0.08;
    p.rUp.x = 0.18 - w * 0.08;
    p.lLeg.x = 0.35;
    p.rLeg.x = 0.28;
    p.spine.x = -0.08;
    p.chest.x = -0.05;
    p.head.x = 0.12;
    flutterCloth(f.root, t, 0.16);
  } else if (state === "land") {
    rate = 20;
    const elapsed = t - (ud.landStart ?? t);
    const k = Math.min(1, elapsed / 0.22);
    const squat = (1 - k) * 0.85 + 0.15;
    p.lUp.x = -0.55 * squat;
    p.rUp.x = -0.5 * squat;
    p.lLeg.x = 1.15 * squat;
    p.rLeg.x = 1.05 * squat;
    p.lArm.x = -0.35;
    p.rArm.x = -0.25;
    p.lFore.x = 0.4;
    p.spine.x = 0.28 * squat;
    p.chest.x = 0.12 * squat;
    p.head.x = 0.1;
    p.hips.x = 0.18 * squat;
    p.hipY -= 0.12 * squat;
  } else if (state === "climb") {
    rate = 14;
    const s = Math.sin(t * 6.2);
    p.lArm.x = s * 0.85 - 0.7;
    p.rArm.x = -s * 0.85 - 0.7;
    p.lFore.x = 0.85;
    p.rFore.x = 0.85;
    p.lHand.x = 0.2;
    p.rHand.x = 0.2;
    p.lUp.x = -s * 0.7;
    p.rUp.x = s * 0.7;
    p.lLeg.x = 0.7 + Math.max(0, s) * 0.45;
    p.rLeg.x = 0.7 + Math.max(0, -s) * 0.45;
    p.lFoot.x = -0.2;
    p.rFoot.x = -0.2;
    p.spine.x = 0.12;
    p.chest.x = 0.08;
    p.head.x = -0.15;
    p.hips.x = 0.1;
    p.lClav.z = 0.12;
    p.rClav.z = -0.12;
    grip = 0.7;
    flutterCloth(f.root, t, 0.04);
  } else if (state === "glide") {
    rate = 9;
    p.lArm.z = -1.22;
    p.rArm.z = 1.22;
    p.lArm.x = 0.22;
    p.rArm.x = 0.22;
    p.lFore.x = 0.15;
    p.rFore.x = 0.15;
    p.lUp.x = 0.28;
    p.rUp.x = 0.34;
    p.lLeg.x = 0.2;
    p.rLeg.x = 0.18;
    p.lFoot.x = 0.15;
    p.spine.x = -0.12;
    p.chest.x = -0.06;
    p.head.x = 0.12;
    p.hips.x = -0.08;
    p.lClav.z = 0.35;
    p.rClav.z = -0.35;
    f.glider.rotation.z = Math.sin(t * 2.1) * 0.05;
    f.glider.rotation.x = Math.sin(t * 1.4) * 0.03;
    flutterCloth(f.root, t, 0.18);
  } else if (state === "attack") {
    rate = 22;
    const elapsed = t - (ud.attackStart ?? t);
    const wind = 0.1;
    const active = 0.14;
    const rec = 0.16;
    let k: number;
    if (elapsed < wind) {
      k = elapsed / wind;
      p.rArm.x = -2.05 * k;
      p.rArm.z = 0.45 * k;
      p.rArm.y = -0.35 * k;
      p.rFore.x = -0.15 * k;
      p.rHand.x = 0.2;
      p.lArm.x = -0.35 * k;
      p.lArm.z = 0.25 * k;
      p.chest.y = -0.35 * k;
      p.spine.y = -0.2 * k;
      p.hips.y = -0.15 * k;
      p.head.y = 0.15 * k;
      p.sword.x = -0.4 * k;
    } else if (elapsed < wind + active) {
      k = (elapsed - wind) / active;
      p.rArm.x = -2.05 + 2.6 * k;
      p.rArm.z = 0.45 - 0.7 * k;
      p.rArm.y = -0.35 + 0.9 * k;
      p.rFore.x = -0.15 + 0.7 * k;
      p.lArm.x = -0.35 - 0.15 * k;
      p.chest.y = -0.35 + 0.85 * k;
      p.spine.y = -0.2 + 0.5 * k;
      p.hips.y = -0.15 + 0.35 * k;
      p.head.y = 0.15 - 0.25 * k;
      p.sword.x = -0.4 - 1.1 * k;
    } else {
      k = Math.min(1, (elapsed - wind - active) / rec);
      p.rArm.x = 0.55 * (1 - k);
      p.rArm.z = -0.25 * (1 - k);
      p.rFore.x = 0.55 * (1 - k);
      p.chest.y = 0.5 * (1 - k);
      p.sword.x = -1.5 * (1 - k);
    }
    p.lUp.x = Math.sin(t * 4) * 0.08;
    p.rUp.x = -Math.sin(t * 4) * 0.08;
    p.lLeg.x = 0.12;
    p.rLeg.x = 0.18;
    grip = 0.85;
    void attackT;
  } else if (state === "bow") {
    rate = 12;
    p.lArm.x = -1.25;
    p.rArm.x = -1.05;
    p.rArm.z = 0.55;
    p.rArm.y = 0.25;
    p.lFore.x = -0.15;
    p.rFore.x = 0.85;
    p.lHand.x = 0.15;
    p.rHand.x = 0.35;
    p.chest.y = 0.22;
    p.spine.y = 0.12;
    p.head.x = 0.08;
    p.head.y = -0.12;
    p.lUp.x = -0.08;
    p.rUp.x = 0.12;
    p.hips.y = 0.1;
    p.lClav.z = 0.1;
    p.rClav.z = -0.18;
    grip = 0.5;
  } else if (state === "hit") {
    rate = 20;
    const elapsed = t - (ud.hitStart ?? t);
    const k = Math.min(1, elapsed / 0.12);
    p.chest.x = 0.32 * k;
    p.spine.x = 0.18 * k;
    p.hips.x = 0.16 * k;
    p.head.x = -0.2 * k;
    p.head.y = 0.15 * k;
    p.lArm.x = -0.95 * k;
    p.rArm.x = -0.55 * k;
    p.lArm.z = 0.45 * k;
    p.rArm.z = -0.25 * k;
    p.lFore.x = 0.7 * k;
    p.rFore.x = 0.4 * k;
    p.lUp.x = -0.2 * k;
    p.rUp.x = 0.15 * k;
    p.lLeg.x = 0.45 * k;
    grip = 0.4;
  } else if (state === "death") {
    rate = 5;
    const elapsed = t - (ud.deathStart ?? t);
    const k = Math.min(1, elapsed / 1.15);
    const ease = k * k * (3 - 2 * k);
    p.hips.x = 1.22 * ease;
    p.spine.x = 0.35 * ease;
    p.chest.x = 0.2 * ease;
    p.head.x = 0.45 * ease;
    p.lArm.z = -0.75 * ease;
    p.rArm.z = 0.4 * ease;
    p.lArm.x = 0.2 * ease;
    p.rArm.x = -0.15 * ease;
    p.lFore.x = 0.3;
    p.rFore.x = 0.2;
    p.lUp.x = -0.35 * ease;
    p.rUp.x = 0.15 * ease;
    p.lLeg.x = 0.55 * ease;
    p.rLeg.x = 0.25 * ease;
    p.lFoot.x = 0.2;
    p.hipY += 0.02 * ease;
    grip = 0.05;
  }

  const k = 1 - Math.exp(-(rate) * Math.max(dt, 1 / 60));
  applyPose(ref, p, k, f.sword);
  curlFingers(ref.lHand, grip, t);
  curlFingers(ref.rHand, grip + 0.1, t);

  const gliding = state === "glide";
  f.glider.visible = gliding;
  const stowed = f.root.userData.stowed as THREE.Object3D | undefined;
  if (stowed) stowed.visible = !gliding;
  if (gliding) {
    const open = Math.min(1, ((f.glider.userData.open as number) ?? 0) + dt * 5);
    f.glider.userData.open = open;
    f.glider.scale.setScalar(0.2 + 0.8 * open);
  } else {
    f.glider.userData.open = 0;
    f.glider.scale.setScalar(1);
  }
}
