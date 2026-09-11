# Checkpoint validation 2026-09-11

## MiMo continuation (opencode-go @ 265cc80 base)
- typecheck: PASS
- test:game: 181 passed, 0 failed
- 95073 durable: 3 towers + 4 shrines orbs=4 seal=true; cook cooked=true; save-reload restored
- Boss: 30 swings / 7 hits, bossHp 20→7.4, not killed; dodge fall-through fixed (`citadelFightStep`)
- applySave: continue keeps saved pose; tower checkpoint only for death-respawn / on-tower xz
- Boss-cont from after-citadel: crown descent/page.close; **not** killed; sim.save() is programmatic
- Browser UI save+refresh chain after ending: **not accepted**
- build:app: run after this batch (do not swap dist under live preview)

## Prior integrated checkpoint
- Integrated typecheck: PASS (fixed missing QA/test parameter types; no gameplay behavior change).
- Integrated game tests: 163 passed, 0 failed.
- Production build: PASS via npm run build:app, no database migration.
- Full npm test: 331 script tests, 315 passed, 16 failed; execution stops before subsequent suites. Failures include missing .grok skill/template fixtures, template auth defaults and PWA metadata expectations. These are retained, not hidden or counted as passing.
- Built preview: title/start screen loads. Normal-input smoke evidence is in rebuild-evidence/visual-checkpoint/integrated-smoke.json. This is not complete gameplay acceptance.
- Boss ending/reload and 600s stability remain unverified; see CHECKPOINT_2026-09-11.md.
