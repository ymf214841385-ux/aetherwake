# Tower / shrine review (Worker 3 / TOWER-TESTS)

Isolated Node reproduction of QF1–QF4. No browser, no `play-routes`, no `stability`.
Progress flags (`towersOn` / `shrinesOn` / `orbs` / `ruinSolved`) are only set by `Sim.step` + keyboard-like `Actions` (W/S, E, climb). Starting `x/y/z` may be placed at a POI — allowed in this unit file, unlike the browser harness.

**Honest: this Node suite is not a browser mainline pass.** Lighting 晨光塔 / 镜湖塔 / 雪冠塔 and claiming shrine orbs here proves `Sim.step` under scripted Actions, not Playwright/`play-routes` on a compiled snapshot.

HEAD at review start: `3751f0dc`. Lead landed `TOWER_LEDGE_RADIUS=5.9` and replaced `grabRest` 12 m snaps with `tryMantle` during this pass. Numbers below are **live** against that tree.

Dedicated tests: `aetherwake/src/game/routes.mainline.test.ts`.
Existing `sim.test.ts` “dawn climb” / “each shrine via sidewalk” still exist; they are **not** the browser route (they teleport onto the sidewalk and/or hold E every frame).

## Test counts

| Suite | Pass | Fail |
|---|---|---|
| `node --experimental-strip-types --test src/game/routes.mainline.test.ts` | **23** | **0** |
| `npm run test:game` (`src/game/**/*.test.ts`) | not rerun (this worker owns only the mainline file) | — |

23 = the previous 19 intents (dawn rest+W+E lights tower; mere swim-climb; crown without spicy; each shrine claimed one-at-a-time via sidewalk; no art auto-clear) plus 4 new constraint tests (local mantle step, opposite-face not reached, W on rest vs shaft, rime pit escape).

They pass because lead already landed 5.9 ledges, local mantle, rest re-grab, swim-climb, `towerShelter`, and shrine `nearInteractable` only at altar/door. If those patches are reverted, they fail.

---

## Exact numbers

Constants: `WATER_LEVEL=3.35`, `TOWER_HEIGHT=38`, `TOWER_RADIUS=4.2`, `PLAYER_RADIUS=0.32`, `BASE_STAMINA=100`, `CLIMB_STAMINA=15` /s, `CLIMB_SPEED=3.4` m/s, `STAMINA_REGEN=28` /s.

Mantle (live, `params.ts` / `sim.ts` `tryMantle`): `MANTLE_REACH_XZ=1.6`, `MANTLE_REACH_Y=2.1`, `MANTLE_STEP_XZ=0.12`, `MANTLE_STEP_Y=0.18`. After `resolveHorizontal`, reject if moved `> step+0.05` (`0.12+0.18+0.05=0.35`). **`grabRest` 12 m teleport is gone.**

**No-rest climb** = `100/15 * 3.4 = 22.667 m`. Shaft to cap is ~37.6 m. Rest is mandatory.

Ledge solids (live): `TOWER_LEDGE_COUNT=12` (4 columns × 3 rows), `r=5.9`, `w=3.45`, `d=2.45`, `h=0.42`. Inner radial edge = `TOWER_LEDGE_RADIUS − TOWER_LEDGE_D/2 = 5.9 − 1.225 = 4.675`. That is **outside** shaft `r=4.2`, **outside** capsule `4.2+0.32=4.52`, and `>= 4.6` (`TOWER_RADIUS+0.4`). Constraint tests assert `TOWER_LEDGE_RADIUS >= 5.9` and `inner >= 4.6`.

`queryWall` skips `standable && h<1`, so ledges are floors, not walls.

Wish on ground: `fx,fz = (-sin(cam.yaw), -cos(cam.yaw))`. After `setMove("grounded")` on a ledge, **W uses camera forward**, not “along the wall”. If the camera still looks at the tower, W walks toward the shaft; rest re-grab (`wantClimb` when `isTowerRest(support)` and `moveY>0.12`) plus the inner lip sitting outside the cylinder keep that from being an instant drop.

