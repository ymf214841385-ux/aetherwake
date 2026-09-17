# Historical climb failures — investigation traces 2026-09-16 20:22

Not weakened. Not fixed this round. Recorded for Codex.

## 1. climb-detach `tower mantle still works without dodge (summit path)`

Command: `node --experimental-strip-types --test src/game/climb-detach.test.ts`

Diagnostic:
```json
{"initialY":13.41,"maxY":37.10,"final":{"x":14.52,"y":13.56,"z":65.06,"state":"grounded","stamina":1.34,"hp":1.5}}
```

Observation: climb **does reach y≈37** (near TOWER_HEIGHT 38) then falls back to y≈13.5 grounded with stamina≈1.3 and hp reduced. Assertion checks **final** y > y0+5, not peak.

Hypothesis (unproven): summit mantle/detach drops the player off the cap instead of holding a rest/stand; fall damage lands them on ground. Production impact: climb is possible but summit may not stick without careful mantle — may affect full-tower play, not click/LOS/orientation fixes.

## 2. sim.test `after a ledge rest, holding forward re-grabs…`

Fails at `assert.equal(state, "grounded")` — got `airborne` y≈16.92 after S descent from climb. Rest ledge not landed; player falls. Related ledge/mantle support snap.

## Boundary

These are pre-existing mantle/climb physics, present in baseline 325/327. This round did not change climb/mantle modules. Do not hide by relaxing asserts.
