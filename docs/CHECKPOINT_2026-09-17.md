# 2026-09-17 playability checkpoint

This release integrates the complete MiMo worktree through b4b4d62 into main, including application source, character assets, tests and accepted evidence. Integration uses one squash commit so repeated 200+ MB development archives are not added to Git history. The full ZIP is a GitHub Release asset generated from the published source commit. This is a source package, not a hosted game or final all-green release.

## Integrated behavior

- Formal character facing calibration; world picking, target IDs and line-of-sight checks.
- Visible touch joystick/buttons, modal isolation and reachable close buttons at 844×390 and 667×375.
- World-aware objective routes, dynamic shrine supports and validated pull-shrine sidewalk fallback without mid-route backtracking.
- Natural saved progress through four shrines, three towers, seal and Boss victory/reload is documented in the acceptance evidence.

## Verified limits

- Game tests: 604 passed / 2 failed / 606. Remaining historic failures: tower mantle summit path; ledge-rest re-grab. Their existence is not evidence of harmlessness.
- Script tests: 637 passed / 16 failed / 653; identical failure names independently reproduced on original main 54a3365.
- Typecheck and build:app passed. Never use build for verification because it may run database migrations.
- Physical phone testing: not performed. Touch evidence is browser emulation.
- Pull shrine is traversable through the validated side corridor. Metal-plate bridge traversal is not accepted.
- R37 verifies live route to altar approach. Its preexisting claimed-save flag does not prove a new interaction; original natural claim/reload evidence remains authoritative.
- Some of the 50 acceptance criteria have code-level coverage only. See docs/astra-playability-20260916/ACCEPTANCE.md and HEADED_EVIDENCE_INDEX.md.

## Rollback and package

Original main: 54a33655b7f342002164ae6e9fba6a56a6530bf8; preserved as pre-playability-20260917. Release: playtest-20260917. The external ZIP manifest is authoritative for sourceCommit and SHA-256. Historical MiMo FINAL_DELIVERY documents retain local worktree paths and pre-integration hashes; use this release and its manifest for the published package.

## Phone playtest

GitHub Pages serves a static wrapper mounting the same GameApp and game source. Three.js asset paths are adapted to the repository subpath by the wrapper; no gameplay code is replaced. Build with `cd aetherwake && npx vite build --config vite.playtest.config.ts`. Upload only dist-playtest contents to gh-pages; no credentials, server APIs or home tunnel are needed. Browser saves remain local to this site origin.

Intended URL: https://ymf214841385-ux.github.io/aetherwake/