### Dawn (10, 68)

| | |
|---|---|
| `heightAt(10,68)` / `TOWERS.dawn.y` | **11.100** |
| Climate at base | temperate (`md` to mountain = 187) |
| Shaft | cyl `r=4.2`, `y=11.10`, `h=37.55` (top 48.65) |
| Cap solid | cyl `y=48.70`, `h=0.45`, `r=3.2` → stand top **49.15** |
| Activate | `hypot(xz)<5.2` and `y > base+35.8` → prompt `启动 晨光塔` |
| No-rest peak | `11.10 + 22.67 ≈ 33.8` (short of cap by ~15 m) |

Ledge tops (authored `towerLedgePlacements`; feet y = `tw.y + localY + h/2`):

| i | row/col | top y | xz at r=5.9 |
|---|---|---|---|
| 0 | 0/0 | 13.41 | 15.80, 69.06 |
| 4 | 1/0 | 30.59 | 15.80, 69.06 |
| 5 | 1/1 | 30.59 | 8.94, 73.80 |
| 8 | 2/0 | 47.76 | 15.80, 69.06 |
| 11 | 2/3 | 47.76 | 11.06, 62.20 |

Row spacing ≈ 17.18 m (3 rows over `ySpan=34.35`). Opposite-face ledge centers are `2*5.9 = 11.8 m` apart. `tryMantle` reach is 1.6 m → **one S/exhaust frame cannot land the far balcony.** Node: one 1/60 S or stam=0 step moves xz `≤ 2 m` (observed local step, not a 12 m snap).

Browser QF1 rested at y=18.1 / 21.2 / 24.4 then fell (`xz=15` or stuck climbing at y=13.5). That was the old inner-overlap + cam-forward W + 12 m `grabRest` mix. Live Node: S-to-ledge rest, then **W+E re-grabs**; 400 ms of W-only from a placed ledge top also stays out of the cylinder.

### Mere (−108, 8)

| | |
|---|---|
| `heightAt(-108,8)` / `mere.y` | **7.800** (FLAT `r=7`, authored 7.8) |
| vs water | +4.45 m at the POI, **not** underwater |
| `heightAt(r=4.2)` | 4.11 (barely dry) |
| `heightAt(r=5)` | **2.51** (swim) |
| `heightAt(r=8)` | −5.74 (lake) |
| Climate | lakeside at all climb y |
| Cap | 45.80 |
| Docks | **8** (`towerNeedsDock` true because the r=8 ring is wet). Dock `y=WATER_LEVEL-0.14=3.21`, `h=0.34`, `r=5.7` |

QA said “base underwater / rest ledges underwater”. That was `computeHeight` without treating the authored flat; live `heightAt` at the POI is 7.8. The **approach** is underwater. `handleLocomotion` allows swim/W/E to start climb and lifts feet to `WATER_LEVEL+0.08`.

South approach `(x, z+4.8)` starts at y=2.38 (swim) and can light the tower in Node. East lake `(x+8)` also can, but only if the player looks back at the shaft after a missed rest (cam-forward swim otherwise drifts).

### Crown (48, −128)

| | |
|---|---|
| `heightAt(48,-128)` / `crown.y` | **16.800** |
| `md` to `MOUNTAIN(30,-118)` | **20.59** (< 78) |
| `climateAt(48,-128, y)` | y=16.8 temperate; y=36 highland; **y>36 frost** |
| Cap | 54.80 |
| Frost climb remaining | 54.8−36 = 18.8 m ≈ 5.5 s at 3.4 m/s |
| HP drain | 0.25 / 3.2 s, `invuln=0.9` does not cover the next tick. 3 hearts → death in **38.4 s** unsheltered |
| Spicy | `cook("pepper")` + `eat` → `player.spicy=90` seconds |

`towerShelter()`: climbing is always temperate; grounded within `d<7.4` and `y>base+0.6` is also temperate. That is why idle-on-ledge at y=41 does **not** tick frost. A careful rest-ledge climb without spicy currently lights 雪冠塔 at full HP **in Node**.

