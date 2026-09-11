# Checkpoint validation 2026-09-11

## MiMo continuation (opencode-go @ 265cc80 base)
- typecheck: PASS
- test:game: 174 passed, 0 failed
- P0-1 recover SM + P0-2 bossDead reload + freshRuntime live-boss regression
- strike requires LOS (`!blocked`); chain still ticks through walls
- Browser ordinary-input 3-round counter + final kill: **not yet accepted**
- Browser refresh/continue UI chain: **not yet**
- build:app: PASS (no migrate)

## Prior integrated checkpoint
- Integrated typecheck: PASS (fixed missing QA/test parameter types; no gameplay behavior change).
- Integrated game tests: 163 passed, 0 failed.
- Production build: PASS via npm run build:app, no database migration.
- Full npm test: 331 script tests, 315 passed, 16 failed; execution stops before subsequent suites. Failures include missing .grok skill/template fixtures, template auth defaults and PWA metadata expectations. These are retained, not hidden or counted as passing.
- Built preview: title/start screen loads. Normal-input smoke evidence is in rebuild-evidence/visual-checkpoint/integrated-smoke.json. This is not complete gameplay acceptance.
- Boss ending/reload and 600s stability remain unverified; see CHECKPOINT_2026-09-11.md.
