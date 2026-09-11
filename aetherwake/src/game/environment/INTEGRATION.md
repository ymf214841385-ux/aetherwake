# Scene.tsx drop-in (Lead copies — this package does not edit Scene.tsx)

World constants this package already reads from `height.ts`: `WORLD_SIZE = 384`, `TERRAIN_RES = 160`, `WATER_LEVEL = 3.35`. Terrain mesh stays `PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 159, 159)` with vertex colors from `colorAt`.

---

## 0. Invisible terrain (CODEX_REVIEW_07) — apply this first

Root cause is **not** winding, water covering, or fog. `hero-close.png` / `spawn-vista.png` show vegetation, rocks, and towers sitting at `heightAt()` while the ground mesh is missing — the water plane at `y=3.35` is what you see.

**Shader:** `createSplatTerrainMaterial` `onBeforeCompile` assigned `vec3 awVert = vColor`. Three.js r186 `color_pars_fragment` declares `varying vec4 vColor`. That GLSL type error fails program compile, so the mesh is not drawn. Fixed in `materials.ts` (`vColor.rgb`, dedicated `uGrassMap`, patch skipped → MeshStandard fallback). Cache key `aw-splat-v2-*`.

**Winding proof (do not DoubleSide):** after `rotateX(-PI/2)` + height displace, triangle `(a,b,d)` with `b` at +Z and `d` at +X has `(b-a)×(d-a) = +Y` on a flat cell. `averageIndexedFaceNormalY(buildDisplacedTerrainGeometry()) > 0.55`. FrontSide raycast from +Y hits spawn. Tests: `environment.test.ts`, `terrain.test.ts`.

**Grounding:** grass (`scatterGrass` / Scene `GrassField`), rocks, trees already instance at `heightAt`. They only look like they float because the terrain mesh was undrawn.

Replace inlined `buildTerrain()` so production matches the winding test (optional for visibility — the shader fix is the visibility fix):

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

Keep:

```tsx
<mesh ref={terrainMesh} geometry={terrain} material={terrainMats.splat} receiveShadow />
```

Do **not** set `side={THREE.DoubleSide}` on the ground. Keep `FrontSide` (splat material already sets it). After `loadEnvironmentMaps`, assigning `terrainMesh.current.material = next.splat` is still correct.

Verify: spawn grass/dirt must occlude the water plane; hero feet on opaque ground; no see-through teal under trees. Recapture `docs/rebuild-evidence/hero-close.png` and `spawn-vista.png`.

Quality: `low` 420 grass / 512 shadow / aniso 1; `mid` 900 / 1024 / 4; `high` 1600 / 2048 / 8. Prefer camera-local grass, not a full 384×384 carpet.

---

## 1. Imports (top of Scene.tsx)

```ts
import {
  LIGHTING,
  QUALITY_TIERS,
  LOD_DISTANCES,
  applyRendererPresentation,
  createDayFog,
  configureSunShadow,
  createTerrainMaterials,
  createPropMaterials,
  createRockGeometries,
  createVegetationKit,
  createWaterMaterial,
  updateWaterMaterial,
  updateGrassWind,
  loadEnvironmentMaps,
  loadDayEnvironment,
  scatterGrass,
  bucketByLod,
  writeInstanceMatrices,
  resolveQualityTier,
  buildDisplacedTerrainGeometry,
} from "./environment";
import { loadSettings } from "./settings";
```

---

## 2. Replace FogExp2 + renderer presentation

Current `useEffect` builds `THREE.FogExp2("#c8d8cc", 0.0032)` — that hides mid-field. Replace the fog block:

```ts
const { camera, scene, gl } = useThree();

useEffect(() => {
  applyRendererPresentation(gl, LIGHTING);
  const f = createDayFog(LIGHTING); // Fog(color, 100, 440)
  scene.fog = f;
  fogRef.current = f as unknown as THREE.FogExp2; // or change fogRef to THREE.Fog
  camera.near = 0.12;
  camera.far = 520;
  camera.updateProjectionMatrix();
  const light = sun.current;
  if (light) {
    scene.add(light.target);
    configureSunShadow(light, LIGHTING);
  }
  let mapsDispose: (() => void) | undefined;
  const tier = resolveQualityTier(loadSettings().quality);
  const q = QUALITY_TIERS[tier];
  loadEnvironmentMaps(q.terrainAnisotropy).then((maps) => {
    const next = createTerrainMaterials(maps);
    if (terrainMesh.current) terrainMesh.current.material = next.splat;
    mapsDispose = () => {
      next.splat.dispose();
    };
  }).catch(() => { /* keep color-only splat */ });
  if (q.envMap) {
    loadDayEnvironment(gl).then((env) => {
      if (env) {
        scene.environment = env;
        scene.environmentIntensity = LIGHTING.envMapIntensity;
      }
    });
  }
  return () => {
    terrain.dispose();
    if (light) scene.remove(light.target);
    mapsDispose?.();
  };
}, [camera, scene, gl, terrain]);
```