QA “kills in ~13 s” is what happens if you **leave** the tower in frost (or if shelter is reverted) and stand on mountain snow.

### Shrines

`shrineWorldOrigin(i) = { x: 220+i*48, y: 520, z: 0 }`.

| id | overworld | interior origin | pit | sidewalk |
|---|---|---|---|---|
| rime | (−72, 36) y=8.40 | (220, 520, 0) | `lz∈(8,20.4)` **`|lx|<4.8`** drop 4.6 | box x=+7.15, z=+14.2, w=2.55, d=20.6, h=0.34 |
| burst | (118, 28) y=10.20 | (268, 520, 0) | none (crack wall at z+12.4 until bomb) | same + left copy at −7.15 |
| pull | (36, 8) y=9.58 | (316, 520, 0) | `lz∈(10,16.5)` `|lx|<4.6` drop 4.4 | same |
| still | (14, −78) y=13.40 | (364, 520, 0) | same as pull | same; move-block extra support at `(o.x+sin(t·0.9)·5.4, o.y+0.9, o.z+13)` r=1.5 |

Altar: interact cylinder `hypot(x-o.x, z-(o.z+23)) < 2.2`. Solid `shrine-altar` r=1 h=1.1 plus `shrine-altar-pad` r=2.15 h=0.1. Clamp `x∈[o.x±9.2]`, `z∈[o.z+0.8, o.z+26]`.

Spawn after 叩响: `(o.x, o.y+0.1, o.z+4.4)`, `interactLock=0.85`. E at `z<o.z+3.2` is **离开灵祠**.

QF3 rime: bot hugged the wall, `dAltar=3.8` (need <2.2). Cause: rime pit was `|lx|<6.2` (sidewalk inner edge 5.8 sat **in the pit**), and the harness steered spawn→`(o.x+7.4, o.z+22)` on a **diagonal that crosses the pit**. Live pit is 4.8; sidewalk at 7.15 is fully on the floor. Walking **+X first, then +Z past 21.6, then to altar** reaches `dAltar<2.2`.

Side path is a walkable floor around the pit (legal alternate). Claiming one shrine does **not** set the other three.

`nearInteractable()` inside a shrine is **only** altar `r<2.2` and door `z<o.z+3.2` (not the whole interior). Pit walls `pit-e`/`pit-w`/`pit-n` are climbable. Node: place at rime center `(lx=0, lz=12)`, E/W starts climb, and climb-or-walk reaches `lz>20.4` without writing `shrinesOn` / `orbs`.

---

## What the 23 tests encode

Previous 19 intents:

1. Dawn S-to-ledge rest, then W+E, then E at cap → `towersOn` has `dawn` (never assigned).
2. After rest, 400 ms W+E (cam still facing the shaft) stays on the tower.
3. After rest, 400 ms W-only does not dump into the wind-valley.
4. Mere from lake water (`x+8`, swimming) lights 镜湖塔.
5. Mere from the dry inner ring lights 镜湖塔.
6. Crown rest-ledge climb without spicy does not die and lights 雪冠塔.
7. Spicy meal lasts 90 s and decays in real time.
8. Each of pull/burst/rime/still: 叩响, sidewalk only, no `art`/`artSlot`, `dAltar<2.2`, 领取灵核, `orbs===1` (not an auto-complete of all four).
9. Rime hug-+X-wall from entrance reaches `dAltar<2.2`.
10. Still’s moving block does not block the side floor.
11. Rime center +Z is a pit; sidewalk is a floor.

New:

12. Geometry: `inner = TOWER_LEDGE_RADIUS − TOWER_LEDGE_D/2 >= TOWER_RADIUS+0.4` and `>= 4.6`; `TOWER_LEDGE_RADIUS >= 5.9`. Hardcoded `r=5.5` is gone.
13. Climb pose on dawn shaft: one 1/60 S or exhaustion step never moves xz `> 2 m`.
14. Opposite-face ledge (~11 m) is not reached in one rest action.
15. Placed on a ledge top, W toward the shaft does not immediately fall into the cylinder.
16. Rime pit `(lz=12, lx=0)` is not a softlock: `nearInteractable()` is false, E/W can climb, escape to `lz>20.4` writes no shrine flags.

