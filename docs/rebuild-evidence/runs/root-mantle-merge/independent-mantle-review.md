# Independent P1-2 review of the merged working-tree candidate

Read-only review of `aetherwake/src/game/mantle.ts`, the new physics helpers and the Sim climbing diff. Root owns changes and headed acceptance; another agent owns old fixture governance. This reviewer did not change production/tests in the game tree, start a browser/build or run a broad suite. The independent probe below lives only in the evidence directory.

## One necessary correction: automatic resting re-grab ignores movement direction

At `sim.ts:1142–1155`, the automatic condition `resting && a.moveY > 0.12` checks only forward input relative to the camera. Before it, `faceTower` turns the body back toward the shaft, allowing a wall probe even when the actual movement wish points out of the tower. The new actual-cap support check correctly distinguishes an upper ledge from the cap, but exposes this older unrestricted automatic grab on that ledge.

The real headed 63653 artifact records activation at approximately y44.5 on the upper ledge, `done ... state=climbing`, then repeated airborne/climbing states while leaving. That trace motivated the exact controlled probe; it does not alone prove every intermediate input or collision.

`independent-regrab-probe.test.mjs` imports the real main-tree Sim, input queue and geometry. It uses the headed final sample's exact XZ `(-108.37595046029948,12.504338048082161)`, chooses the original support directly beneath it (`mere-ledge-9`, y44.46000019073487), and asserts the initial full body is clear. Initial velocity is explicitly stationary because the recording omits vx/vz. No player/resources/geometry are modified after stepping starts.

`independent-regrab-before.tap`: **5 tests, 3 pass, 2 fail, exit 1**.

| Normal input from the same clear original ledge | Expected | Current result |
| --- | --- | --- |
| W pointing radially outward, wish·outward=+1 | Move without automatic grab | Incorrectly climbing |
| W tangential to shaft, wish·outward=0 | Move without automatic grab | Incorrectly climbing |
| W toward shaft, wish·outward=-1 | Preserve automatic re-grab | Climbing, control passes |
| Explicit E with outward camera | Preserve explicit grab | Climbing, control passes |
| C while climbing with outward camera | Dismount safely away | Airborne, radius4.52→4.87, clear body; control passes |

The narrow fix is to additionally require the real `wishX/wishZ` to point into the wall for the **automatic resting W clause**. With the outward wall normal, require `wishX * wall.nx + wishZ * wall.nz < -1e-8` (or the project's established numerical tolerance), retaining the existing forward-input amplitude threshold. Keep explicit `a.climb`/`a.interact`, water rules, stamina gate and cap detection unchanged. No new camera-turn requirement, re-grab cooldown, larger dismount, geometry change, teleport or QA activation threshold change is needed for this finding.

## C direction: hypothesis disproved for the observed tower case

`sim.ts:967–975` calls `faceTower` before computing `bodyFwd` while climbing within8m. `faceTower` uses player-to-tower radial direction (`782–787`); the C branch's `-fwd` therefore points outward, independent of camera yaw. The real headed radius is approximately4.52, inside that condition.

The probe confirms exactly +0.35m outward with an outward-looking camera and a clear swept path. Changing C to the shaft wall normal would give essentially the same direction here. The original contract is explicit dismount taking precedence over auto mantle/rest; it does not require committing an obstructed 0.35m displacement. The new sweep may reject the displacement while still switching to airborne, which preserves collision safety. A different non-tower dismount defect has not been established by this review.

## Remaining collision and lifecycle review

- `planMantle` validates the initial body, real standable destination, current1.85m edge/2.1m vertical reach, a fitted full-foot landing and every segment before starting. The old single-frame2.35m top push is removed. Landing hints used by the current Sim route remain tied to the shaft/actual current pose.
- `advanceMantle` rechecks target geometry/standability, current body, next swept segment and bounded elapsed plan duration before committing a pose. Changed/missing targets and newly blocking segments fail at the last checked position. It does not resolve a blocked mantle by pushing the endpoint through geometry.
- The lifted/horizontal/settling phases retain the original per-fixed-step bounds. Overhang preparation is explicitly a slower phase before final reach: outward movement uses CLIMB_SHIMMY, rising uses CLIMB_SPEED, elapsed budget is derived from actual path length/speed plus discrete-step allowance, and preparation spends ordinary climbing stamina. Actual reach is checked again when entering the final phase. This is not a claim that the initial foot position was already within final vertical reach.
- C is checked before an active plan or rest rescue. `setMove` clears mantle whenever leaving climbing; `clearTransients` clears it on world lifecycle transitions. New game, save application, death and normal Escape paths use these existing paths. Paused mantle progression is intentionally frozen/resumed; the separate P1-7 mode-step fallthrough issue is already diagnosed and is not silently repaired by this patch.
- Low stamina is charged during preparation; exhausted preparation cancels. Once within the final permitted reach, the candidate retains the existing low-stamina rest-rescue behavior. No indefinite speed/budget extension was found in the bounded plan.
- Full solid-volume checks include player head and thin standable platforms omitted by the older wall probe. Rotation transforms, slab interval intersections and cylinder intersections are internally consistent. Expanded boxes are conservative around corners, so some physically clear rounded-corner paths can be rejected. BODY_SKIN is a deliberate2mm contact tolerance.
- Terrain clearance remains sampled along the body center path at at most0.08m spacing, while terrain landing checks17 foot samples and rejects height spread beyond BODY_SKIN. It is conservative for the covered authored routes, not an analytic proof for every possible height field or unsampled sharp feature. Existing supportY fallback has not been globally changed.
- Target points are not forced through world bounds by this helper. The current production targets are original authored tops or nearby terrain; this review did not identify a newly reachable out-of-world target. No broader world-boundary system is proposed.

No additional blocking defect was established in the assigned code review. The required directional re-grab guard and real headed route acceptance remain root's work; old overlapping-fixture failures belong to the separate fixture audit. Do not count tower activation alone as proof of a successful leave path, and do not report the candidate accepted based solely on helper tests.

## Root correction rechecked; review frozen

Root subsequently added exactly the inward-wish dot-product condition to the automatic resting clause at `sim.ts:1146`. The explicit climb/interact and water branches, C dismount and authored geometry remain unchanged. Read-only diff review confirms the change matches the narrow finding.

Root moved the five independent cases into `aetherwake/src/game/climb-regrab-intent.test.ts`; the file preserves the exact initial support/body-clear assertions, both strict negative cases and the three positive controls. Root reports5/5 passing. This reviewer inspected the final source/tests but did not duplicate that run. No remaining source-review blocker was identified; root is separately rebuilding and rerunning the real mere leave route. This review is frozen with no further scope expansion.
