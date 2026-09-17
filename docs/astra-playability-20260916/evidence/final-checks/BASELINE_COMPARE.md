# R29 scripts suite — baseline vs current

**Supervisor log:** `/tmp/aetherwake-supervisor-final-qa.log` (653 / 601 / 52)  
**After R29 fix:** 653 / 637 / **16**  
**Baseline commit:** `54a33655b7f342002164ae6e9fba6a56a6530bf8` (worktree `/tmp/aw-baseline-r29`, node_modules symlinked)

## Fixed this round (new regression)

| Area | Root cause | Fix |
| --- | --- | --- |
| citadel-defense / descent-settlement (36 tests) | fixtures set all `shrinesOn` but `orbs=0` → `quest.ts:186` `next.x` crash in HUD during `Sim.step` | 1) fixtures set `sim.orbs = shrinesOn.size` 2) `deriveTrackedObjective` no longer uses non-null assert when no unclaimed shrine remains |

## Baseline residuals (same fail on 54a33655 — not introduced by playability work)

| file | fail count | notes |
| --- | --- | --- |
| scripts/brand-check.test.mjs | 3 | missing `.grok/skills` marker/SKILL.md |
| scripts/check-auth-invariant.test.mjs | 1 | template shipped app-env resolution |
| scripts/grok-pwa-plugin.test.mjs | 8 | og/meta injector + grok.me slug |
| scripts/with-app-env.test.mjs | 3 | template auth off / wrapped CLI / symlink |
| scripts/write-atomic.test.mjs | 1 | ENOENT `.grok/skills/og/references` |
| **total** | **16** | all **baseline fail = current fail** |

## Command

```bash
cd aetherwake && node --test 'scripts/**/*.test.mjs'
```

Do **not** treat these 16 as green. They are environment/template/skill-pack residuals proven on the original baseline.
