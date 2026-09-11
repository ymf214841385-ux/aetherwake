# Character visual review (Worker A)

Date: 2026-09-10. Isolated module shots **and** Scene.tsx gameplay closeups. T15 is **not** user-approved. Not photoreal, not photogrammetry.

## Before (this rebuild's failure)

Isolated `character/front.png` at 09:12 (Codex CODEX_REVIEW_08): blank oval cranium with a tiny nose point. Eyes/mouth/brows not readable at full-body or closeup. Vest had jagged diamond holes at the armholes and hem. Sleeves were disconnected balls on lathe tubes. Boots read as split toy lasts.

In-game six-views from earlier passes (`hero-close.png`, `spawn-vista.png`, etc.) showed the old wooden-dummy body until this recapture.

## After — isolated character module (not Scene.tsx)

Method: Vite MPA on `127.0.0.1:8788` + Playwright Chromium `WebGLRenderer` + `RoomEnvironment` PMREM. Entry: `aetherwake/scripts/capture-character.html` → `capture-character-entry.ts`. Does **not** load `Scene.tsx`.

| Shot | Path | Label |
|---|---|---|
| FRONT | `docs/rebuild-evidence/character/front.png` | isolated |
| SIDE | `docs/rebuild-evidence/character/side.png` | isolated |
| BACK | `docs/rebuild-evidence/character/back.png` | isolated |
| FACE | `docs/rebuild-evidence/character/face.png` | isolated closeup |
| idle | `docs/rebuild-evidence/character/motion-idle.png` | isolated |
| walk | `docs/rebuild-evidence/character/motion-walk.png` | isolated |
| run | `docs/rebuild-evidence/character/motion-run.png` | isolated |
| climb | `docs/rebuild-evidence/character/motion-climb.png` | isolated |
| glide | `docs/rebuild-evidence/character/motion-glide.png` | isolated |
| attack | `docs/rebuild-evidence/character/motion-attack.png` | isolated |

What actually changed:

- **Face is no longer a blank oval.** FRONT full-body now shows two eyes (sclera + brown iris + pupil + highlight), dark brows, a nose with volume, and a centered mouth. Isolated FACE closeup confirms lids/brows/ears. Still a procedural mannequin, not a photographed adult.
- **Vest no longer holes.** Leather is `DoubleSide` with a hem band and armhole rims. SIDE/BACK/WALK/CLIMB no longer show the torn diamond patches. Open front still shows the linen shirt (intended).
- **Shoulders connect.** Sleeve caps overlap the torso instead of a floating deltoid ball. Still a bit boxy.
- **Limbs have joint swell** (elbow/knee bulbs, muscle taper) instead of constant-radius rods. Still lathed, not scanned.
- **Boots** are shaft + vamp + sole locked to the Foot bone, with the shaft flared into the vamp. Better than split tubes, not a lasted photographic shoe.
- **SkinnedMesh unchanged in contract.** One shared skeleton. `skinIndex` is `skeleton.bones` order (including fingers). Elbow/knee vertices blend both bones.

## After — Scene.tsx gameplay closeups (the live hero)

Method: `aetherwake/scripts/capture-hero-gameplay.mjs`. Starts the real Vite app (TanStack Start + `Scene.tsx`). Clicks 开始探索. The wanderer is the one Scene mounts via `createWanderer` / `animateWanderer`. Camera is **forced close at screenshot time** because `sim.updateCamera` always lerps `cam.dist` back to `CAM_DIST` (6.2 m); without the patch, a 1.3 m hero shot becomes a 6 m vista in <1 s. That patch is capture-only. Scene.tsx was not edited.

| Shot | Path | Honest note |
|---|---|---|
| scene-front | `docs/rebuild-evidence/character/scene-front.png` | Scene.tsx, idle, camera ~1.35 m |
| scene-side | `docs/rebuild-evidence/character/scene-side.png` | Scene.tsx, idle profile |
| scene-back | `docs/rebuild-evidence/character/scene-back.png` | Scene.tsx, idle back |
| scene-face | `docs/rebuild-evidence/character/scene-face.png` | Scene.tsx, head closeup ~0.58 m |
| scene-walk | `docs/rebuild-evidence/character/scene-walk.png` | Scene.tsx, W held, spd ~2.3 (walk) |
| scene-run | `docs/rebuild-evidence/character/scene-run.png` | Scene.tsx, Shift+W attempted; spd ~3.8 **below** Scene's run threshold 5.6, so this is a **walk**, not a run |
| scene-climb | `docs/rebuild-evidence/character/scene-climb.png` | Scene.tsx; `setMove("climbing")` reverted (no wall). **Idle, not climb.** Isolated `motion-climb.png` is the climb pose |
| scene-glide | `docs/rebuild-evidence/character/scene-glide.png` | Scene.tsx, gliding true, kite open |

Gameplay FRONT/FACE/WALK show the same readable eyes/mouth/vest as the isolated module. Vest stays closed when the chest is in frame. Glide is a real in-game glide.

## Still toy-like? Honest call

**Better than the blank oval / holed vest / rod limbs. Still a procedural PBR traveler, not a natural-adult closeup, not photoreal.**

Remaining toy reads:

- Face at FACE/scene-face distance is a stylized mannequin: iris is a dark disk, lips are simple volumes, skin has no pores. Readable features, not a photograph.
- Hair is a receded cap + crown + tail + cards, not a groom. Hairline is behind the forehead (FRONT ray from `(0, 1.62, 0.2)` hits skin).
- Shoulders are still a bit wide/boxy compared with the reference traveler.
- Black shorts peek under the skirt at the hips.
- Arms are tapered lathes with cuffs, not tailored cloth. A small cuff gap can still show at the elbow from the side.
- Boots are a connected last, not a photographed shoe.
- No scanned/LBS GLB. No mocap. Procedural SkinnedMesh is what shipped.

Do not treat this as T15 art sign-off. A photoreal scanned GLB of a clothed adult adventurer could not be curled without login or payment; see `ASSET_NOTES.md`. That is **not** claimed as the only acceptable path — this pass used procedural work.

## Scene.tsx integration gaps (Lead)

See `aetherwake/src/game/character/INTEGRATION.md`. **No Scene change is required for the body** — `figures.ts` already re-exports `createSkinnedWanderer` as `createWanderer`. Observed read-only:

- Character is wired. A fresh play build shows this body.
- Scene run uses `spd > 5.6`. The gameplay "run" shot did not reach that speed.
- Scene climb needs a climbable wall; forcing `setMove("climbing")` on open ground reverts.
- Follow camera defaults to 6.2 m. Close hero shots in play need the player to zoom or a future cam tweak (not done here).
- Isolated captures use RoomEnvironment; in-game PBR is flatter unless envmaps load.

## Capture commands

```
cd aetherwake && node scripts/capture-character.mjs
cd aetherwake && node scripts/capture-hero-gameplay.mjs
```
