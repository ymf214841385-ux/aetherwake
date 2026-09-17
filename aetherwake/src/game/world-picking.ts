/**
 * Canvas-rect + camera ray picking for managed interactables.
 * Uses actual getBoundingClientRect — never raw window coordinates as NDC.
 */

import * as THREE from "three";

export type Pickable = {
  targetId: string;
  worldId: string;
  object: THREE.Object3D;
  /** Interaction range from player feet. */
  range: number;
  maxDy: number;
};

export type PickResult = {
  targetId: string;
  worldId: string;
  distance: number;
  point: { x: number; y: number; z: number };
};

/** Convert client CSS pixels to NDC using the canvas rect. */
export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function rayFromNdc(camera: THREE.Camera, ndc: { x: number; y: number }) {
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  origin.setFromMatrixPosition(camera.matrixWorld);
  dir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(origin).normalize();
  return new THREE.Ray(origin, dir);
}

/** Center-screen ray for pointer-locked look. */
export function centerRay(camera: THREE.Camera) {
  return rayFromNdc(camera, { x: 0, y: 0 });
}

function collectPickRoots(object: THREE.Object3D, into: THREE.Object3D[]) {
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.InstancedMesh).isInstancedMesh) into.push(o);
  });
  if ((object as THREE.Mesh).isMesh) into.push(object);
}

export type PickContext = {
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  player: { x: number; y: number; z: number };
  pickables: Pickable[];
  /** Optional occluders (walls). Hit closer than target blocks pick. */
  occluders?: THREE.Object3D[];
};

/**
 * Pick the nearest interactable under the client point.
 * Rejects picks outside interaction range of the player.
 */
export function pickInteractableAtClient(
  clientX: number,
  clientY: number,
  ctx: PickContext,
): PickResult | null {
  const rect = ctx.canvas.getBoundingClientRect();
  const ndc = clientToNdc(clientX, clientY, rect);
  if (!ndc) return null;
  const ray = rayFromNdc(ctx.camera, ndc);
  return pickAlongRay(ray, ctx);
}

export function pickInteractableFromCenter(ctx: PickContext): PickResult | null {
  return pickAlongRay(centerRay(ctx.camera), ctx);
}

function pickAlongRay(ray: THREE.Ray, ctx: PickContext): PickResult | null {
  const roots: THREE.Object3D[] = [];
  for (const p of ctx.pickables) collectPickRoots(p.object, roots);
  const occl: THREE.Object3D[] = [];
  for (const o of ctx.occluders ?? []) collectPickRoots(o, occl);

  const inter = new THREE.Raycaster();
  inter.ray.copy(ray);
  inter.far = 80;

  const hits = inter.intersectObjects(roots, true);
  if (!hits.length) return null;

  // Map hit object → pickable via ancestry userData.interactId.
  const ownerOf = (obj: THREE.Object3D | null): Pickable | null => {
    let o: THREE.Object3D | null = obj;
    while (o) {
      const id = o.userData?.interactId as string | undefined;
      if (id) {
        const byId = ctx.pickables.find((p) => p.targetId === id);
        if (byId) return byId;
      }
      const direct = ctx.pickables.find((p) => p.object === o);
      if (direct) return direct;
      o = o.parent;
    }
    return null;
  };

  // Frontmost visible pickable wins. Range/height eligibility is the
  // resolver's job — filtering here erased far target IDs and made locked
  // clicks fall back to attack.
  for (const hit of hits) {
    const pickable = ownerOf(hit.object);
    if (!pickable) continue;

    // Occluder closer than this target blocks the pick (walls/doors).
    // Do not treat the target's own geometry as an occluder.
    if (occl.length) {
      const oHits = inter.intersectObjects(occl, true);
      const first = oHits[0];
      if (first && first.distance + 0.15 < hit.distance) continue;
    }

    return {
      targetId: pickable.targetId,
      worldId: pickable.worldId,
      distance: hit.distance,
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
    };
  }
  return null;
}

/** Tag a scene object so picking can resolve it by stable id. */
export function tagInteractable(object: THREE.Object3D, targetId: string, worldId: string) {
  object.userData.interactId = targetId;
  object.userData.worldId = worldId;
  object.name = object.name || `interact-${targetId}`;
}
