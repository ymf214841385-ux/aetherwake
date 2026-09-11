# Environment visual modules (Worker B)

Lead owns `Scene.tsx`. This package is drop-in only: `aetherwake/src/game/environment/` + CC0 maps in `aetherwake/public/assets/environment/`. Integration copy-paste: `aetherwake/src/game/environment/INTEGRATION.md`.

## Files

### Code (`aetherwake/src/game/environment/`)

| File | Role |
|---|---|
| `index.ts` | Public API + `createEnvironment()` |
| `types.ts` | Lod / quality / instance / map types |
| `proc.ts` | Seeded noise, merge, ground-recenter, box UVs |
| `textures.ts` | 1k path table, TextureLoader, HDRI PMREM |
| `materials.ts` | Grass/dirt/rock/wet-shore Standard + world-XZ splat (`vColor.rgb`, `aw-splat-v2`) |
| `terrainGeo.ts` | `buildDisplacedTerrainGeometry` + FrontSide winding helpers |
| `rocks.ts` | 6 unique boulder geos + LOD (`createRockGeometries`) |
| `vegetation.ts` | Broadleaf / pine kits, grass clumps, spawn scatter |
| `water.ts` | `createWaterMaterial`, `createWaterMesh`, ripple + depth |
| `lighting.ts` | Daytime `LIGHTING` rig, linear fog, shadow bias |
| `quality.ts` | low/mid/high grass, shadow, anisotropy |
| `lod.ts` | Distance buckets + instanced matrix writer |
| `environment.test.ts` | Geometry / material / quality assertions |
| `INTEGRATION.md` | Exact Scene.tsx replacements |

### Assets (`aetherwake/public/assets/environment/`)

1k JPG albedo + OpenGL normal + roughness for grass, dirt, rock, shore, boulder, bark; 1k HDRI. Licenses: `LICENSES.md` (all Poly Haven CC0, downloaded 2026-09-09, no login).

## Poly / texture budget

| Item | Budget | Notes |
|---|---|---|
| Terrain mesh | 160×160 verts, ~50.5k tris | Unchanged; we only swap material |
| Terrain textures | 4 sets × 3 maps × 1024 | grass/dirt/rock/shore, ~8 MB |
| Boulder + bark | 2 sets × 3 maps × 1024 | ~4 MB |
| HDRI | 1k Radiance HDR | 1.4 MB; skip on `low` |
| Folder total | ~16 MB on disk | Poly Haven 1k sets + licenses. `grass-albedo*.jpg` / `rock-albedo*.jpg` are unused, have no license row (unknown provenance per LICENSE_AUDIT) — do not ship as CC0. |
| Rock high | 6 × 320 tris (icosa d=2) | mid 80 / low 20; instanced |
| Broadleaf high | trunk ~160 tris + crown ~480 | 3 variants; shared mats |
| Pine high | trunk + 4 displaced cones | 2 variants |
| Grass clump | 96 / 42 / 16 tris | 12 / 7 / 4 blades |
| Water | 16² / 32² / 48² segs | vertex ripples, no fullscreen FX |
| Grass instances | 420 / 900 / 1600 | camera-local; current Scene is 900 |

Do not stack SSAO/bloom/SSR on top of this. Shadow maps: 512 / 1024 / 2048, ortho extent 36 around the player.

## Lighting

`LIGHTING`: sun `#f2ead4` @ 2.2, dir from `DAYTIME_TOD = 0.45` (high), hemi sky `#c9deee` / ground `#6a6e56`, linear fog `#d4dfd2` near 100 far 440, exposure 1.06, PCF soft, bias -0.00028 / normalBias 0.035. Not FogExp2. Not thick haze.

## Remaining gaps

- **CODEX_REVIEW_07 (shader):** splat `vec3 awVert = vColor` failed to compile (vColor is vec4). Fixed in `materials.ts` (`vColor.rgb`, `aw-splat-v2`). Winding is +Y / FrontSide — not a DoubleSide fix. Vegetation already uses `heightAt`; they looked afloat because the mesh was undrawn. Lead should recapture `hero-close.png` / `spawn-vista.png` (see `CAPTURE_REQUEST.md`). Optional Scene helper: `buildDisplacedTerrainGeometry()`.
- Scene.tsx is only partly wired (trees/grass still Lambert instances in places). Lead paste remainder from INTEGRATION.md.
- Splat uses slope + waterline + vertex-color dirt, not a painted splat map. Paths from `colorAt` show as dirt-ish but are not a dedicated trail texture.
- No leaf-card atlas; crowns are displaced icosa / cones with foliage vertex tint.
- Water depth is analytic (lake + ocean shelf) unless `createWaterMesh({ heightAt })` is used.
- HDRI is optional; `low` skips envmap.
- No dedicated wetness/flow maps or shore foam mesh.
- In-game near/mid/far acceptance still requires Lead screenshots (T24) **after** the splat v2 recapture. Do not treat the current floating-prop PNGs as environment pass.
