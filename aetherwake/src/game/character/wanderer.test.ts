import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createSkinnedWanderer, createWandererLod } from "./build.ts";
import { animateSkinnedWanderer as animate } from "./animate.ts";
import { attachMeasuredV4SwordSocket, createRuntimeGear, ensureGear, resolveCharacterRigNodes, V4_HAND_R_SWORD_SOCKET } from "./loader.ts";
import { SKIN_DRIVER_BONES } from "./skinning.ts";
import {
  craniumGeometry,
  latheOutward,
  limbLathe,
  pelvisLathe,
  radialNormalCounts,
  scalpGeometry,
  skirtHem,
  sleeveLathe,
  torsoLathe,
  vestLathe,
  waistLathe,
} from "./geometry.ts";
import type { AnimState } from "./types.ts";
import type { LimbSet } from "./types.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const V4_GLB = resolve(testDir, "../../../../docs/art-direction/asset-v4/wanderer-textured-rig-v4.glb");

/**
 * Node has no ImageBitmap decoder, but the audit is about the actual GLB's
 * node/skin/animation data. Remove only image references before passing the
 * otherwise byte-for-byte scene, skin, accessors, and animations to
 * GLTFLoader.
 */
async function loadV4RuntimeAuditScene() {
  const source = readFileSync(V4_GLB);
  const jsonLength = source.readUInt32LE(12);
  const gltfJson = JSON.parse(source.subarray(20, 20 + jsonLength).toString("utf8"));
  const binOffset = 20 + jsonLength;
  const binLength = source.readUInt32LE(binOffset);
  const bin = source.subarray(binOffset + 8, binOffset + 8 + binLength);
  delete gltfJson.images;
  delete gltfJson.textures;
  for (const material of gltfJson.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  let json = JSON.stringify(gltfJson);
  json += " ".repeat((4 - (json.length % 4)) % 4);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + 8 + bin.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, Buffer.from(json), binHeader, bin]);
  // GLTFLoader checks `self` while parsing even though image loading is absent.
  Object.assign(globalThis, { self: globalThis });
  return await new Promise<any>((accept, reject) => {
    new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "", accept, reject);
  });
}

const STATES: AnimState[] = [
  "idle",
  "walk",
  "run",
  "jump",
  "fall",
  "land",
  "climb",
  "glide",
  "attack",
  "swim",
  "bow",
  "hit",
  "death",
];

test("wanderer is adult-proportioned PBR humanoid with fingers", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  f.root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p.name === "Glider") return;
      p = p.parent;
    }
    box.expandByObject(o);
  });
  const h = box.max.y - box.min.y;
  assert.ok(h >= 1.7 && h <= 1.9, `height ${h}`);
  assert.ok(f.skeleton);
  assert.equal(f.root.getObjectByName("Hips")?.type, "Bone");
  assert.ok(f.root.getObjectByName("L_Index1"));
  assert.ok(f.root.getObjectByName("R_Pinky3"));
  assert.ok(f.root.getObjectByName("EyeL"));
  assert.ok(f.root.getObjectByName("Cranium"));
  assert.ok(f.root.getObjectByName("Satchel"));
  assert.ok(f.root.getObjectByName("HairCard"));
  let toon = 0;
  let std = 0;
  f.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m.type === "MeshToonMaterial") toon++;
      if (m.type === "MeshStandardMaterial") std++;
    }
  });
  assert.equal(toon, 0);
  assert.ok(std > 40);
  assert.ok(f.sword.parent);
  assert.ok(f.glider.parent);
  assert.ok(f.slate.parent);
});

test("all anim states run without throwing", () => {
  const f = createSkinnedWanderer();
  for (const st of STATES) {
    animate(f, 0.5, st, 0.12);
    animate(f, 0.7, st, 0.04);
  }
  animate(f, 1, "idle", 0);
  assert.equal(f.glider.visible, false);
  animate(f, 1.2, "glide", 0);
  assert.equal(f.glider.visible, true);
});

test("authored candidate clips crossfade and keep Attack one-shot", () => {
  const f = createSkinnedWanderer();
  const clips = ["Idle", "Walk", "Run", "Attack", "Climb", "Glide"].map((name) => new THREE.AnimationClip(name, 1, []));
  const mixer = new THREE.AnimationMixer(f.root);
  f.root.userData.mixer = mixer;
  f.root.userData.clips = clips;

  animate(f, 0, "idle", 0);
  assert.equal(f.root.userData.clipName, "Idle");
  animate(f, 0.2, "walk", 0);
  assert.equal(f.root.userData.clipName, "Walk");
  animate(f, 0.4, "attack", 0.1);
  const attack = mixer.existingAction(clips[3]!);
  assert.equal(f.root.userData.clipName, "Attack");
  assert.ok(attack);
  assert.equal(attack.loop, THREE.LoopOnce);
  assert.equal(attack.repetitions, 1);
  assert.equal(attack.clampWhenFinished, true);
  assert.equal(attack.getEffectiveTimeScale(), 2.5, "1s authored Attack must fit the 0.4s gameplay melee window");
  animate(f, 0.45, "attack", 0.1);
  animate(f, 0.5, "attack", 0.1);
  animate(f, 0.55, "attack", 0.1);
  assert.ok(Math.abs(attack.time - 0.5) < 0.000001, "Attack must reach its mid-sweep in the live combat window");
  animate(f, 0.6, "climb", 0);
  assert.equal(f.root.userData.clipName, "Climb");
  animate(f, 0.8, "glide", 0);
  assert.equal(f.root.userData.clipName, "Glide");
  assert.equal(f.glider.visible, true);
});