If `fogRef` stays `FogExp2`, change it to `THREE.Fog | THREE.FogExp2` and in `useFrame` set `fogRef.current.color` only (drop `density`). Linear fog already has `near`/`far`.

---

## 3. Terrain: replace MeshLambert / toon

Current:

```tsx
<mesh ref={terrainMesh} geometry={terrain} receiveShadow>
  <meshLambertMaterial vertexColors />
</mesh>
```

Replace with:

```tsx
const terrainMat = useMemo(() => createTerrainMaterials().splat, []);
// ...
<mesh ref={terrainMesh} geometry={terrain} receiveShadow>
  <primitive attach="material" object={terrainMat} />
</mesh>
```

Keep `buildTerrain()` vertex colors. The splat shader tiles grass/dirt/rock/wet-shore in world XZ, uses slope + `WATER_LEVEL` for rock/shore, and multiplies vertex color at 42% so biomes stay readable without flat fills.

Standalone biome materials (patches, shrine floors): `createTerrainMaterials().grass | .dirt | .rock | .wetShore`.

---

## 4. Water

Current Lambert cyan plane:

```tsx
<mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]}>
  <planeGeometry args={[WORLD_SIZE * 1.4, WORLD_SIZE * 1.4, 24, 24]} />
  <meshLambertMaterial color="#3a8a92" transparent opacity={0.78} />
</mesh>
```

Replace with:

```tsx
const waterMat = useMemo(() => createWaterMaterial(), []);
const waterSeg = QUALITY_TIERS[resolveQualityTier(loadSettings().quality)].waterSegments;
// ...
<mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]}>
  <planeGeometry args={[WORLD_SIZE * 1.4, WORLD_SIZE * 1.4, waterSeg, waterSeg]} />
  <primitive attach="material" object={waterMat} />
</mesh>
```

In `useFrame`, replace the whole-plane bob with:

```ts
updateWaterMaterial(waterMat, sim.t);
if (water.current) water.current.position.y = WATER_LEVEL;
```

Optional helper (builds mesh + optional `heightAt` depth attribute):

```ts
import { createWaterMesh } from "./environment";
import { heightAt } from "./height";
const waterHandle = useMemo(
  () => createWaterMesh({ segments: 32, heightAt }),
  [],
);
// <primitive object={waterHandle.mesh} />
// waterHandle.update(sim.t);
```

---

## 5. Lighting block to replace

Current:

```tsx
<hemisphereLight args={["#d7ecff", "#6a7a50", 1.05]} />
<ambientLight intensity={0.38} color="#fff4e0" />
<directionalLight
  ref={sun}
  castShadow
  intensity={1.85}
  shadow-mapSize={[1536, 1536]}
  shadow-camera-near={2}
  shadow-camera-far={110}
  shadow-camera-left={-36}
  shadow-camera-right={36}
  shadow-camera-top={36}
  shadow-camera-bottom={-36}
/>
```

Replace with:

```tsx
<hemisphereLight args={[LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity]} />
<ambientLight intensity={LIGHTING.ambient} color={LIGHTING.ambientColor} />
<directionalLight
  ref={sun}
  castShadow
  color={LIGHTING.sunColor}
  intensity={LIGHTING.sunIntensity}
  position={[LIGHTING.sunDir.x * 50, LIGHTING.sunDir.y * 50, LIGHTING.sunDir.z * 50]}
  shadow-mapSize={[LIGHTING.shadowMapSize, LIGHTING.shadowMapSize]}
  shadow-bias={LIGHTING.shadowBias}
  shadow-normalBias={LIGHTING.shadowNormalBias}
  shadow-camera-near={LIGHTING.shadowCamNear}
  shadow-camera-far={LIGHTING.shadowCamFar}
  shadow-camera-left={-LIGHTING.shadowCamExtent}
  shadow-camera-right={LIGHTING.shadowCamExtent}
  shadow-camera-top={LIGHTING.shadowCamExtent}
  shadow-camera-bottom={-LIGHTING.shadowCamExtent}
/>
```

