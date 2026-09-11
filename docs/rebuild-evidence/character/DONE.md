# Character worker DONE

Date: 2026-09-10

## What shipped

Original PBR traveler (not Link, not a ball-head cylinder). Still **not** a photoreal scanned GLB — none could be obtained without login/pay, and photogrammetry was not required.

This pass targeted the oval blank face, vest holes, and toy limbs:

- Adult height ~1.78 m, hips at 1.0, feet on y=0, faces +Z. Bone names unchanged.
- True `SkinnedMesh` body/clothing on one shared skeleton. `skinIndex` is skeleton-array order (including fingers), not `SKIN_DRIVER_BONES` compact order. Elbow/knee blend continuously. Head/face/hair rigid on Head; fingers rigid on finger bones; sword/slate/glider rigid; boots locked to Foot.
- Face: sclera + iris + pupil + highlight, lid rims, lashes, brows, volume nose, centered lips, ears. Readable on isolated FRONT and on Scene.tsx `scene-face.png` / `scene-front.png`. Still a procedural mannequin, not a photographed adult. T15 not signed off.
- Vest: DoubleSide leather, hem band, armhole rims, Chest/Spine-weighted so WALK/CLIMB no longer tear diamond holes.
- Shoulders: sleeve caps overlapping torso. Limbs: tapered lathes with elbow/knee swell. Boots: shaft flared into vamp + sole, Foot-locked.
- Hair: receded hairline (FRONT ray from `(0,1.62,0.2)` hits skin first), crown, short tail, lod-0 cards.
- Isolated FRONT/SIDE/BACK/FACE + motion stills, **and** Scene.tsx gameplay closeups via `scripts/capture-hero-gameplay.mjs`.

No third-party character GLB is vendored. Search notes: `ASSET_NOTES.md`.

## Licenses

- Hero mesh, textures, and poses: original to this repo (game source).
- No Mixamo / Rocketbox / Quaternius / Kenney files in `public/assets/character/`.
- Loader will accept a future CC0/CC-BY GLB at `/assets/character/wanderer.glb`.

## Remaining gaps

See `ASSET_NOTES.md` and `VISUAL_REVIEW.md`. Still not a scanned/LBS GLB. Closeup face is a readable mannequin. Shoulders still a bit boxy. Scene "run" capture did not reach sprint speed. Scene "climb" capture had no wall and reverted to idle. Isolated `motion-climb.png` is the climb pose.

## Files

- `aetherwake/src/game/wandererRig.ts` — public API re-export (untouched API)
- `aetherwake/src/game/character/types.ts`
- `aetherwake/src/game/character/materials.ts`
- `aetherwake/src/game/character/geometry.ts`
- `aetherwake/src/game/character/build.ts`
- `aetherwake/src/game/character/skinning.ts`
- `aetherwake/src/game/character/animate.ts`
- `aetherwake/src/game/character/loader.ts`
- `aetherwake/src/game/character/lod.ts`
- `aetherwake/src/game/character/index.ts`
- `aetherwake/src/game/character/INTEGRATION.md`
- `aetherwake/src/game/character/wanderer.test.ts`
- `aetherwake/scripts/capture-character.mjs`
- `aetherwake/scripts/capture-character-entry.ts`
- `aetherwake/scripts/capture-character.html`
- `aetherwake/scripts/capture-hero-gameplay.mjs` — Scene.tsx gameplay closeups
- `aetherwake/public/assets/character/LICENSE.txt`
- `docs/rebuild-evidence/character/ASSET_NOTES.md`
- `docs/rebuild-evidence/character/DONE.md`
- `docs/rebuild-evidence/character/VISUAL_REVIEW.md`

`figures.ts` / `Scene.tsx` untouched. Existing re-export keeps the hero live. No Scene wiring required.