test("v4 hand.R sword socket seats the grip along the measured palm axis", () => {
  const hand = new THREE.Bone();
  hand.name = "hand.R";
  const sword = new THREE.Group();

  attachMeasuredV4SwordSocket(hand, sword);

  assert.strictEqual(sword.parent, hand);
  assert.deepEqual(sword.position.toArray(), V4_HAND_R_SWORD_SOCKET.position.toArray());
  assert.deepEqual(sword.rotation.toArray(), V4_HAND_R_SWORD_SOCKET.rotation.toArray());
  assert.equal(sword.userData.attachment, "v4-hand.R-measured-palm-axis");
});

test("v4 runtime resolves GLTFLoader identities, visibly deforms Attack, and attaches the rendered sword to handR", async () => {
  const gltf = await loadV4RuntimeAuditScene();
  const root = gltf.scene as THREE.Group;
  const nodes = resolveCharacterRigNodes(root);
  const attack = gltf.animations.find((clip: THREE.AnimationClip) => clip.name === "Attack");
  assert.ok(attack, "v4 Attack clip is missing");
  assert.equal(root.getObjectByName("upper_arm.R"), undefined, "audit must exercise GLTFLoader's sanitized identity");
  assert.equal(nodes.rarm.name, "upper_armR");
  assert.equal(nodes.larm.name, "upper_armL");
  assert.equal(nodes.rleg.name, "thighR");
  const hand = root.getObjectByName("handR");
  assert.ok(hand, "sanitized right-hand bone missing");

  let skin: THREE.SkinnedMesh | undefined;
  root.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) skin = object as THREE.SkinnedMesh;
  });
  assert.ok(skin, "v4 body SkinnedMesh missing");
  const bodySkin = skin;
  const upperArmJoint = bodySkin.skeleton.bones.findIndex((bone) => bone === nodes.rarm);
  assert.ok(upperArmJoint >= 0, "resolved runtime upper arm must be the bound skin joint");
  assert.ok(attack.tracks.some((track: THREE.KeyframeTrack) => track.name === "upper_armR.quaternion"));
  for (const track of attack.tracks) {
    const targetName = track.name.slice(0, track.name.lastIndexOf("."));
    assert.ok(root.getObjectByName(targetName), `Attack track target ${targetName} was not instantiated`);
  }

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
    skeleton: bodySkin.skeleton,
  };
  ensureGear(set);
  const sword = set.sword;
  root.userData.mixer = new THREE.AnimationMixer(root);
  root.userData.clips = gltf.animations;
  const mixer = root.userData.mixer as THREE.AnimationMixer;
  assert.strictEqual(mixer.getRoot(), root, "mixer must bind the same instantiated scene as the skin");

  // Settle Idle first, then enter the 0.4 s gameplay Attack. Prior behavior
  // faded Attack in for 0.16 s, yielding a 0.3125 effective weight at this
  // first 50 ms sample and visually preserving the Idle A-pose.
  for (const t of [0, 0.05, 0.1, 0.15, 0.2]) animate(set, t, "idle", 0);
  animate(set, 0.25, "attack", 0.12);
  const action = mixer.existingAction(attack);
  assert.ok(action);
  assert.equal(action.getEffectiveWeight(), 1, "Attack must not fade through the Idle A-pose");
  assert.equal(action.getEffectiveTimeScale(), attack.duration / 0.4);
  assert.equal(action.loop, THREE.LoopOnce);

  const skinIndex = bodySkin.geometry.getAttribute("skinIndex");
  const skinWeight = bodySkin.geometry.getAttribute("skinWeight");
  let vertex = -1;
  let driverWeight = -1;
  for (let index = 0; index < skinWeight.count; index++) {
    for (let component = 0; component < 4; component++) {
      if (skinIndex.getComponent(index, component) !== upperArmJoint) continue;
      const weight = skinWeight.getComponent(index, component);
      if (weight > driverWeight) {
        vertex = index;
        driverWeight = weight;
      }
    }
  }
  assert.ok(vertex >= 0 && driverWeight > 0.99, "audit needs a fully upper-arm-driven body vertex");
  const sample = () => {
    root.updateMatrixWorld(true);
    bodySkin.skeleton.update();
    const upperArm = nodes.rarm.getWorldPosition(new THREE.Vector3());
    const rightHand = hand.getWorldPosition(new THREE.Vector3());
    const point = new THREE.Vector3().fromBufferAttribute(bodySkin.geometry.getAttribute("position"), vertex);
    bodySkin.applyBoneTransform(vertex, point);
    bodySkin.localToWorld(point);
    return { upperArm, rightHand, point };
  };
  const start = sample();
  for (const t of [0.3, 0.35, 0.4]) animate(set, t, "attack", 0.12);
  const end = sample();
  assert.ok(action.time >= attack.duration * 0.49, `Attack time did not reach the slash: ${action.time}`);
  assert.ok(start.rightHand.distanceTo(end.rightHand) > 0.18, "Attack did not move the actual hand in world space");
  assert.ok(start.point.distanceTo(end.point) > 0.08, "Attack did not deform a real upper-arm-driven skin vertex");

  assert.strictEqual(sword.parent, hand, "the rendered sword group must be parented to the actual hand, not the chest fallback");
  assert.equal(sword.visible, true);
  assert.deepEqual(sword.scale.toArray(), [1, 1, 1]);
  const socketDistance = sword.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()));
  assert.ok(socketDistance >= 0.12 && socketDistance <= 0.17, `sword palm socket distance ${socketDistance}`);
  let renderedSwordMeshes = 0;
  sword.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh || !object.visible) return;
    renderedSwordMeshes++;
    assert.ok((object as THREE.Mesh).material, "visible sword child must have a material");
  });
  assert.equal(renderedSwordMeshes, 5, "the attached RuntimeSword must contain all five rendered meshes");
});

