# Environment in-game capture request (Lead)

Worker B owns `aetherwake/src/game/environment/**`. Scene.tsx is Lead-only.

## CODEX_REVIEW_07 — invisible terrain (fixed in environment, optional Scene helper)

`docs/rebuild-evidence/hero-close.png` and `spawn-vista.png`: large ground areas missing; trees/grass/rocks/towers sit at collision height over a teal water/sky fill.

### Root cause

**Splat shader compile failure**, not winding, not water replacing the mesh, not fog.

`createSplatTerrainMaterial` `onBeforeCompile` did `vec3 awVert = vColor`. Three r186 `ShaderChunk.color_pars_fragment` is `varying vec4 vColor`. GLSL cannot assign vec4→vec3. The program fails; Three.js skips the draw. The water mesh at `WATER_LEVEL = 3.35` (`createWaterMaterial`, opacity 0.86) is what remains. Props use `heightAt()` (~11.4 at spawn) so they appear to float.

Winding is **correct** for `FrontSide`. `PlaneGeometry` → `rotateX(-PI/2)` → overwrite `(x, height, z)`: triangle `(a, b, d)` (Three's indices) has `(b-a)×(d-a) = +Y` on a flat cell. `buildDisplacedTerrainGeometry()` + `averageIndexedFaceNormalY` > 0.55. Do **not** "fix" with `DoubleSide`.

Water does not replace the ground mesh; it is a separate plane. Linear fog is near 100 / far 440 — not hiding spawn. Camera far 520.

Vegetation/rocks are already grounded (`scatterGrass` / Scene `GrassField` / world instance `y`). They only look ungrounded because the terrain draw died.

Fix landed in `aetherwake/src/game/environment/materials.ts` (`vColor.rgb`, `uGrassMap`, `aw-splat-v2-*`). Tests in `environment.test.ts` + FrontSide raycast in `terrain.test.ts`.

### Exact Scene.tsx patch (optional; shader fix is the visibility fix)

Match production geometry to the winding helper. Do not edit winding. Do not DoubleSide.

```diff
 import {
   LIGHTING,
   QUALITY_TIERS,
   applyRendererPresentation,
   configureSunShadow,
   createDayFog,
   createGrassClumpGeometry,
   createRockGeometries,
   createTerrainMaterials,
   createVegetationKit,
   createWaterMaterial,
   loadDayEnvironment,
   loadEnvironmentMaps,
   resolveQualityTier,
   updateWaterMaterial,
+  buildDisplacedTerrainGeometry,
 } from "./environment";

-function buildTerrain() {
-  const res = TERRAIN_RES;
-  const field = getHeightField();
-  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res - 1, res - 1);
-  geo.rotateX(-Math.PI / 2);
-  const pos = geo.attributes.position;
-  const colors = new Float32Array(pos.count * 3);
-  for (let i = 0; i < pos.count; i++) {
-    const ix = i % res;
-    const iy = Math.floor(i / res);
-    const { x, z } = terrainVertexXZ(ix, iy, res);
-    const y = field.ys[iy * res + ix]!;
-    pos.setXYZ(i, x, y, z);
-    const c = colorAt(x, z, y);
-    colors[i * 3] = c.r;
-    colors[i * 3 + 1] = c.g;
-    colors[i * 3 + 2] = c.b;
-  }
-  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
-  geo.computeVertexNormals();
-  return geo;
-}
+function buildTerrain() {
+  return buildDisplacedTerrainGeometry();
+}
```

Keep `<mesh ref={terrainMesh} geometry={terrain} material={terrainMats.splat} receiveShadow />`. Keep `loadEnvironmentMaps` → `terrainMesh.current.material = next.splat`. Keep water as a separate mesh at `WATER_LEVEL`.

If a shader error still appears in the WebGL console, the splat patch now **skips** and the MeshStandard + vertexColors + grass map fallback must still draw opaque ground.

## When to shoot

After the splat v2 material is in the running Game Scene (environment module; Scene helper optional). Same `GameWorld` camera. `sim.mode = "playing"`, lock day, player grounded.

## Six poses (match `aetherwake/scripts/capture-views.mjs`)

| id | player x,z | yaw | pitch | dist | note |
|---|---|---|---|---|---|
| spawn-vista | 16, 96 | 0 | 0.28 | 9 | spawn looking toward dawn tower |
| hero-close | 16, 100 | 0.4 | 0.18 | 3.4 | hero close-up (front-ish) |
| cliff-lookback | 22, 88 | 3.0 | 0.22 | 8 | cliff look back |
| glide-down | 12, 82 | 0.2 | 0.7 | 10 | high look / glide angle |
| lake-shore | -62, 28 | 1.4 | 0.22 | 10 | lake shore |
| ruin-camp | 24, 76 | 0.5 | 0.28 | 12 | wind ruin |

Output: `docs/rebuild-evidence/{id}.png`.

**Pass:** opaque grass/dirt/rock ground under feet; water only in lakes/ocean; props sit on that mesh, not in empty teal.

## How to verify in the actual Scene (Lead)

1. `cd aetherwake && npm run test:game` — splat needle + winding tests pass.
2. Run the game (existing preview). Open WebGL shader logs: no `aw splat` / `vec3 awVert = vColor` errors.
3. Recapture `hero-close` and `spawn-vista`. Ground must be a textured heightfield, not the water plane.
4. Optional: `mesh.material.side` stays `FrontSide` (0), not DoubleSide (2).
