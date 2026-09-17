# Review 29 — final audit gate: omitted script QA failures

Continue in this worktree only, MiMo desktop executes. No push/deploy/tunnel/dependency install, no changing game parameters or weakening tests. Preserve natural headed win evidence.

Supervisor independently ran from aetherwake: `node --test 'scripts/**/*.test.mjs'`. Full log `/tmp/aetherwake-supervisor-final-qa.log`: 653 tests, 601 pass, 52 fail. Final delivery omitted this suite; cannot call final audit complete.

Precise first diagnosis: `src/game/quest.ts:186`, deriveTrackedObjective, q.orbs < 4 but every shrine already in shrinesOn => find returns undefined then next.x crashes. Example scripts/qa/citadel-defense.test.mjs fixture lines24-29 sets all towers/shrines but does not set matching orb count. Multiple production Sim.step combat fixture tests now crash in HUD before intended assertion. Determine legitimate save invariants versus fixture inconsistency, with evidence. Do not blindly mask all undefined objectives. If fixture is invalid, fix its progress consistently in test-local initialization (not browser), retain original combat assertions; add focused quest regression for any legitimate inconsistent/persisted state if production supports it. Run affected tests then full scripts suite.

For each remaining script failure group, compare SAME command/test on base 54a33655b7f342002164ae6e9fba6a56a6530bf8 in isolated scratch checkout (reuse node_modules, no install). Missing .grok/skills/og assets, auth/env/template failures must be proved baseline, not presumed historical. Save table file/test/error/base result/current result. New regressions must be fixed; baseline residuals explicitly listed. Never delete tests or skip entire suites to turn green.

Then run typecheck, test:game, scripts suite, build:app; save logs and truthful SUMMARY. Update FINAL_DELIVERY, STATUS, ACCEPTANCE with exact results, two known climb residuals, phone=0 and pull side corridor limitation. Source package is source+assets+evidence, not runnable dist (zip currently contains no dist/.vercel). Preserve externally authoritative meta sourceCommit/hash; no recursive hash chasing.

Root independently verified current zip 213213243 bytes, 1091 files, hash 6e4893a679854f1c54e659cf5c9b0c884017de52bf6778529ca8ecd27d0053aa and 200 src/public files match sourceCommit 2f1d7ff. After repair rebuild local package and verify again.

Resolve contradictory cleanup report: STATUS said reclaimed, FINAL_DELIVERY admits task localhost8102 node72677 remains. Identify current PID/cwd before terminating only this task QA preview when no longer needed; leave other trees 8101/8091 alone. Do not say all processes reclaimed unless checked.

Start actual diagnosis/fix now, no plan-only stop. Report exact remaining failures after rerun.