test("lod variant is lighter and still returns LimbSet", () => {
  const lod = createWandererLod();
  assert.ok(lod.root);
  assert.ok(lod.head);
  assert.equal(lod.root.getObjectByName("L_Index1"), undefined);
});

function assertMostlyOutward(
  geo: THREE.BufferGeometry,
  label: string,
  minOutwardFrac: number,
  maxInwardFrac: number,
) {
  geo.computeVertexNormals();
  const { inward, outward, skipped } = radialNormalCounts(geo);
  const n = inward + outward;
  assert.ok(n > 20, `${label}: too few radial samples (${n}, skipped ${skipped})`);
  const outFrac = outward / n;
  const inFrac = inward / n;
  assert.ok(
    outFrac >= minOutwardFrac,
    `${label}: outward ${outward}/${n} = ${(outFrac * 100).toFixed(1)}% (need >= ${minOutwardFrac * 100}%), inward=${inward}`,
  );
  assert.ok(
    inFrac <= maxInwardFrac,
    `${label}: inward ${inward}/${n} = ${(inFrac * 100).toFixed(1)}% (need <= ${maxInwardFrac * 100}%)`,
  );
}

test("lathe helpers wind outward (radial normals)", () => {
  const cylinder = latheOutward(
    [new THREE.Vector2(0.08, -0.1), new THREE.Vector2(0.08, 0.1)],
    12,
  );
  cylinder.computeVertexNormals();
  const raw = radialNormalCounts(cylinder);
  assert.equal(raw.inward, 0, `undeformed cylinder inward=${raw.inward}`);
  assert.ok(raw.outward >= 20, `undeformed cylinder outward=${raw.outward}`);

  const bodyProfiles: [string, THREE.Vector2[]][] = [
    [
      "torso",
      [
        new THREE.Vector2(0.001, -0.02),
        new THREE.Vector2(0.138, -0.02),
        new THREE.Vector2(0.14, 0),
        new THREE.Vector2(0.155, 0.02),
        new THREE.Vector2(0.145, 0.07),
        new THREE.Vector2(0.175, 0.15),
        new THREE.Vector2(0.185, 0.22),
        new THREE.Vector2(0.155, 0.26),
        new THREE.Vector2(0.1, 0.31),
        new THREE.Vector2(0.07, 0.32),
      ],
    ],
    [
      "vest",
      [
        new THREE.Vector2(0.168, -0.1),
        new THREE.Vector2(0.176, -0.02),
        new THREE.Vector2(0.198, 0.1),
        new THREE.Vector2(0.205, 0.18),
        new THREE.Vector2(0.188, 0.26),
        new THREE.Vector2(0.152, 0.32),
      ],
    ],
    [
      "limb",
      [
        new THREE.Vector2(0.001, -0.324),
        new THREE.Vector2(0.046, -0.32),
        new THREE.Vector2(0.05, -0.28),
        new THREE.Vector2(0.05, -0.15),
        new THREE.Vector2(0.055, -0.026),
        new THREE.Vector2(0.051, 0.008),
        new THREE.Vector2(0.001, 0.01),
      ],
    ],
    [
      "skirt",
      [
        new THREE.Vector2(0.001, -0.244),
        new THREE.Vector2(0.176, -0.24),
        new THREE.Vector2(0.182, -0.187),
        new THREE.Vector2(0.168, -0.108),
        new THREE.Vector2(0.158, -0.029),
        new THREE.Vector2(0.15, 0.08),
      ],
    ],
    [
      "pelvis",
      [
        new THREE.Vector2(0.001, -0.08),
        new THREE.Vector2(0.12, -0.077),
        new THREE.Vector2(0.155, -0.04),
        new THREE.Vector2(0.17, 0.024),
        new THREE.Vector2(0.15, 0.077),
        new THREE.Vector2(0.001, 0.08),
      ],
    ],
    [
      "cranium",
      [
        new THREE.Vector2(0.001, -0.112),
        new THREE.Vector2(0.012, -0.11),
        new THREE.Vector2(0.028, -0.104),
        new THREE.Vector2(0.058, -0.086),
        new THREE.Vector2(0.084, -0.058),
        new THREE.Vector2(0.098, -0.032),
        new THREE.Vector2(0.106, -0.006),
        new THREE.Vector2(0.11, 0.028),
        new THREE.Vector2(0.104, 0.072),
        new THREE.Vector2(0.082, 0.108),
        new THREE.Vector2(0.042, 0.124),
        new THREE.Vector2(0.001, 0.128),
      ],
    ],
  ];
  for (const [label, pts] of bodyProfiles) {
    assert.ok(pts[0]!.y <= pts[pts.length - 1]!.y, `${label} profile must be increasing-Y`);
    const g = latheOutward(pts, 16);
    g.computeVertexNormals();
    const { inward, outward } = radialNormalCounts(g);
    assert.equal(inward, 0, `${label} undeformed lathe inward=${inward} outward=${outward}`);
    assert.ok(outward >= 20, `${label} undeformed lathe outward=${outward}`);
  }

  assertMostlyOutward(torsoLathe(0.32, 16), "torso", 0.9, 0.08);
  assertMostlyOutward(vestLathe(0.26, 16), "vest", 0.9, 0.08);
  assertMostlyOutward(sleeveLathe(0.3, 12), "sleeve", 0.9, 0.08);
  assertMostlyOutward(limbLathe(0.32, 0.055, 0.05, 0.046, 12), "limb", 0.9, 0.08);
  assertMostlyOutward(skirtHem(0.24, 16), "skirt", 0.9, 0.08);
  assertMostlyOutward(pelvisLathe(0.16, 14), "pelvis", 0.9, 0.08);
  assertMostlyOutward(waistLathe(0.24, 14), "waist", 0.9, 0.08);
  // Eye sockets are concave, so a small inward fraction is expected after sculpt.
  assertMostlyOutward(craniumGeometry(16), "cranium", 0.85, 0.15);
});

