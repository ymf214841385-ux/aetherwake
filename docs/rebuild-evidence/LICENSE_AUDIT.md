# License audit (Worker 3)

Read-only check of shipped assets. No files were relicensed.

## Character — `aetherwake/public/assets/character/`

| File | Claim in tree | Status |
|---|---|---|
| `LICENSE.txt` | Original procedural hero; no third-party GLB | Present. States Mixamo/Rocketbox/Quaternius were searched and **not** vendored. |
| `LICENSES.md` | `wanderer-reference.jpg` original; runtime hero is `src/game/character/` | Present and consistent with LICENSE.txt. |
| `wanderer-reference.jpg` | Original local visual target, not a shipped mesh | Listed. Not a third-party model. |
| `wanderer.glb` | Optional CC0/CC-BY drop path | **Absent** (expected). `loadRiggedGLB()` would load it if added. |

Runtime mesh/animation is original code under `aetherwake/src/game/character/` (PBR hierarchical rig). No Mixamo / Ready Player Me / paid GLB in this folder.

## Environment — `aetherwake/public/assets/environment/`

`LICENSES.md` lists Poly Haven **CC0 1.0** maps downloaded 2026-09-09, no login. Runtime loader (`environment/textures.ts`) uses only the `*_1k.jpg` / HDRI rows below.

| File | LICENSES.md | Runtime | Status |
|---|---|---|---|
| `grass_{diff,nor_gl,rough}_1k.jpg` | aerial_grass_rock, Rob Tuytel, CC0 | yes | OK |
| `dirt_{diff,nor_gl,rough}_1k.jpg` | dirt, Charlotte Baglioni, CC0 | yes | OK |
| `rock_{diff,nor_gl,rough}_1k.jpg` | rock_face, Zaal / Barresi, CC0 | yes | OK |
| `shore_{diff,nor_gl,rough}_1k.jpg` | coast_sand_01, Rob Tuytel, CC0 | yes | OK |
| `boulder_{diff,nor_gl,rough}_1k.jpg` | rock_boulder_dry, Savva / Cilliers, CC0 | yes | OK |
| `bark_{diff,nor_gl,rough}_1k.jpg` | bark_brown_02, Rob Tuytel, CC0 | yes | OK |
| `hdri_day_1k.hdr` | kloofendal_48d_partly_cloudy_puresky, Zaal / Guest, CC0 | yes | OK |
| `LICENSES.md` | — | — | OK |

### Unknown / extra (not in LICENSES.md table)

| File | Referenced by game? | Flag |
|---|---|---|
| `grass-albedo.jpg` | no | **Unknown provenance.** Moved to `docs/rebuild-evidence/unlicensed-hold/` so `vite build` does not copy them. |
| `grass-albedo-tile2x2.jpg` | no | Same. |
| `rock-albedo.jpg` | no | Same. |
| `rock-albedo-tile2x2.jpg` | no | Same. |

Moved out of `public/` this pass. Not in the Poly Haven table. Not shipped in `packed/aetherwake.zip`.

## Other `public/` files (outside character/environment LICENSE docs)

| Path | Notes |
|---|---|
| `public/favicon.svg`, `public/og.jpg`, `public/x-banner.jpg` | App brand. Not covered by the Poly Haven or character license files. Treat as original to this repo unless brand-check says otherwise. |
| `public/__grok/**` | Grok PWA install chrome (SVG/PNG). Platform tutorial assets, not game art. |

## Verdict

- Shipped **runtime** environment maps: CC0 Poly Haven, documented.
- Shipped **runtime** hero: original procedural rig, documented.
- **Blocker for a clean asset sheet:** four unused `*-albedo*.jpg` files with no license row.
- No Mixamo/paid GLB found in `public/assets/character/`.
