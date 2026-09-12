# P1-2 frozen review candidate — not full acceptance

This candidate is isolated at `/Users/ymf/Projects/aetherwake-rebuild-20260909/root-p1-mantle`. It has not been applied to the main checkout. Root owns integration/release. No browser, build, install, commit or push ran here. P1-7 is not implemented/accepted by this work; main accepted scope reported by root is P0/E31 + P1-1.

## Result and release boundary

- Latest full game: **261 passed / 267 total, 6 failures**, `game-final.log`.
- New focused regressions: **43/43 passed**, `focused-final.tap`; the latest full game also includes all43.
- Typecheck and `git diff --check` passed.
- Overlay-relative `P1-mantle-candidate.patch` passed `git apply --check` against a separate copy of its exact preimages. File/SHA list: `P1-mantle-manifest.json`.
- All pre-existing test files, params and world geometry match the initial overlay snapshot. None of the six failures is deleted, skipped, weakened or hidden. This is **not** an all-green release candidate; root must decide whether to defer P1-2 or separately audit/govern the invalid legacy fixture starts before accepting it.

## Changed behavior

`sim.ts` changes only transient mantle lifecycle and climbing/mantle behavior (including the actual-cap re-grab guard). It does not change mode/step/time transition semantics. `physics.ts` adds conservative full-body path validation and geometrically fitted landing/outside points. `mantle.ts` is a bounded transient plan with preflight, per-step sweep, lifecycle cancellation and target revalidation. Two new test files carry regression evidence.

- Explicit C wins over rest, low stamina rescue and an active mantle. Pause freezes; death/reset/continue cancel.
- Real cap support replaces the old2.35m top teleport. Lift/across/settle retain0.12/0.18 per fixed step and the actual unchanged reach1.85/2.1.
- Ordinary climb never commits an unchecked body move into a thin ledge. A real blocking overhang uses a positive outward footprint exit, rounds it at existing CLIMB_SHIMMY2.2, rises at CLIMB_SPEED3.4 only into the current2.1 reach, then mantles. Preparation spends stamina and naturally cancels when exhausted.
- Rest targets fit the entire foot onto the actual ledge toward the actual shaft surface+radius/skin. Current tower only, preventing a distant tower's same-height ledge from directing shimmy. An upper rest ledge no longer falsely disables re-grab through the broad activation-height band.
- Generic thin retaining walls use a near-body probe with normals from the actual body/footprint and close the real grip gap continuously. Real standable platforms behind the wall take precedence; terrain fallback requires a level supported17-point foot disk, the unchanged reach, and an unobstructed full-body path. The wall remains nonstandable. Combined normal approach/shimmy never exceeds CLIMB_SHIMMY.

## Actual controlled Sim + normal input evidence

One initialization per route; no later HP/stamina/cooldown/position injection. These are deterministic Sim/keyboard fixtures, not browser transport acceptance.

| Route | Fixed steps | Final support | HP | Stamina |
|---|---:|---|---:|---:|
| Dawn: clear original terrain start, normal E/W/S with original28/0.85/88 rest decisions |1035|Actual cap|3|88.08|
| Mere: clear original terrain start, same input contract |1349|Actual cap|3|88.03|
| Crown: clear original terrain start, same input contract |972|Actual cap|3|88.2467|
| Three authored middle ledges: normal W from a clear body below the underside |126 each|Actual middle ledge|3|94.49|
| Rime: exact early grip position, one normal E then W |71|Actual0.1m altar pad|3|88.5|

Every route frame is checked for full-body solid/terrain clearance. All three tower routes land fully on the actual cap before a normal E activation. Rime ends grounded with no shrine flags/orbs changed; pit-n stays explicitly nonstandable. Initial velocities are the fresh Sim's zero values, camera orientation is initialized once, and browser latency is omitted. Geometric negative tests use explicitly controlled solids/terrain, including narrow support, wrong reach, unsupported foot edge, steep/discontinuous terrain, low ceiling, changing target geometry and changing terrain support.

## Remaining original failures

All six start from an overlapping body; this is independently recorded in `remaining-six-fixtures.json` using their exact unchanged initial positions and real authored terrain/solids. The two dawn helper starts are additionally1.750427m below terrain. This explains why re-enabling body penetration would make old assertions pass, but it does not replace their acceptance requirement. Keep these six red until root reviews their initialization and the existing route contracts.

| Source | Failing test | Exact initial (x, y, z) | Initial overlap |
|---|---|---|---|
| `climb-detach.test.ts:77` | tower mantle still works without dodge (summit path) | (14.250000000, 13.300000381, 68.000000000) | dawn-shaft, dawn-ledge-0 |
| `routes.mainline.test.ts:364` | after S-to-ledge rest, W+E re-grabs instead of walking into the shaft | (10.000000000, 12.996656830, 72.800000000) | dawn-ledge-1 |
| `routes.mainline.test.ts:540` | mere climb from the dry inner ring activates 镜湖塔 | (-103.650000000, 7.950000191, 8.000000000) | mere-shaft, mere-ledge-0 |
| `sim.test.ts:169` | rest ledges let a full-stamina climb activate dawn tower | (14.700000000, 11.300000381, 68.000000000) | dawn-ledge-0; feet 1.750427m below terrain |
| `sim.test.ts:309` | after a ledge rest, holding forward re-grabs the shaft instead of walking off | (14.700000000, 11.300000381, 68.000000000) | dawn-ledge-0; feet 1.750427m below terrain |
| `sim.test.ts:365` | mere can be climbed from the waterline dock and activated | (-103.300000000, 8.000000191, 8.000000000) | mere-ledge-0 |


`sim.test.ts:309` also injects stamina4 after90steps and90 later, as the existing test already did; this candidate leaves those original assertions/resource injections untouched. New route regressions do not do that.

## Red-to-green evidence and caveats

- `mantle-before.tap`: initial fifteen original-production cases (12 failures/3 controls).
- `climb-underside-before.tap`: three actual ordinary-W thin-ledge failures on frame2.
- `focused-ninth.tap` / `focused-tenth.tap`: new clear terrain entry and one-E rime routes caught compatibility regressions rather than masking them. Exact first bad frames are retained.
- `focused-final.tap`:43 passed; `game-final.log`:261/267; `typecheck-final.log`:pass.
- `remaining-six-fixtures.json`: exact old starts/solid overlaps; `patch-check.log`:successful patch applicability.

The upright-cylinder sweep is conservative around rotated-box corners; terrain path clearance uses sub-radius center samples, while terrain landing support uses17 foot samples and rejects non-level support beyond BODY_SKIN. This is not a universal analytic terrain collision proof. No headed/browser route or manual controller acceptance is claimed for P1-2. Root should keep this frozen candidate separate from the already accepted main release until these remaining acceptance decisions are resolved.