---

## Top 8 lead fixes (by QF impact)

Already in the tree are marked KEEP. Remaining holes are still ranked.

1. **QF1 — KEEP `handleLocomotion` rest re-grab.** `wantClimb` includes `(resting && moveY>0.12)`; `nearestTower()` wall probe + `faceTower` when bodyFwd misses. Reverting this restores “S-to-ledge then W walks into the shaft because wish uses cam forward”. File: `sim.ts` `handleLocomotion`.

2. **QF1 — KEEP local `tryMantle`; do not restore `grabRest` 12 m.** Live: `MANTLE_REACH_XZ=1.6`, `MANTLE_REACH_Y=2.1`, step `0.12/0.18`, reject if moved `> 0.35`. Opposite ledge at r=5.9 is ~11.8 m and is **not** reached in one rest. Remaining hole: a climb face with no balcony inside 1.6 m still falls on S/exhaust (intended; the old 12 m snap was the bug). File: `sim.ts` `tryMantle`. Pair with a player look-reset after a splash (item 5).

3. **QF1 — KEEP `TOWER_LEDGE_RADIUS >= 5.9`.** Inner `5.9 − 1.225 = 4.675` is outside shaft 4.2 and capsule 4.52. Reverting to 5.5/5.55 puts the inner lip inside the non-standable cylinder. File: `world.ts` `towerSolids`.

4. **QF4 mere — KEEP docks + swim climb.** `world.ts` `towerNeedsDock` (wet ring at r=8, not `tw.y < WATER_LEVEL+0.9`) and `sim.ts` `wantClimb` from `swimming`/`inWater`, feet lift to `WATER_LEVEL+0.08`. Mere POI is 7.8 m (dry flat) but r≥4.7 is lake; without this, E while swimming is a no-op.

5. **QF4 mere — missed rest into the lake must re-grab without a look-reset.** Node only recovers if the test re-faces the shaft while swimming. A player whose camera still looks at the last wish (or who holds W after a splash) drifts. File: `sim.ts` `handleLocomotion` swimming branch: if `nearestTower().d < 8`, auto-face / auto-grab on E even when cam looks away.

6. **QF3 rime — KEEP pit `|lx|<4.8` (not 6.2) + dual sidewalks + altar pad r=2.15.** QF3’s `dAltar=3.8` was the sidewalk inner edge sitting in a 6.2 m pit, plus the harness diagonal spawn→`(o.x+7.4, o.z+22)` crossing the hole. File: `sim.ts` `heightFn` and `rebuildSolids`. Do **not** widen rime back to 6.2.

7. **QF3 — KEEP pit climb.** `nearInteractable()` is false except `dAltar<2.2` or `z<o.z+3.2`. Node: after falling into rime center, E/W starts climb and reach `lz>20.4` without shrine flags. Reverting to “any shrine interior is interactable” restores the softlock.

8. **QF4 crown — KEEP `towerShelter()` while climbing / on ledges; spicy = 90 s.** File: `sim.ts` `towerShelter` + `integrate` climate; `cook`/`eat` for 辣炒椒. Unsheltered frost at `(48,-128)` with `y>36` still ticks 0.25 HP / 3.2 s. Do not apply frost to `airborne` within ~8 m of the crown shaft or a missed mantle in snow is a 13–38 s death that the rest-ledge climb does not deserve.

Harness-only (owner C, not lead gameplay): `play-routes.mjs` must not depend on a 12 m snap. Shrine steer to `right` on a diagonal still crosses even the 4.8 m rime pit if +X is not completed first. Those routes were **not** rerun here.

---

## Files written

- `aetherwake/src/game/routes.mainline.test.ts`
- `docs/rebuild-evidence/TOWER_SHRINE_REVIEW.md`
