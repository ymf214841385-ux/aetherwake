

## User-corrected merge release — 2026-09-12 (supersedes archive-only release)

The user explicitly required merging the current agent round. P1-2 is now **integrated into the application source**, alongside accepted P0/E31 and P1-1; it is no longer only an archived candidate. This is a development checkpoint, not a claim that every requirement is complete.

- Continuous, collision-checked mantle replaces top teleport; preparation and every step validate the body/path and real support. C dismount has priority, transient state is cleared on lifecycle resets, and ordinary climbs respect thin ledges. No world geometry or reach/stamina budgets were expanded.
- Root fixed a headed-route regression exposed by the actual-cap check: outward/tangential W from a rest ledge must not automatically re-grab the wall. Automatic re-grab now requires inward movement; explicit E and C behavior remain. Five regression cases preserve the original two failing observations and pass after the fix.
- Invalid legacy fixture positions now assert their original overlap and start on actual clear terrain/low ledges. Original input, loops, stamina assignments and assertions are preserved. Final game tests: **325/327**, zero skips. Two failures remain: climb-detach summit path (600 W frames exhaust stamina before its final height assertion), and sim ledge-rest sequence (after 90 W frames, forcibly setting stamina to 4 leaves insufficient stamina to reach the next rest). These failures are retained and deferred rather than weakening tests or changing game budgets.
- QA **455/455**; typecheck and build:app PASS. Controlled Sim routes demonstrate all three actual caps and rime's real altar support; these are not full browser acceptance.
- Headed new-game runs63653/64074 activated mere/crown but showed repeated re-grab when leaving upper ledges. The observed defect led to the root direction regression/fix. The last browser rerun is recorded separately in this directory; do not infer full mainline acceptance from tower activation.
- Remaining P1/P2, visual quality, broader mainline/device/stability validation, and the 16 historical template/auth/PWA script-test failures remain deferred per user request.

Final headed rerun64925 (including direction fix): **NOT ACCEPTED**. New-game mere climb failed to activate within the original 240-second climb window; root stopped before repeated ring retries. Evidence: `rebuild-evidence/runs/root-mantle-merge/final-browser`. This merged development checkpoint includes the requested current-round code, with known two game failures and unresolved headed-route validation. No later optimization or background executor remains active.
