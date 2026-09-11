# Character integration (lead wires Scene)

`figures.ts` already re-exports `createSkinnedWanderer` as `createWanderer` and `animateSkinnedWanderer` as `animateWanderer`. Scene can keep:

```ts
const wanderer = useMemo(() => createWanderer(), []);
wanderer.root.position.set(p.x, p.y, p.z);
wanderer.root.rotation.y = p.yaw;
animateWanderer(wanderer, sim.t, st, p.attackT);
<primitive object={wanderer.root} />
```

No Scene change is required for the new body. Optional upgrades below.

## Exports

From `aetherwake/src/game/wandererRig.ts` (and `character/`):

| Export | Role |
|---|---|
| `createSkinnedWanderer(opts?: { lod?: 0 \| 1 })` | Sync hero. Default lod 0 (fingers, hair cards, face). |
| `animateSkinnedWanderer(f, t, state, attackT)` | Joint poses for every `AnimState`. |
| `createWandererLod()` | lod 1: mitten hands, fewer segs. |
| `loadRiggedGLB(url?)` | Async. Loads `/assets/character/wanderer.glb` if present; on failure returns the original. Attaches sword/glider/slate. |
| `createWandererMaterials()` | PBR palette. |
| `WANDERER_HEIGHT` | `1.8` (body bbox ~1.78 m). |
| `WANDERER_FORWARD` | `"+z"` |
| `WANDERER_BONES` | Core bone name list. |

`LimbSet` / `AnimState` unchanged.

## Scale, origin, forward

- 1 world unit = 1 meter.
- Root origin is the feet (`y = 0`). Hips at `y = 1.0`. Crown ~1.78 m.
- Character faces **+Z**. Scene yaw on `root` is unchanged.
- Do not extra-scale the root.

## Bone names

Core: `Hips`, `Spine`, `Chest`, `Neck`, `Head`, `L_Clavicle`, `R_Clavicle`, `L_UpperArm`, `R_UpperArm`, `L_ForeArm`, `R_ForeArm`, `L_Hand`, `R_Hand`, `L_UpLeg`, `R_UpLeg`, `L_Leg`, `R_Leg`, `L_Foot`, `R_Foot`, `L_Toe`, `R_Toe`.

Fingers (lod 0): `L_/R_` + `Thumb1-2`, `Index1-3`, `Middle1-3`, `Ring1-3`, `Pinky1-3`.

LimbSet hooks:

- `torso` → `Chest`
- `head` → `Head`
- `larm` / `rarm` → upper arms
- `lleg` / `rleg` → upper legs
- `sword` parented to `R_Hand`
- `slate` parented to `L_Hand`
- `glider` parented to `Chest` (open kite, hidden until `glide`)
- packed kite: `GliderStowed` on `Chest`, hidden while gliding

## AnimState

Implemented: `idle` `walk` `run` `jump` `fall` `land` `climb` `glide` `attack` `swim` `bow` `hit` `death`.

Scene today never selects `land`. To use it, after a fall/jump becomes grounded keep `land` for ~0.22 s, then idle/walk.

`attackT` is remaining phase time from sim. The rig also clocks a local swing from the frame `state` becomes `"attack"` (windup 0.1 / active 0.14 / recover 0.16). Passing attack phase from sim would be nicer later; not required.

Poses lerp so state changes do not snap.

## Optional Scene wiring

1. **GLB swap** (only if a licensed file is later dropped at `public/assets/character/wanderer.glb`):

```ts
const wanderer = useMemo(() => createWanderer(), []);
useEffect(() => {
  let live = true;
  loadRiggedGLB("/assets/character/wanderer.glb").then((rig) => {
    if (!live || rig.root.userData.kind === "wanderer") return;
    // replace primitive object with rig.root
  });
  return () => { live = false; };
}, []);
```

Keep the sync original as the guaranteed hero. There is currently no vendored GLB.

2. **LOD**: if camera distance > ~18, swap to `createWandererLod()` or pass `{ lod: 1 }`.

3. **Land**: `p.grounded && prevAirborne && landTimer > 0`.

## Materials / lights

All hero materials are `MeshStandardMaterial` (PBR). Existing hemisphere + ambient + directional sun in Scene is enough. Do not wrap the hero in toon materials.

## Do not

- Do not rotate the mesh to -Z; it already faces +Z.
- Do not parent the glider to root at world height 1.35 (legacy). It lives on `Chest`.
- Do not buy / hotlink Mixamo or Ready Player Me files.
