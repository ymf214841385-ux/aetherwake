# Lead gameplay fixes (2026-09-10)

HEAD base: `3751f0d`. Lead owns sim.ts / physics.ts / world.ts / Scene.tsx / GameClient.tsx / figures.ts / pack-release.mjs.

Workers this session:
- visual `01a086f4-28a4-7a30-a31c-0207b6c50df8`
- QA `01a086f4-28a4-7a30-a31c-0212beb1823d` (done, 49 harness unit tests)
- tower tests `01a086f4-28a4-7a30-a31c-0221be08b9b4` (done, 23 mainline unit tests)

## Scene (CODEX_REVIEW_07 invisible terrain)

- Terrain uses `buildDisplacedTerrainGeometry()` + splat `vColor.rgb` material, FrontSide, `frustumCulled=false`.
- Stopped assigning `next.grass` as a workaround.
- PBR `createPropMaterials` on trees/rocks/grass; water rest Y + `updateWaterMaterial`; grass wind.
- InstancedMesh: material as prop (not args) so map-load remount does not wipe instance matrices; `useLayoutEffect` writes matrices.
- Tree scatter scale raised (~2–5× kit height) + seven landmark trees near spawn.

In-game `hero-close.png` / `spawn-vista.png` now show opaque heightfield (dirt/grass/rock splat), not the water plane. Character feet on the awakening pad. Trees/grass were missing while matrices reset; recaptured after the instance fix.

## Climb (CODEX_REVIEW_06 grabRest 12 m)

- `grabRest` remains gone. Local mantle `MANTLE_REACH_XZ=1.85`, step 0.12 / 0.18.
- Wall shimmy (`CLIMB_SHIMMY=2.2`) toward a same-height balcony; no opposite-face 11 m snap.
- Lip finish: last 16 cm onto a rest at matching Y (the 0.1 skip left the player 1 cm off the pad and S-dropped).
- `TOWER_LEDGE_RADIUS=5.9` so inner edge 4.675 sits outside shaft 4.2 / capsule 4.52.

`sim.test.ts` 16 pass including “S does not teleport 12 m” and rest re-grab.

## Round 14 — mere water / dawn rest (HEAD 53d22a2 + dirty)

Headed route 11:02 lit four shrines + crown only. Two separate causes, not another 20-minute loop:

1. **Gameplay (mere).** Shaft cylinder started at pad y=7.8. Waterline `queryWall` skipped it (`mid < base`). Players and the harness swam through the hollow under the pad (`xz≈4.0–4.4`) instead of grabbing a wall. Fix: `towerShaftBaseY` extends docked-tower collision (and the figures mesh) down to `WATER_LEVEL-0.6`. Rest ledges and stamina costs unchanged. Node: W+E from south-dock water starts climb and does not enter the hollow.
2. **Harness steering (dawn + mere).** `baseY` was the player’s approach/swim y, which shifted the 3 authored rest rows. Policy then S-dropped at the wrong height (mantle miss) and Space-jumped in the lake. Fix: authored `TOWER_BASE_Y`, W+E `approach-grab` while swimming near the tower, `burstUntil` actually suppresses S-drop for the first ~4 m after regrab. `isInShaft` is the hollow, not the wall-hug.

Did not teleport, write progress, or lower gates.

3. **Citadel.** Visual already had a +Z gate; collision was a closed 22 m bar and the keep filled the boss spawn. Gate wings now match the visual opening; boss stands in the +Z courtyard. Seal still needs three towers and four shrines. Node: walk from +Z reaches the boss.

4. **Leave mere.** Headed same-save run lit dawn+mere+four shrines, then W-only swim auto-grabbed 镜湖塔 while walking to crown. Swim grab now requires E/climb (harness already uses W+E). goTo dismounts a far wall with dodge, not S-slide. Node: W-only swim-away does not re-grab.

## Round 15 — 78160 vs 78945 vs 80160 (do not merge runs)

Preserved: `docs/rebuild-evidence/archive-20260910-130550-pid80160` and `archive-20260910-131805-pid80160-final`.

| Run | Towers | Mere | Boss | ruinSolved after reload |
|---|---|---|---|---|
| 78160 | dawn,mere,crown | rest y=10.1 then cap | prompt 挑战空王, bossDead=false | towers restored; ruinSolved dropped |
| 78945 | dawn,crown | fell/shaft xz=4.5 y≈3.5 looping | skipped (incomplete towers) | mere missing; ruinSolved dropped |
| 80160 | dawn,mere,crown | rest y=27.3 then cap | 2 hits then death at d=1.4; respawn 117 m away; boss hp 20→9.2 never dead | towers restored; ruinSolved dropped |

