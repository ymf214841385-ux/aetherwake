# Character asset search (2026-09-10)

Goal: a legally redistributable, realistic adult humanoid GLB + compatible clips, curlable without login/pay, localized under `aetherwake/public/assets/character/`.

## Checked and rejected

| Source | License | Why not shipped |
|---|---|---|
| Khronos glTF Sample Assets (CesiumMan, RiggedFigure, Fox) | various sample terms | Not an adventurer; CesiumMan is a spacesuit mannequin. Task said not to use Khronos samples as the hero. |
| Poly Haven models | CC0 | Props / scans only. No humanoid. |
| Mixamo (Y Bot, X Bot, Soldier, Remy) | Adobe Mixamo | Needs login. Redistributing the GLB outside Mixamo's app is not clearly allowed. |
| Microsoft Rocketbox | MIT | Realistic, Mixamo-compatible, but **FBX + Unity textures**, casual/office clothes, not a fantasy traveler. No GLB on the default tree. |
| Mesh2Motion `human-base-animations.glb` / `human-skeleton.glb` | CC0 | Skeleton/clips only (DEF bones, no clothed mesh). Clips will not retarget onto our hierarchy without a retargeter we do not have. |
| Quaternius / KayKit / Kenney characters | CC0 | Cartoon / low-poly block people. User asked to stop looking cartoon. |
| MakeHuman / MPFB2 base.obj | CC0 | Nude androgynous base in decimeters, untextured, no clothes, no glTF, no game animations. |
| Ready Player Me / VRoid | platform terms | Login, anime or generated avatars, not redistributable as a unique original hero. |
| Sketchfab CC0 humans | mixed | Downloads generally need an account. |

No CC0/CC-BY **clothed realistic adventurer** with a full skeleton and walk/run/jump/climb/glide/attack clips could be curled without login or payment. A photoreal scanned GLB is not required and was not the only acceptable path; this pass improved the procedural rig instead.

`unlicensed-hold/` was not copied into `public/`.

## What shipped instead

Original hierarchical humanoid in `aetherwake/src/game/character/`, PBR `MeshStandardMaterial`, adult proportions (~1.78 m), true `SkinnedMesh` body/clothing with proximity LBS weights whose `skinIndex` addresses the full skeleton bone array (not the driver-list order).

This pass (face / vest / limbs):

- Eyes with sclera, brown iris, pupil, highlight, lid rims, lashes, brows.
- Centered lips and a volume nose; ears.
- Open leather vest, DoubleSide, hem band, armhole rims, sharper Chest/Spine weights so the shell does not collapse into holes.
- Connected sleeve caps, joint swell on elbows/knees, lasted boots locked to Foot.
- Receded hairline; forehead reads from +Z.

`loadRiggedGLB()` is ready if a licensed GLB is added later at `public/assets/character/wanderer.glb`. That file is **not** present.

## Remaining gaps

- No authored/scanned GLB, no mocap, no hand-painted UV atlas.
- Face is readable, still a procedural mannequin at closeup.
- Hair is cap + tail + cards, not strand grooms.
- Clothing folds are procedural displacement, not simulated cloth.
- Canvas PBR maps exist only in a browser (`document`); Node tests run untextured.

T15 is not signed off.