test("solid body meshes are FrontSide (closed vest is FrontSide, not DoubleSide hiding)", () => {
  const f = createSkinnedWanderer();
  const bodyNames = new Set(["Cranium", "Torso", "Belly", "Pelvis", "SkirtHem", "NeckMesh", "WaistFill", "Vest"]);
  let checked = 0;
  f.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !bodyNames.has(mesh.name)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      assert.equal(m.side, THREE.FrontSide, `${mesh.name} must stay FrontSide, got ${m.side}`);
      checked++;
    }
  });
  assert.equal(checked, bodyNames.size);
});

test("torso/pelvis/skirt/neck overlap so the abdomen and neck are closed", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const boxOf = (name: string) => {
    const obj = f.root.getObjectByName(name);
    assert.ok(obj, `missing ${name}`);
    return new THREE.Box3().setFromObject(obj);
  };
  const overlapY = (a: THREE.Box3, b: THREE.Box3) => Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const pelvis = boxOf("Pelvis");
  const skirt = boxOf("SkirtHem");
  const belly = boxOf("Belly");
  const torso = boxOf("Torso");
  const vest = boxOf("Vest");
  const neck = boxOf("NeckMesh");
  const head = boxOf("Cranium");
  assert.ok(overlapY(belly, pelvis) > 0.02, `belly/pelvis gap ${overlapY(belly, pelvis)}`);
  assert.ok(overlapY(belly, skirt) > 0.02, `belly/skirt gap ${overlapY(belly, skirt)}`);
  assert.ok(overlapY(torso, belly) > 0.02, `torso/belly gap ${overlapY(torso, belly)}`);
  assert.ok(overlapY(vest, torso) > 0.04, `vest/torso gap ${overlapY(vest, torso)}`);
  assert.ok(overlapY(neck, torso) > 0.01, `neck/torso gap ${overlapY(neck, torso)}`);
  assert.ok(overlapY(neck, head) > 0.01, `neck/head gap ${overlapY(neck, head)}`);
  const waist = boxOf("WaistFill");
  assert.ok(overlapY(waist, skirt) > 0.02, `waist/skirt gap ${overlapY(waist, skirt)}`);
  assert.ok(overlapY(waist, vest) > 0.02, `waist/vest gap ${overlapY(waist, vest)}`);

  const skipGlider = (o: THREE.Object3D) => {
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p.name === "Glider" || p.name === "GliderStowed") return true;
      p = p.parent;
    }
    return false;
  };
  const targets: THREE.Object3D[] = [];
  f.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !skipGlider(o)) targets.push(o);
  });
  const ray = new THREE.Raycaster();
  ray.far = 4;
  for (const y of [1.08, 1.16, 1.28, 1.42, 1.58]) {
    ray.set(new THREE.Vector3(0, y, 2.2), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObjects(targets, false);
    assert.ok(hits.length > 0, `front ray at y=${y} missed the body (hollow abdomen/neck)`);
  }
});

function isHairObject(o: THREE.Object3D) {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (p.name === "Scalp" || p.name.startsWith("Hair")) return true;
    p = p.parent;
  }
  return false;
}

function isFaceObject(o: THREE.Object3D) {
  const face = new Set(["Cranium", "EyeL", "EyeR", "BrowL", "BrowR", "EarL", "EarR"]);
  let p: THREE.Object3D | null = o;
  while (p) {
    if (face.has(p.name)) return true;
    p = p.parent;
  }
  return false;
}

test("front hair stays behind the face so +Z sees skin first", () => {  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);

  const scalpLocal = scalpGeometry(16);
  scalpLocal.computeBoundingBox();
  assert.ok(scalpLocal.boundingBox, "scalp geometry has no bounds");

  const eye = f.root.getObjectByName("EyeL");
  assert.ok(eye, "missing EyeL");
  const eyePos = new THREE.Vector3();
  eye.getWorldPosition(eyePos);
  assert.ok(f.root.getObjectByName("Scalp"), "missing Scalp");
  assert.ok(f.root.getObjectByName("Cranium"), "missing sculpted Cranium");

  const skipGlider = (o: THREE.Object3D) => {
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p.name === "Glider" || p.name === "GliderStowed") return true;
      p = p.parent;
    }
    return false;
  };
  const targets: THREE.Object3D[] = [];
  f.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !skipGlider(o)) targets.push(o);
  });
  const ray = new THREE.Raycaster();
  ray.far = 4;
  const origins = [
    new THREE.Vector3(0, 1.62, 0.2),
    new THREE.Vector3(eyePos.x, eyePos.y, 0.2),
    new THREE.Vector3(-eyePos.x, eyePos.y, 0.2),
  ];
  for (const origin of origins) {
    ray.set(origin, new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObjects(targets, false);
    assert.ok(hits.length > 0, `ray from (${origin.x.toFixed(2)},${origin.y.toFixed(2)},0.2) missed`);
    const first = hits[0]!;
    assert.equal(
      isHairObject(first.object),
      false,
      `first hit from (${origin.x.toFixed(2)},${origin.y.toFixed(2)},0.2) was hair (${first.object.name})`,
    );
    assert.ok(
      isFaceObject(first.object),
      `first hit ${first.object.name} from (${origin.x.toFixed(2)},${origin.y.toFixed(2)},0.2) was not face/skin`,
    );
  }
});

function skinnedPart(f: ReturnType<typeof createSkinnedWanderer>, name: string): THREE.SkinnedMesh {
  const obj = f.root.getObjectByName(name);
  assert.ok(obj, `missing ${name}`);
  assert.ok((obj as THREE.SkinnedMesh).isSkinnedMesh, `${name} is not a SkinnedMesh (assembled doll regression)`);
  return obj as THREE.SkinnedMesh;
}

