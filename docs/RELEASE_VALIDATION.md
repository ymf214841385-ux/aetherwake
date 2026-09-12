# Checkpoint validation 2026-09-11

## MiMo continuation (opencode-go @ 265cc80 base)
- typecheck: PASS
- test:game: 181 passed, 0 failed
- 95073: 3 towers + 4 shrines seal; cook cooked; save-reload restored; boss 20→7.4 not killed
- 99783 normal-input (only corrected launch): eat verified meals1→0 spicy0→89.8 Tab close; **crown lit seal=true**; page.close on crown-leave; **no boss kill**
- 99242: diagnostic only (sim.closeOverlay / DOM click) — not acceptance
- after-citadel save is crown-top spicy=0 (not courtyard)
- Boss kill / ending / UI save+refresh: **not accepted**
- build:app: index-CHvVuW7R.js (after b4d25ad)

## Prior integrated checkpoint
- Integrated typecheck: PASS (fixed missing QA/test parameter types; no gameplay behavior change).
- Integrated game tests: 163 passed, 0 failed.
- Production build: PASS via npm run build:app, no database migration.
- Full npm test: 331 script tests, 315 passed, 16 failed; execution stops before subsequent suites. Failures include missing .grok skill/template fixtures, template auth defaults and PWA metadata expectations. These are retained, not hidden or counted as passing.
- Built preview: title/start screen loads. Normal-input smoke evidence is in rebuild-evidence/visual-checkpoint/integrated-smoke.json. This is not complete gameplay acceptance.
- Boss ending/reload and 600s stability remain unverified; see CHECKPOINT_2026-09-11.md.


## Root takeover and E31 checkpoint — 2026-09-12T07:59:38.907428+00:00

This section supersedes historical validation counts and ownership. User requested root personally finish all remaining work after Astra's round, with collaboration agents; E29 ended, no CLI executor remains. Main integration tree is opencode-go at HEAD 7decaa06068e1e3dc4ed3c9e833d0386f810b745 with preserved E23–E31 uncommitted changes.

- E30 corrected actual Boss QA reach (3.2m acceptance vs production 3.45m), handed live clear-LOS movement back to combat within existing 100ms observations, and connected same-browser victory/save/reload acceptance. Legacy airborne-C assertions now obey production eligibility; they are not late-airborne survival proofs.
- E30 headed run49416 stopped alive HP2 before combat: descent-landing-not-observed. Monitor saw a real grounded frame in the existing 300ms/radius, but navigation's reads missed it. Archive: docs/rebuild-evidence/runs/root-e30-browser.
- E31 root independently reproduced the game defect: moving onto ground only 0.009606457m lower incorrectly switched a grounded player airborne. Root fixed snapVertical to follow ground within existing FOOT_SNAP=0.62 only while already grounded with nonpositive vy. Baseline 8pass/2fail; full game after 224/224, typecheck PASS. Independent boundary review preserved jump, cliff and landing damage behavior.
- Stable grounding exposed a real QA steering error: fourth Boss dodge rejected the open gate path and strafed into a gate wing. Root added narrow gate crossing plus checks on the actual eight-way key direction through the radius-expanded gate segment. Boss retreat now uses actual strike3.8m +0.5m observation/inertia margin, not old3.55. Isolated threshold-only experiment still failed; gate steering is the demonstrated repair.
- Root final all-QA: 455/455, zero skips, build:app PASS (no migration); evidence in docs/rebuild-evidence/runs/root-e31-ground-follow. Three controlled Sim starts reach ending with12hits/HP1 using normal queue/fixed steps and no mid-run state writes; this is not browser acceptance.
- New single headed original-v2-save QA launched PID52589, run root-e31-ground-follow. .grok/durable-play-routes-52589.log and exit-52589.json. Do not restart healthy QA. Initial save SHA6591658e25bef67b972ceea66451e3422461732dac7439c31b3ac5bc712278e3; no refresh reinjection. First failure must be archived and diagnosed. Actual Boss ending/reload is still pending at this checkpoint.
- P1-1 isolated root-p1-input/codex/root-p1-input is ready (37/37 input/DOM-listener+Sim-transition tests, typecheck PASS), with genuine red baselines. Root and independent agent reviewing before integration after browser round. Three existing +three new files, no main writes. Evidence .grok/p1-input/REPORT.md and P1-input.patch in that worktree. It is not mobile-device acceptance.
- Full downloaded execution plan remains in scope: P1 input/mantle/combat/bridge/object/interaction/mode, P2 camera/visual/performance, same-new-save main route, current-build600s and persistence matrix, final committed-source package and verified GitHub publication. Old607s result belongs to an older tree and is not current acceptance. v6 GLB assets exist; old procedural-only notes below are historical. No new GitHub publication or release package has been made.


