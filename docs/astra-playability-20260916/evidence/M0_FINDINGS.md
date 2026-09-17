# M0 evidence index — 2026-09-16

## Model

- Path: `aetherwake/public/assets/character/wanderer.glb`
- SHA256: `70148c66b078f17bdd42c3d9f24e64e716c386f8b54e48edb8c752583705167d`
- Parsed via raw GLB JSON (no browser): scene `WandererRig`, skin 20 joints, clips Idle/Walk/Run/Attack/Climb/Glide
- `hair_tie` world offset from `head`: local z = -0.084 → back of skull on −Z → **authored face = +Z**

## Input root cause

`input.ts` pre-fix `onMouseDown`: left button always `enqueue("attack")` after HTML filter.
Post-fix: `setWorldClickHandler` / `dispatchWorldClick` routes interact vs pointer-lock vs attack.

## Touch layout root cause

Old CSS: 8 vertical buttons, bottom 150px, min height 606px column → overflow on 390px-tall landscape.
New CSS: compact 2-column rows + visible joystick, sized for 390px height.

## Baseline tests (before code changes)

- typecheck: pass
- test:game: 325/327 (2 climb failures, historical)

## After M1/M2/M3 partial implementation

- typecheck: pass
- test:game: 342/344 (same 2 historical failures; +17 new tests pass)
- build:app: see STATUS.md

## Orientation calibration decision

Measured +Z authored forward vs −Z logical forward → one-time `modelBasisRoot.rotation.y = π`.
Did **not** invert WASD, player.yaw, or camera.
