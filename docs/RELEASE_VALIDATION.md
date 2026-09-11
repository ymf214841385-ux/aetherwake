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
