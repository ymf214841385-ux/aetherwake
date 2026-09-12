

## Release freeze — 2026-09-12 (latest scope)

User requested publishing the completed current round and deferring all remaining optimization. This section supersedes earlier instructions to continue the full plan.

Published application scope: accepted P0/E31 dodge/ground-follow, Boss navigation and same-browser ending/save/reload, plus P1-1 input ownership/reset/bow fixes. Game 279/279 and headed input smoke 7/7 passed; QA 455/455 passed again after making captured regression fixtures portable. Typecheck and build:app passed on the same application source; no database migration.

P1-2 mantle is **not integrated into the application**: the frozen candidate passes 43 focused tests but full game is 261/267 with six unresolved legacy starting-position overlaps, and has no browser acceptance. Candidate patch/report/manifest and failure details are preserved in rebuild-evidence/runs/root-p1-mantle-diagnosis for later work. The existing application climbing behavior remains.

Deferred: P1-2 acceptance, P1-7 mode transitions, other P1/P2 optimization, visual quality/camera, same-new-save full mainline, current-version 600-second stability, physical mobile multitouch/legacy click compatibility. Full npm test still has 16 historical template/auth/PWA fixture failures (637/653 script tests); it must not be described as all green. See root-e31-ground-follow/FULL_TEST_INVENTORY.md.

Packaging uses the source commit, then a separate package-only commit. ZIP metadata identifies the exact source commit and SHA-256. Portable game observations preserve the original save v2 string and pre-dodge observations, avoiding dependencies on excluded raw logs/local captures. The packaging script now resolves the repository root explicitly so it replaces the repository's packed/aetherwake.zip, including when invoked from the application directory.