## Root accepted P0 resumed ending and integrated P1-1 — 2026-09-12T08:14:21.831374+00:00

This later checkpoint supersedes the pending PID52589 and input statements above.

- **Real headed acceptance PASS**, PID52589 run root-e31-ground-follow: original legitimate crown save → normal descent →12 actual C dodges → Boss killed → visible ending → existing-save normal reload and Continue → Boss still dead. FinishHP2, amber88 before and after reload, ending→playing, exit0 in68235ms. No added resources, coordinates or progress. Root checked actual JSON and ending screenshot, and archived result/log/exit/save/screenshot with hashes in docs/rebuild-evidence/runs/root-e31-browser/ROOT_ACCEPTANCE.json. This proves resumed-citadel P0; it is not a same-new-save full mainline or visual-quality pass. Screenshot still demonstrates camera/visual work remains.
- P1-1 six-file isolated patch has now been reviewed and applied to main by root. It fixes pointer ownership/local release, reset invalidation, listeners/rotation, bow toggle; independent review found and repaired both pending pointer-click and held-Space activation after reset. Root applied only after verifying original three files were untouched and git apply --check. Agent65/65; integrated game279/279, QA455/455, typecheck PASS, build:app PASS.
- Root also corrected a QA dependency issue found by integrated typecheck: digital key selection now lives in typed dependency-free scripts/qa/digital-direction.mjs, re-exported by route-navigation; citadel-steer no longer imports the entire untyped orchestrator into game tests. Selection behavior unchanged, all455QA reran passed. The first integrated typecheck failure is preserved in root-p1-input/root-typecheck.log; final pass is root-typecheck-final.log. Do not misattribute it to the input agent.
- **Headed input smoke PASS**, normal new-game UI, real native Chromium touch/mouse/keyboard only: bowtap on/off, pointerdown→pause→oldclick does not reactivate, Space held→pause→keyup does not reactivate, mixed mouse-stick plus touch-look release preserves movement, final release settles. Seven checks, no pageerrors, owned server stopped. Evidence runs/root-p1-input-browser/result.json and screenshot; script aetherwake/scripts/qa/touch-input-smoke.mjs. This is browser emulation/mixed pointers, not physical iOS/Android multi-finger acceptance. Legacy MouseEvent pointer click lacking pointer fields remains explicitly unsupported in this patch and needs compatibility follow-up before claiming all mobile devices.
- Current full npm test inventory:653script tests,637pass/16fail, zero skipped; later && app/game groups did not run via npm test. Root identified4 absent template-doc contracts,4 template app-env defaults,8 PWA tests polluted by real game site/card cwd. No tests were removed/skipped. Details root-e31-ground-follow/FULL_TEST_INVENTORY.md; T1/T2 fixture repair/gate separation still required.
- Active next implementation: combat_sim_probe owns **root-p1-mantle / codex/root-p1-mantle**, based on recorded current-game overlay. Root approved continuous lift/across/settle mantle, C priority, full body/path clearance, genuine cap support, bounded fixed-step speed and safe cancellation. Root corrected agent's mistaken reach1.35 reading to actual MANTLE_REACH_Y=2.1. Original15frontier probes include already-intersecting thin ledges; those must demonstrate rejection/no worsened penetration, and separate valid-grip cases must prove real cap completion. No widening reach, skipping roofs, geometric rewrite, resource injection or root-tree edits. Agent no browser/build/commit/push; returns overlay-relative patch to root.
- **Root's next personal source task is P1-7**, using root-p1-mode-audit/MODE_TRANSITION_REVIEW.md and4 actual queue+Sim red probes. Add coherent transition revision, invalidate current local actions on any mode/world/same-world reset, end step/transition-capable loops after preserving current-hit accounting. Overlay freezes/preserves action/world state and only resets input; world resets clear transients. Split presentation time from gameplay t while retaining already-correct paused attack freeze; decouple cooked meal IDs from frozen t. UI direct mode assignments must use the common public transition entry. No production P1-7 edit has started yet.
- combat_flow_audit and remaining_scope_audit completed/stopped; use them for bounded reviews/independent work as useful, do not restart the old CLI executors. No main browser/test/writer process remains after these checks. The mantle agent is active in isolation. Main integration tree remains uncommitted; no finalpackage/GitHubrelease. Preserve all earlier source/evidence and do not re-run accepted healthy gates absent a relevant change.