**Mere difference (finding, not a theory):** 78160/80160 grabbed with W+E from the swim ring. 78945 logged `fell/shaft y=3.8 xz=4.5` — wall-hug, not the hollow (`isInShaft` is xz < 4.05). A looser shaft test treated the hug as a detour and never re-grabbed. Policy now: wall-hug is not shaft; rest only when grounded **and** `nearLedge`; stamina to 88% before regrab. Reproduction: `climb-policy.test.mjs` “mere wall-hug xz=4.5 is not the hollow”.

**Boss (finding):** `fightBoss()` faced static `POI.citadel` (6,-5). Live boss moves; melee used body yaw which only updates while walking, so look-then-click missed. 80160 log: swing=20 d=1.4 player hp=0.25 boss hp=16.4 (two hits), then d=117 after 在篝火旁醒来, walking back at 140 ms/step. Prompt `挑战空王` is proximity, not combat start. Knockback also shoved the boss through `citadel-keep`; LOS then blocked further hits (Node: 2–3 hits then stall at the keep face z≈−7). Fixes: melee uses `cam.yaw`; knockback runs `resolveHorizontal`; harness aims at live boss, sprint-reapproach after death, dodge on telegraph, back+strafe when d<1.65. Node now kills the boss with ordinary melee+dodge.

**ruinSolved (finding):** save schema had no `progress.ruinSolved`. Runtime true, reload false — missing persist, not a designed reset. Now written/loaded; docked planks restored so the wind bridge still exists. `saveReloadRestored` fails on true→false.

Did not teleport, write rewards, lower stamina/geometry, or merge 78160 towers with 80160 boss.

## Round 16 — 90227 courtyard edge (do not merge runs)

Preserved: `docs/rebuild-evidence/archive-20260910-1555-pid90227`.

90227 same-save: 3 towers, 4 shrines, ruinSolved true after reload. 11/11 blade hits 20→0.2 at playerHp=2, deaths counted 0. Then reapproach loop at x≈-11, z≈-6, y=7.4–8.4, d=8.9–10.2 until the 180s window ended. Not the old facing miss and not low-HP.

**Finding:** citadel wall solids sat on `CITADEL_POI.y`≈12.2 (keep pad). Courtyard fight floor is ≈10.6. `queryWall` at courtyard y returned null, so dodge (no horizontal resolve either) walked under `citadel-wall--11-0` and dropped down the west slope. `goTo(boss)` from that pose is the wall/slope, not a path.

**Fix (ordinary collision + steer, no HP/damage/time cheat):**
- Wall collision and meshes extend down to courtyard (`citadelWallMetrics`), top unchanged. Gate gap still open at courtyard y.
- Dodge applies `resolveHorizontal` (i-frames are not wall-clip).
- Harness dodges toward a courtyard-safe aim; off-arena / stalled reapproach uses north-around-wall then +Z gate waypoints.

Node: west-face query at courtyard y hits the wall; dodge from x=-2 stays x>-5; bee-line from 90227 pose does not reach attack range; gate path does. `ordinary melee + dodge can kill the live boss` still passes.

Did not grant HP, teleport, finish the last 0.2 by script, or extend the combat window.

## Round 19 — wrong-shrine E at 91 m (91526)

Preserved: `docs/rebuild-evidence/archive-20260910-1623-pid91526`.

91526 same-save: 3 towers, pull+rime+burst, missing still/4th orb, citadel skipped. Log: `go shrine still` then `stuck dist=85.6 at 36.6,10.5`; `at still face0 dist=91.1 prompt=进入 牵引祠`; `entered shrine 2`; left with still unsolved.

**Finding (not a theory):** `goTo` timeout returned the current pose with no failed status, so `follow`/`tryEnterShrine` treated non-arrival as the door. Enter used generic `叩响|进入` and pressed E on 牵引祠 (index 2) while requesting 凝时祠. 36.6,10.5 is the pull apron; a west bee-line from there into the courtyard hits the new citadel east wall (hypothesis for nearby west travel). Did not teleport still or hide the miss.

**Fix:** `navigationOutcome` marks timeout/nonarrival `arrived:false`. Enter requires proximity to the intended shrine **and** exact `叩响/进入 ${name}`. Entered `sim.shrine` must match requested id before solving. Still overworld path goes south from burst then the z=-90 ridge, not west through pull. Regression: 91 m wrong-shrine prompt refuses E.

Boss courtyard wall collision from round 16 is unchanged.

## Not done by lead

- Browser play-routes on a **fixed** `build:app` preview (after visual worker lands).
- 600 s stability with owned browser lifecycle.
- User art sign-off (T15/T24). Character still procedural; visual worker still running.
- Release ZIP after workers land.