test("body parts are true skinned meshes with valid weights on the shared skeleton", () => {
  const f = createSkinnedWanderer();
  assert.ok(f.skeleton);
  const boneNames = new Set(f.skeleton.bones.map((b) => b.name));
  for (const name of ["Torso", "Vest", "Belly", "Pelvis", "SkirtHem", "NeckMesh", "SleeveR", "ForeR", "ThighL", "ShinL"]) {
    const sm = skinnedPart(f, name);
    assert.equal(sm.skeleton, f.skeleton, `${name} not bound to the shared skeleton`);
    const pos = sm.geometry.attributes.position as THREE.BufferAttribute;
    const si = sm.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const sw = sm.geometry.attributes.skinWeight as THREE.BufferAttribute;
    assert.ok(si && sw, `${name} missing skin attributes`);
    assert.equal(si.count, pos.count, `${name} skinIndex count mismatch`);
    let blended = 0;
    for (let i = 0; i < pos.count; i++) {
      const w = [sw.getComponent(i, 0), sw.getComponent(i, 1), sw.getComponent(i, 2), sw.getComponent(i, 3)];
      const sum = w[0]! + w[1]! + w[2]! + w[3]!;
      assert.ok(Math.abs(sum - 1) < 0.02, `${name} vertex ${i} weights sum ${sum}`);
      for (let k = 0; k < 4; k++) {
        const idx = si.getComponent(i, k) as number;
        assert.ok(idx >= 0 && idx < f.skeleton!.bones.length, `${name} vertex ${i} bone index ${idx} out of range`);
        assert.ok(w[k]! >= 0 && w[k]! <= 1, `${name} vertex ${i} weight ${w[k]}`);
      }
      // Nonzero weights must occupy the leading slots (no dead slot before a live one).
      let seenZero = false;
      for (let k = 0; k < 4; k++) {
        if (w[k]! === 0) seenZero = true;
        else assert.equal(seenZero, false, `${name} vertex ${i} has a dead slot before a live one`);
      }
      if (w[0]! > 0.2 && w[0]! < 0.8) blended++;
    }
    assert.ok(blended > 0, `${name} has no blended vertices (rigid part, not skinned)`);
    assert.equal(sm.frustumCulled, false, `${name} must not be frustum-culled (skinned bounds)`);
    void boneNames;
  }
  // Boots are SkinnedMeshes locked to the Foot bone so shaft/vamp/sole do not tear.
  const boot = skinnedPart(f, "BootR");
  assert.equal(boot.skeleton, f.skeleton);
  const bsi = boot.geometry.attributes.skinIndex as THREE.BufferAttribute;
  const bsw = boot.geometry.attributes.skinWeight as THREE.BufferAttribute;
  const footIdx = f.skeleton!.bones.findIndex((b) => b.name === "R_Foot");
  assert.ok(footIdx >= 0);
  let footW = 0;
  for (let i = 0; i < bsi.count; i++) {
    for (let k = 0; k < 4; k++) {
      if ((bsi.getComponent(i, k) as number) === footIdx) footW += bsw.getComponent(i, k) as number;
    }
  }
  assert.ok(footW / bsi.count > 0.9, "BootR should be locked to R_Foot");
});

test("sleeve overlaps the elbow with upper-arm and forearm weights", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const sleeve = skinnedPart(f, "SleeveR");
  const pos = sleeve.geometry.attributes.position as THREE.BufferAttribute;
  const si = sleeve.geometry.attributes.skinIndex as THREE.BufferAttribute;
  const sw = sleeve.geometry.attributes.skinWeight as THREE.BufferAttribute;
  const armBone = f.skeleton!.bones.find((b) => b.name === "R_UpperArm")!;
  const foreBone = f.skeleton!.bones.find((b) => b.name === "R_ForeArm")!;
  const armIdx = f.skeleton!.bones.findIndex((b) => b.name === "R_UpperArm");
  const foreIdx = f.skeleton!.bones.findIndex((b) => b.name === "R_ForeArm");
  const elbow = new THREE.Vector3();
  foreBone.getWorldPosition(elbow);
  const armOrigin = new THREE.Vector3();
  armBone.getWorldPosition(armOrigin);
  let minY = Infinity;
  let maxR = 0;
  let distalR = 0;
  let distalN = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (y < minY) minY = y;
    const r = Math.hypot(x - armOrigin.x, z - armOrigin.z);
    if (r > maxR) maxR = r;
    if (y < elbow.y + 0.04) {
      distalR += Math.hypot(x, z);
      distalN++;
    }
  }
  assert.ok(minY <= elbow.y + 0.012, `sleeve distal y=${minY.toFixed(3)} leaves elbow y=${elbow.y.toFixed(3)} uncovered`);
  assert.ok(minY > elbow.y - 0.025, `sleeve distal y=${minY.toFixed(3)} extends too far below elbow y=${elbow.y.toFixed(3)}`);
  let foreW = 0;
  let armW = 0;
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) {
      const idx = si.getComponent(i, k) as number;
      const w = sw.getComponent(i, k) as number;
      if (idx === foreIdx) foreW += w;
      if (idx === armIdx) armW += w;
    }
  }
  assert.ok(foreW > 2, `sleeve forearm overlap weight sum ${foreW.toFixed(2)} is too low`);
  assert.ok(armW > 8, `sleeve UpperArm weight sum ${armW.toFixed(2)} too low`);
  const foreSleeve = skinnedPart(f, "SleeveRFore");
  const foreBox = new THREE.Box3().setFromObject(foreSleeve);
  const upperBox = new THREE.Box3().setFromObject(sleeve);
  assert.ok(
    foreBox.max.y > upperBox.min.y,
    `upper/fore sleeve gap: fore max ${foreBox.max.y.toFixed(3)} <= upper min ${upperBox.min.y.toFixed(3)}`,
  );
  void distalN;
  void distalR;
  void maxR;
});