## Release freeze — 2026-09-12 (latest scope)

User requested publishing the completed current round and deferring all remaining optimization. This section supersedes earlier instructions to continue the full plan.

Published application scope: accepted P0/E31 dodge/ground-follow, Boss navigation and same-browser ending/save/reload, plus P1-1 input ownership/reset/bow fixes. Game 279/279 and headed input smoke 7/7 passed; QA 455/455 passed again after making captured regression fixtures portable. Typecheck and build:app passed on the same application source; no database migration.

P1-2 mantle is **not integrated into the application**: the frozen candidate passes 43 focused tests but full game is 261/267 with six unresolved legacy starting-position overlaps, and has no browser acceptance. Candidate patch/report/manifest and failure details are preserved in rebuild-evidence/runs/root-p1-mantle-diagnosis for later work. The existing application climbing behavior remains.

Deferred: P1-2 acceptance, P1-7 mode transitions, other P1/P2 optimization, visual quality/camera, same-new-save full mainline, current-version 600-second stability, physical mobile multitouch/legacy click compatibility. Full npm test still has 16 historical template/auth/PWA fixture failures (637/653 script tests); it must not be described as all green. See root-e31-ground-follow/FULL_TEST_INVENTORY.md.

Packaging uses the source commit, then a separate package-only commit. ZIP metadata identifies the exact source commit and SHA-256. Portable game observations preserve the original save v2 string and pre-dodge observations, avoiding dependencies on excluded raw logs/local captures. The packaging script now resolves the repository root explicitly so it replaces the repository's packed/aetherwake.zip, including when invoked from the application directory.


## User-corrected merge release — 2026-09-12 (supersedes archive-only release)

The user explicitly required merging the current agent round. P1-2 is now **integrated into the application source**, alongside accepted P0/E31 and P1-1; it is no longer only an archived candidate. This is a development checkpoint, not a claim that every requirement is complete.

- Continuous, collision-checked mantle replaces top teleport; preparation and every step validate the body/path and real support. C dismount has priority, transient state is cleared on lifecycle resets, and ordinary climbs respect thin ledges. No world geometry or reach/stamina budgets were expanded.
- Root fixed a headed-route regression exposed by the actual-cap check: outward/tangential W from a rest ledge must not automatically re-grab the wall. Automatic re-grab now requires inward movement; explicit E and C behavior remain. Five regression cases preserve the original two failing observations and pass after the fix.
- Invalid legacy fixture positions now assert their original overlap and start on actual clear terrain/low ledges. Original input, loops, stamina assignments and assertions are preserved. Final game tests: **325/327**, zero skips. Two failures remain: climb-detach summit path (600 W frames exhaust stamina before its final height assertion), and sim ledge-rest sequence (after 90 W frames, forcibly setting stamina to 4 leaves insufficient stamina to reach the next rest). These failures are retained and deferred rather than weakening tests or changing game budgets.
- QA **455/455**; typecheck and build:app PASS. Controlled Sim routes demonstrate all three actual caps and rime's real altar support; these are not full browser acceptance.
- Headed new-game runs63653/64074 activated mere/crown but showed repeated re-grab when leaving upper ledges. The observed defect led to the root direction regression/fix. The last browser rerun is recorded separately in this directory; do not infer full mainline acceptance from tower activation.
- Remaining P1/P2, visual quality, broader mainline/device/stability validation, and the 16 historical template/auth/PWA script-test failures remain deferred per user request.

Final headed rerun64925 (including direction fix): **NOT ACCEPTED**. New-game mere climb failed to activate within the original 240-second climb window; root stopped before repeated ring retries. Evidence: `rebuild-evidence/runs/root-mantle-merge/final-browser`. This merged development checkpoint includes the requested current-round code, with known two game failures and unresolved headed-route validation. No later optimization or background executor remains active.