Keep the existing `useFrame` sun follow around the player. For a bright daytime lock, use `DAYTIME_TOD` (0.45) instead of `sim.timeOfDay` when `lockDay` is on. Do not restore FogExp2 density.

---

## 6. Rocks (unique geos, instanced)

Delete `const rockGeo = useMemo(() => new THREE.DodecahedronGeometry(0.7, 0), []);` and the single `<Instances geo={rockGeo} color="#6b6560" ... />`.

```tsx
const rockGeos = useMemo(() => createRockGeometries(), []);
const propMats = useMemo(() => createPropMaterials(), []);
const dummy = useMemo(() => new THREE.Object3D(), []);

function RockField({ items }: { items: typeof ROCKS }) {
  const groups = useMemo(() => {
    const bins: typeof ROCKS[] = rockGeos.map(() => []);
    for (let i = 0; i < items.length; i++) {
      bins[i % rockGeos.length]!.push(items[i]!);
    }
    return bins;
  }, [items]);
  return (
    <>
      {rockGeos.map((geo, i) => (
        <instancedMesh key={i} args={[geo, propMats.boulder, Math.max(1, groups[i]!.length)]} castShadow receiveShadow>
          {/* matrices: copy Scene's Instances useEffect, or writeInstanceMatrices */}
        </instancedMesh>
      ))}
    </>
  );
}
```

Geos sit on y=0 (slight embed). Instance at `{x, y: heightAt, z}` with `s` / `rot` from `ROCKS`. Origin is not a sphere center.

LOD: `createRockLodSets()` then `bucketByLod(ROCKS, camera.position, LOD_DISTANCES.rock)` into high/mid/low instanced meshes. Do not draw all three for the same instance.

---

## 7. Trees (broadleaf + pine, shared geo/mat)

Replace cylinder+sphere / cone kits:

```tsx
const veg = useMemo(() => createVegetationKit(), []);
```

Broadleaf (`TREES`): instance `veg.broadleaf[i % 3].trunk.mid` + `.crown.mid` with `propMats.bark` / `propMats.leaf`. Pine (`PINES`): `veg.pine[i % 2].trunk` + `.crown` with `propMats.pineBark` / `propMats.pine`.

```tsx
<instancedMesh args={[veg.broadleaf[0].trunk.high, propMats.bark, TREES.length]} castShadow receiveShadow />
<instancedMesh args={[veg.broadleaf[0].crown.high, propMats.leaf, TREES.length]} castShadow />
```

LOD helper:

```ts
const camPos = camera.position;
const treeBuckets = bucketByLod(TREES, camPos, LOD_DISTANCES.tree);
writeInstanceMatrices(highTrunkMesh, TREES, treeBuckets.high, dummy);
writeInstanceMatrices(midTrunkMesh, TREES, treeBuckets.mid, dummy);
writeInstanceMatrices(lowTrunkMesh, TREES, treeBuckets.low, dummy);
// same indices for matching crown meshes
```

Distances: tree high 22 / mid 58 / low 130 / cull 210.

---

## 8. Grass (replace GrassField cones)

Current: 900 `ConeGeometry` instances, Lambert `#4f9a48`.

```tsx
const q = QUALITY_TIERS[resolveQualityTier(loadSettings().quality)];
const grassItems = useMemo(() => scatterGrass({ count: q.grassCount }), [q.grassCount]);
const grassGeo = veg.grass[q.grassLod]; // high | mid | low
// instancedMesh with propMats.grass (double-sided, vertex wind)
```

In `useFrame`: `updateGrassWind(propMats.grass, sim.t);`

Keep grass camera-local if you raise counts; do not instance 10k across the island.

---

## 9. Instances material

Local `Instances` in Scene.tsx uses `<meshLambertMaterial color={color} />`. For rocks/trees/grass pass the shared `MeshStandardMaterial` instead of a color string:

```tsx
<instancedMesh ref={ref} args={[geo, material, Math.max(1, count)]} castShadow receiveShadow />
```

One material per part (bark, leaf, pine, boulder, grass). Do not clone per instance.

---

## 10. Async textures (optional, after first paint)

Color-only splat works immediately. After `loadEnvironmentMaps`, assign `terrainMesh.material = createTerrainMaterials(maps).splat` and rebuild `createPropMaterials(maps)` for bark/boulder. All maps are 1k, paths under `/assets/environment/`.