test("bending the elbow does not funnel the upper sleeve", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const sleeve = skinnedPart(f, "SleeveR");
  const pos = sleeve.geometry.attributes.position as THREE.BufferAttribute;
  const foreBone = f.skeleton!.bones.find((b) => b.name === "R_ForeArm")!;
  let tipI = 0;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < minY) {
      minY = pos.getY(i);
      tipI = i;
    }
  }
  const bindTip = new THREE.Vector3(pos.getX(tipI), pos.getY(tipI), pos.getZ(tipI));
  const rest = foreBone.userData.rest as { x: number; y: number; z: number };
  foreBone.rotation.set(rest.x - 1.31, rest.y, rest.z);
  f.root.updateMatrixWorld(true);
  f.skeleton!.update();
  const poseTip = sleeve.getVertexPosition(tipI, new THREE.Vector3());
  const move = poseTip.distanceTo(bindTip);
  assert.ok(move < 0.04, `sleeve distal vertex flew ${move.toFixed(3)} m (funnel/fragment)`);
  foreBone.rotation.set(rest.x, rest.y, rest.z);
  f.root.updateMatrixWorld(true);
  f.skeleton!.update();
});

test("ears sit against the cranium and do not dominate the front silhouette", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const ear = f.root.getObjectByName("EarR") as THREE.Mesh;
  const cranium = f.root.getObjectByName("Cranium") as THREE.Mesh;
  assert.ok(ear && cranium);
  const earBox = new THREE.Box3().setFromObject(ear);
  const headBox = new THREE.Box3().setFromObject(cranium);
  const earW = earBox.max.x - earBox.min.x;
  const headW = headBox.max.x - headBox.min.x;
  assert.ok(earW < 0.055, `ear width ${earW.toFixed(3)} still oversized`);
  assert.ok(earBox.max.x < headBox.max.x + 0.028, `ear protrudes ${(earBox.max.x - headBox.max.x).toFixed(3)} m past cranium`);
  assert.ok(earW < headW * 0.45, `ear/head width ratio ${earW / headW}`);
});

test("linen belly stays inside the vest so waist/side spikes cannot form", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  f.skeleton!.update();
  const boxOf = (name: string) => {
    const sm = f.root.getObjectByName(name) as THREE.SkinnedMesh;
    assert.ok(sm, `missing ${name}`);
    const pos = sm.geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const box = new THREE.Box3();
    for (let i = 0; i < pos.count; i++) {
      sm.getVertexPosition(i, v);
      box.expandByPoint(v);
    }
    return box;
  };
  const vest = boxOf("Vest");
  const belly = boxOf("Belly");
  assert.ok(belly.max.x < vest.max.x + 0.012, `belly +X ${belly.max.x.toFixed(3)} past vest ${vest.max.x.toFixed(3)}`);
  assert.ok(belly.min.x > vest.min.x - 0.012, `belly -X ${belly.min.x.toFixed(3)} past vest ${vest.min.x.toFixed(3)}`);
  const waist = boxOf("WaistFill");
  assert.ok(waist.max.x < vest.max.x + 0.02, `waistFill +X ${waist.max.x.toFixed(3)} past vest ${vest.max.x.toFixed(3)}`);
});

test("vest has no separate armhole rim fragments", () => {
  const f = createSkinnedWanderer();
  assert.equal(f.root.getObjectByName("VestArmL"), undefined);
  assert.equal(f.root.getObjectByName("VestArmR"), undefined);
});

test("bending the forearm moves the skinned arm continuously, not as a doll joint", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const fore = skinnedPart(f, "ForeR");
  const pos = fore.geometry.attributes.position as THREE.BufferAttribute;

  // Bind-pose world position of the wrist-end vertex (lowest y).
  let tipI = 0;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < minY) {
      minY = pos.getY(i);
      tipI = i;
    }
  }
  const bindTip = new THREE.Vector3(pos.getX(tipI), pos.getY(tipI), pos.getZ(tipI));

  // Elbow-region vertex: closest to the ForeArm bone origin.
  const foreBone = f.skeleton!.bones.find((b) => b.name === "R_ForeArm")!;
  const elbow = new THREE.Vector3();
  foreBone.getWorldPosition(elbow);
  let elbI = 0;
  let bestD = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const d = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).distanceTo(elbow);
    if (d < bestD) {
      bestD = d;
      elbI = i;
    }
  }
  const bindElb = new THREE.Vector3(pos.getX(elbI), pos.getY(elbI), pos.getZ(elbI));

  // Bend the forearm 75 degrees forward (climb-like).
  const rest = foreBone.userData.rest as { x: number; y: number; z: number };
  foreBone.rotation.set(rest.x - 1.31, rest.y, rest.z);
  f.root.updateMatrixWorld(true);
  f.skeleton!.update();

  const poseTip = fore.getVertexPosition(tipI, new THREE.Vector3());
  const poseElb = fore.getVertexPosition(elbI, new THREE.Vector3());
  const tipMove = poseTip.distanceTo(bindTip);
  const elbMove = poseElb.distanceTo(bindElb);
  // Wrist end must travel a substantial arc with the bend…
  assert.ok(tipMove > 0.16, `wrist-end moved only ${tipMove.toFixed(3)} m under a 75° elbow bend`);
  // …while the elbow region stays near the joint (blend, no tear-open gap).
  assert.ok(elbMove < 0.06, `elbow vertex tore ${elbMove.toFixed(3)} m from the joint`);
  assert.ok(elbMove < tipMove * 0.35, `elbow moved ${(elbMove / tipMove * 100).toFixed(0)}% of the wrist — joint not blended`);

  // Restore bind pose: skinned vertices return to their bind positions.
  foreBone.rotation.set(rest.x, rest.y, rest.z);
  f.root.updateMatrixWorld(true);
  f.skeleton!.update();
  const backTip = fore.getVertexPosition(tipI, new THREE.Vector3());
  assert.ok(backTip.distanceTo(bindTip) < 1e-3, "rest pose did not restore bind position");
});

