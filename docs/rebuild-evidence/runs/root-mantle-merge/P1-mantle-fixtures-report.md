# P1-2 legacy fixture correction handoff

This supersedes the previous6-failure count, without changing the frozen production candidate. Root requested literal fixture correction for merge; this work changes only3 existing test files and adds `mantle-fixtures.ts`. All five files in the previous runtime candidate still match their frozen SHA256 hashes. No source feature extension, browser, build, commit or push occurred.

## Final results

- Full game: **265/267 passed**, `fixture-revision-game-final.log`;2 original behavior assertions remain red.
- Typecheck and diffcheck: passed.
- Fixture-only patch: `P1-mantle-fixtures.patch`; SHA/files in `P1-mantle-fixtures-manifest.json`.
- Patch application check against copied original test preimages: passed.
- Original `s.step`, loop and stamina assignment lines were compared verbatim across all3 old test files and remain identical. No behavior assertion, input sequence, resource amount, timeout or budget was removed/relaxed. The failing tests are neither skipped nor deleted.

## What changed

Every affected case now asserts that its original point overlaps actual world geometry, using `assertLegacyTowerStartBlocked`. `placeOnSupport` then asserts full-body clearance and actual `supportY` agreement before changing only initialXYZ.

- The two full tower tests in `sim.test.ts` (dawn/mere), plus the shared crown use of their helper, start at the original-terrain gaps already covered by the normal-input full-route tests: dawn angle11π/32, mereπ/32, crown0, radius4.6. These are original terrain heights, not a height lifted above collision. All three full tower helper paths pass their original budgets/logic.
- The dry inner ring mere case uses the same actual dry terrain entry (height4.439998>WATER_LEVEL3.35). Its original80second route now passes.
- The south S-to-ledge case starts fully supported on the actual low ledge1, rather than with its feet/body inside it. The original W-until-stamina22, S24steps, mid-ledge height and re-grab assertions all pass.
- The summit/no-dodge case and90W→stamina4→S case start on actual low ledge0. These are closest supported replacements for the originally embedded low-row point. They retain failures explained below.

Original six-position overlap evidence remains in `remaining-six-fixtures.json`. Original6-failure baseline: `game-final.log`. First changed-fixture run: `fixture-revision-first.tap`. The two detailed exact-input traces are in `fixture-two-behavior.json`.

## Two unresolved behavior contracts (preserved)

1. `src/game/climb-detach.test.ts:78`, **tower mantle still works without dodge (summit path)**. From a clear low ledge at(14.760150174,13.410000381,68.330550802), the original600Wsteps successfully climb and mantle onto the middle ledge at30.585000381. Constant W immediately resumes without resting, exhausts stamina at37.101667048, then original default-camera forward input carries the fall away from the ledge. Final y13.562619906/HP1.5 fails the unchanged `y > y0 + 5` endpoint assertion. Added diagnostic reports maximum reached height and final pose; no rest input/budget was added.

2. `src/game/sim.test.ts:309`, **after a ledge rest, holding forward re-grabs the shaft instead of walking off**. Same legal low support, original90Wsteps finish climbing at18.453333715. There is no actual rest platform within the original2.2m vertical window. The existing forced stamina4 then allows36 S descent steps to16.923333715, still too high above low ledge13.410000381 to mantle; natural exhaustion switches airborne. The unchanged grounded assertion fails. Added diagnostic explicitly reports the absent nearby rest precondition. No stamina increase or extra movement was added.

These2 failures are not resolved by a clear starting body alone. Correcting their input/behavior contracts or adding gameplay recovery requires root review; the instruction for this subtask prohibits either expansion. They remain visible in the actual full test run. Candidate fixture patch is ready for review/merge but **not an all-green result**. Work is stopped pending root.