test("skinIndex addresses skeleton bone array, not SKIN_DRIVER_BONES compact order", () => {
  const f = createSkinnedWanderer();
  assert.ok(f.skeleton);
  const sleeve = skinnedPart(f, "SleeveR");
  const si = sleeve.geometry.attributes.skinIndex as THREE.BufferAttribute;
  const sw = sleeve.geometry.attributes.skinWeight as THREE.BufferAttribute;
  const skelIdx = f.skeleton.bones.findIndex((b) => b.name === "R_UpperArm");
  const driverIdx = SKIN_DRIVER_BONES.indexOf("R_UpperArm");
  assert.ok(skelIdx >= 0 && driverIdx >= 0);
  assert.notEqual(skelIdx, driverIdx, "vacuous: skeleton order matches driver-list order");
  let hitsSkel = 0;
  let hitsDriver = 0;
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k) as number;
      if (w < 0.25) continue;
      const idx = si.getComponent(i, k) as number;
      if (idx === skelIdx) hitsSkel++;
      if (idx === driverIdx) hitsDriver++;
    }
  }
  assert.ok(hitsSkel > 8, `SleeveR has no high-weight vertices on skeleton index of R_UpperArm (${skelIdx})`);
  assert.ok(
    hitsSkel > hitsDriver,
    `SleeveR weights look like driver-list order (skel hits ${hitsSkel}, driver-index hits ${hitsDriver})`,
  );
});

test("every skinned mesh is bound to the shared skeleton with in-range indices", () => {
  const f = createSkinnedWanderer();
  assert.ok(f.skeleton);
  const nBones = f.skeleton.bones.length;
  let count = 0;
  f.root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    count++;
    assert.equal(sm.skeleton, f.skeleton, `${sm.name} not bound to the shared skeleton`);
    const si = sm.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const sw = sm.geometry.attributes.skinWeight as THREE.BufferAttribute;
    assert.ok(si && sw, `${sm.name} missing skin attributes`);
    for (let i = 0; i < si.count; i++) {
      for (let k = 0; k < 4; k++) {
        const idx = si.getComponent(i, k) as number;
        assert.ok(idx >= 0 && idx < nBones, `${sm.name} vertex ${i} skinIndex ${idx} not in skeleton.bones`);
      }
    }
  });
  assert.ok(count >= 12, `expected many skinned parts, got ${count}`);
});

test("bending the knee deforms the shin continuously, not as a doll joint", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const shin = skinnedPart(f, "ShinL");
  const pos = shin.geometry.attributes.position as THREE.BufferAttribute;
  let tipI = 0;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < minY) {
      minY = pos.getY(i);
      tipI = i;
    }
  }
  const bindTip = new THREE.Vector3(pos.getX(tipI), pos.getY(tipI), pos.getZ(tipI));
  const legBone = f.skeleton!.bones.find((b) => b.name === "L_Leg")!;
  const knee = new THREE.Vector3();
  legBone.getWorldPosition(knee);
  let knI = 0;
  let bestD = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const d = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).distanceTo(knee);
    if (d < bestD) {
      bestD = d;
      knI = i;
    }
  }
  const bindKn = new THREE.Vector3(pos.getX(knI), pos.getY(knI), pos.getZ(knI));
  const rest = legBone.userData.rest as { x: number; y: number; z: number };
  legBone.rotation.set(rest.x + 1.15, rest.y, rest.z);
  f.root.updateMatrixWorld(true);
  f.skeleton!.update();
  const poseTip = shin.getVertexPosition(tipI, new THREE.Vector3());
  const poseKn = shin.getVertexPosition(knI, new THREE.Vector3());
  const tipMove = poseTip.distanceTo(bindTip);
  const knMove = poseKn.distanceTo(bindKn);
  assert.ok(tipMove > 0.12, `ankle-end moved only ${tipMove.toFixed(3)} m under a knee bend`);
  assert.ok(knMove < 0.07, `knee vertex tore ${knMove.toFixed(3)} m from the joint`);
  assert.ok(knMove < tipMove * 0.45, `knee moved ${((knMove / tipMove) * 100).toFixed(0)}% of the ankle — joint not blended`);
  legBone.rotation.set(rest.x, rest.y, rest.z);
  f.root.updateMatrixWorld(true);
  f.skeleton!.update();
  const backTip = shin.getVertexPosition(tipI, new THREE.Vector3());
  assert.ok(backTip.distanceTo(bindTip) < 1e-3, "rest pose did not restore bind position");
});

test("front face uses a continuous sculpted cranium, not attached nose/lips", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const eye = f.root.getObjectByName("EyeL");
  const brow = f.root.getObjectByName("BrowL");
  const cranium = f.root.getObjectByName("Cranium");
  assert.ok(eye && brow && cranium);
  assert.equal(f.root.getObjectByName("Nose"), undefined);
  assert.equal(f.root.getObjectByName("LipU"), undefined);
  assert.equal(f.root.getObjectByName("LipD"), undefined);
  const eyePos = new THREE.Vector3();
  eye.getWorldPosition(eyePos);
  assert.ok(eyePos.z > 0.08, `EyeL too far back z=${eyePos.z}`);

  const skipGlider = (o: THREE.Object3D) => {
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p.name === "Glider" || p.name === "GliderStowed") return true;
      p = p.parent;
    }
    return false;
  };
  const targets: THREE.Object3D[] = [];
  f.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !skipGlider(o)) targets.push(o);
  });
  const ray = new THREE.Raycaster();
  ray.far = 1;
  const eyeMeshes: THREE.Object3D[] = [];
  eye.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) eyeMeshes.push(o);
  });
  const quat = new THREE.Quaternion();
  eye.getWorldQuaternion(quat);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  ray.set(eyePos.clone().addScaledVector(fwd, 0.08), fwd.clone().negate());
  const eyeHits = ray.intersectObjects(eyeMeshes, false);
  assert.ok(eyeHits.length > 0, "left eyeball has no surface on its own forward");

  const craniumBox = new THREE.Box3().setFromObject(cranium);
  const bridgeY = craniumBox.min.y + (craniumBox.max.y - craniumBox.min.y) * 0.47;
  ray.set(
    new THREE.Vector3(0, bridgeY, craniumBox.max.z + 0.05),
    new THREE.Vector3(0, 0, -1),
  );
  const noseHits = ray.intersectObjects(targets, false);
  assert.ok(noseHits.length > 0, "ray into the sculpted nasal bridge missed");
  assert.ok(
    isFaceObject(noseHits[0]!.object),
    `nasal bridge ray hit ${noseHits[0]!.object.name}`,
  );
});

test("vest covers the ribcage sides (no armhole/hem hole)", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const skipGlider = (o: THREE.Object3D) => {
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p.name === "Glider" || p.name === "GliderStowed") return true;
      p = p.parent;
    }
    return false;
  };
  const targets: THREE.Object3D[] = [];
  f.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !skipGlider(o)) targets.push(o);
  });
  const ray = new THREE.Raycaster();
  ray.far = 2;
  const isVestHit = (obj: THREE.Object3D) => {
    let p: THREE.Object3D | null = obj;
    while (p) {
      if (p.name === "Vest" || p.name.startsWith("Vest")) return true;
      p = p.parent;
    }
    return false;
  };
  // Front-oblique rays into the vest wings, missing the hanging sleeves.
  for (const y of [1.2, 1.28, 1.36]) {
    ray.set(new THREE.Vector3(0.32, y, 0.42), new THREE.Vector3(-0.45, 0, -1).normalize());
    const hits = ray.intersectObjects(targets, false);
    assert.ok(hits.length > 0, `vest-wing ray at y=${y} missed`);
    const vestHit = hits.find((h) => isVestHit(h.object) && h.distance < 0.5);
    assert.ok(vestHit, `vest-wing ray at y=${y} never hit vest (first ${hits[0]!.object.name})`);
  }
});

test("vest front has cloth thickness, not a penetrating chest gap", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const skipGlider = (o: THREE.Object3D) => {
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p.name === "Glider" || p.name === "GliderStowed") return true;
      p = p.parent;
    }
    return false;
  };
  const targets: THREE.Object3D[] = [];
  f.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !skipGlider(o)) targets.push(o);
  });
  const ray = new THREE.Raycaster();
  ray.far = 2;
  const isVestHit = (obj: THREE.Object3D) => {
    let p: THREE.Object3D | null = obj;
    while (p) {
      if (p.name === "Vest" || p.name.startsWith("Vest")) {
        return true;
      }
      p = p.parent;
    }
    return false;
  };
  for (const y of [1.22, 1.3, 1.38]) {
    ray.set(new THREE.Vector3(0, y, 0.55), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObjects(targets, false);
    assert.ok(hits.length > 0, `chest-center ray at y=${y} missed`);
    assert.ok(
      isVestHit(hits[0]!.object),
      `chest-center ray at y=${y} punched through to ${hits[0]!.object.name}`,
    );
  }
});

test("spine bend deforms the torso smoothly (no rigid chest slab)", () => {
  const f = createSkinnedWanderer();
  f.root.updateMatrixWorld(true);
  const torso = skinnedPart(f, "Torso");
  const pos = torso.geometry.attributes.position as THREE.BufferAttribute;
  // Sample: highest-y vertex (near collar) and mid-y vertex.
  let topI = 0;
  let midI = 0;
  let maxY = -Infinity;
  let bestMidY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > maxY) {
      maxY = pos.getY(i);
      topI = i;
    }
    const d = Math.abs(pos.getY(i) - 1.45);
    if (d < bestMidY) {
      bestMidY = d;
      midI = i;
    }
  }
  const bindTop = new THREE.Vector3(pos.getX(topI), pos.getY(topI), pos.getZ(topI));
  const bindMid = new THREE.Vector3(pos.getX(midI), pos.getY(midI), pos.getZ(midI));

  const chest = f.skeleton!.bones.find((b) => b.name === "Chest")!;
  const rest = chest.userData.rest as { x: number; y: number; z: number };
  chest.rotation.set(rest.x + 0.55, rest.y, rest.z);
  f.root.updateMatrixWorld(true);
  f.skeleton!.update();
  const poseTop = torso.getVertexPosition(topI, new THREE.Vector3());
  const poseMid = torso.getVertexPosition(midI, new THREE.Vector3());
  const topMove = poseTop.distanceTo(bindTop);
  const midMove = poseMid.distanceTo(bindMid);
  assert.ok(topMove > 0.06, `collar vertex moved only ${topMove.toFixed(3)} m under chest bend`);
  assert.ok(midMove > 0.005, `mid-torso vertex did not follow the spine bend (${midMove.toFixed(3)})`);
  assert.ok(midMove < topMove, "mid-torso moved more than the collar (implausible spine)");
});
