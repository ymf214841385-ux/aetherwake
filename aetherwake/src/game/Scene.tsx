import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import * as THREE from "three";
import {
  animateWanderer,
  createAwakening,
  createBomb,
  createBoss,
  createBramblekin,
  createCamp,
  createCitadel,
  createIcePillar,
  createSage,
  createSentinel,
  createShrine,
  createTower,
  disposeRiggedGLB,
  loadRiggedGLB,
  mats,
} from "./figures";
import type { LimbSet } from "./wandererRig";
import { createClock, onVisibility, tickClock } from "./clock";
import { grayboxSolids } from "./graybox";
import { WATER_LEVEL, WORLD_SIZE, heightAt } from "./height";
import { resetInput } from "./input";
import { sim } from "./sim";
import { setPickables, setOccluders } from "./pick-registry";
import {
  LIGHTING,
  QUALITY_TIERS,
  applyRendererPresentation,
  buildDisplacedTerrainGeometry,
  configureSunShadow,
  createDayFog,
  createPropMaterials,
  createRockGeometries,
  createTerrainMaterials,
  createVegetationKit,
  createWaterMaterial,
  loadDayEnvironment,
  loadEnvironmentMaps,
  resolveQualityTier,
  scatterGrass,
  updateGrassWind,
  updateWaterMaterial,
} from "./environment";
import type { EnvironmentMaps } from "./environment";
import { loadSettings } from "./settings";
import {
  BURST_WALL,
  CAMPS,
  CITADEL_POI,
  CHESTS,
  FIRES,
  PINES,
  ROCKS,
  SAGE,
  SHRINES,
  SHRINE_ROOM,
  SHRINE_SIDEWALK,
  TOWERS,
  TREES,
  WISPS,
  shrineHasSidewalk,
  shrinePitHalfWidth,
  shrinePitSpanZ,
  shrineWorldOrigin,
  STILL_BLOCK,
  towerNeedsDock,
} from "./world";

function buildTerrain() {
  return buildDisplacedTerrainGeometry();
}

const skyVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = position;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 botColor;
  uniform vec3 sunDir;
  uniform float night;
  varying vec3 vW;
  void main() {
    vec3 n = normalize(vW);
    float h = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(botColor, topColor, pow(h, 0.85));
    float sun = pow(max(0.0, dot(n, normalize(sunDir))), 48.0);
    col += vec3(1.0, 0.86, 0.55) * sun * (1.0 - night);
    float stars = 0.0;
    if (night > 0.4) {
      float s = fract(sin(dot(n.xy, vec2(12.9898,78.233))) * 43758.5453);
      stars = step(0.992, s) * night;
    }
    col += vec3(stars);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function GameWorld() {
  const { camera, scene, gl } = useThree();
  // The hero is an authored GLB. Until it resolves (or if it fails), render no
  // procedural stand-in: a failed asset load must be visible to development.
  const [wanderer, setWanderer] = useState<LimbSet | null>(null);
  const terrain = useMemo(() => buildTerrain(), []);
  const sun = useRef<THREE.DirectionalLight>(null);
  const skyMat = useRef<THREE.ShaderMaterial>(null);
  const water = useRef<THREE.Mesh>(null);
  const enemyMeshes = useRef<THREE.Group[]>([]);
  const iceMeshes = useRef<THREE.Group[]>([]);
  const metalMeshes = useRef<THREE.Mesh[]>([]);
  const bombRef = useRef<THREE.Group>(null);
  const wispRefs = useRef<THREE.Mesh[]>([]);
  const pickupRefs = useRef<THREE.Mesh[]>([]);
  const projRefs = useRef<THREE.Mesh[]>([]);
  const particleRef = useRef<THREE.Points>(null);
  const particlePos = useMemo(() => new Float32Array(180 * 3), []);
  const particleCol = useMemo(() => new Float32Array(180 * 3), []);
  const clock = useRef(createClock());
  const fogRef = useRef<THREE.Fog | null>(null);
  const waterMat = useMemo(() => createWaterMaterial(), []);
  const [envMaps, setEnvMaps] = useState<EnvironmentMaps | null>(null);
  const terrainMats = useMemo(() => createTerrainMaterials(envMaps), [envMaps]);
  const propMats = useMemo(() => createPropMaterials(envMaps), [envMaps]);
  const rockGeos = useMemo(() => createRockGeometries(), []);
  const quality = useMemo(() => QUALITY_TIERS[resolveQualityTier(loadSettings().quality)], []);
  const shrineRooms = useRef<THREE.Group[]>([]);
  const cracked = useRef<THREE.Mesh[]>([]);
  const moveBlock = useRef<THREE.Mesh>(null);
  const terrainMesh = useRef<THREE.Mesh>(null);
  const grayGroup = useRef<THREE.Group>(null);
  const plankMeshes = useRef<THREE.Mesh[]>([]);
  const bombObj = useMemo(() => createBomb(), []);
  const treeDummy = useMemo(() => new THREE.Object3D(), []);
  const sunDir = useMemo(() => new THREE.Vector3(), []);
  const topCol = useMemo(() => new THREE.Color(), []);
  const botCol = useMemo(() => new THREE.Color(), []);

  const landmarks = useMemo(
    () => ({
      towers: TOWERS.map((t) => ({ t, obj: createTower(38, t.y, towerNeedsDock(t)) })),
      shrines: SHRINES.map((s) => ({ s, obj: createShrine() })),
      camps: CAMPS.map((c) => ({ c, obj: createCamp() })),
      citadel: createCitadel(),
      wake: createAwakening(),
      sage: createSage(),
    }),
    [],
  );

  useEffect(() => {
    applyRendererPresentation(gl, LIGHTING);
    const f = createDayFog(LIGHTING);
    scene.fog = f;
    fogRef.current = f;
    camera.near = 0.12;
    camera.far = 520;
    camera.updateProjectionMatrix();
    const light = sun.current;
    if (light) {
      scene.add(light.target);
      configureSunShadow(light, LIGHTING);
    }
    const q = QUALITY_TIERS[resolveQualityTier(loadSettings().quality)];
    let cancelled = false;
    loadEnvironmentMaps(q.terrainAnisotropy)
      .then((maps) => {
        if (!cancelled) setEnvMaps(maps);
      })
      .catch(() => {
        /* keep color-only splat */
      });
    if (q.envMap) {
      loadDayEnvironment(gl).then((env) => {
        if (!env || cancelled) return;
        scene.environment = env;
        scene.environmentIntensity = LIGHTING.envMapIntensity;
      });
    }
    if (terrainMesh.current) terrainMesh.current.frustumCulled = false;
    return () => {
      cancelled = true;
      terrain.dispose();
      if (light) scene.remove(light.target);
    };
  }, [camera, gl, scene, terrain]);

  useEffect(() => {
    let live = true;
    let loaded: LimbSet | null = null;
    loadRiggedGLB().then((rig) => {
      if (!live) {
        if (rig) disposeRiggedGLB(rig.root);
        return;
      }
      loaded = rig;
      setWanderer(rig);
    });
    return () => {
      live = false;
      if (loaded) disposeRiggedGLB(loaded.root);
    };
  }, []);

  useEffect(() => {
    if (!terrainMesh.current) return;
    terrainMesh.current.material = terrainMats.splat;
    terrainMesh.current.frustumCulled = false;
  }, [terrainMats]);

  const veg = useMemo(() => createVegetationKit(), []);
  const trees = useMemo(() => {
    const b0 = veg.broadleaf[0]!;
    const b1 = veg.broadleaf[1] ?? b0;
    return { trunk: b0.trunk.mid, leaf: b0.crown.mid, leaf2: b1.crown.mid };
  }, [veg]);
  const pineGeo = useMemo(() => {
    const p0 = veg.pine[0]!;
    return { t: p0.trunk.mid, c: p0.crown.mid };
  }, [veg]);
  const rockSlices = useMemo(() => {
    const geos = rockGeos.length ? rockGeos : [new THREE.DodecahedronGeometry(0.7, 0)];
    return geos.map((geo, gi) => ({
      geo,
      items: ROCKS.filter((_, i) => i % geos.length === gi),
    }));
  }, [rockGeos]);
  const landUntil = useRef(0);
  const wasAir = useRef(false);

  useEffect(() => {
    const vis = () => {
      const hidden = document.hidden;
      onVisibility(clock.current, hidden);
      if (hidden) {
        resetInput();
        if (sim.mode === "playing") sim.tryAutosave();
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  useFrame((_, dt) => {
    clock.current.paused = sim.portrait && sim.mode === "playing";
    tickClock(clock.current, dt, (fixed, actions) => sim.step(fixed, actions));
    const p = sim.player;
    if (wanderer) {
      wanderer.root.position.set(p.x, p.y, p.z);
      wanderer.root.rotation.y = p.yaw;
    }
    const moving = Math.hypot(p.vx, p.vz) > 0.4;
    const spd = Math.hypot(p.vx, p.vz);
    if (!p.grounded && p.state !== "climbing" && p.state !== "swimming") wasAir.current = true;
    else if (p.grounded && wasAir.current) {
      landUntil.current = sim.t + 0.22;
      wasAir.current = false;
    }
    const landing = p.grounded && sim.t < landUntil.current && !moving;
    const st =
      p.state === "dead"
        ? "death"
        : p.invuln > 0.7 && p.hp < p.heartsMax
          ? "hit"
          : p.gliding
            ? "glide"
            : p.climbing
              ? "climb"
              : p.attackT > 0
                ? "attack"
                : p.aiming
                  ? "bow"
                  : p.swimming
                    ? "swim"
                    : !p.grounded && p.vy > 2
                      ? "jump"
                      : !p.grounded
                        ? "fall"
                        : landing
                          ? "land"
                          : moving
                            ? spd > 5.6
                              ? "run"
                              : "walk"
                            : "idle";
    if (wanderer) animateWanderer(wanderer, sim.t, st, p.attackT);

    const shake = sim.cam.trauma * sim.cam.trauma;
    const sx = (Math.random() - 0.5) * shake * 0.35;
    const sy = (Math.random() - 0.5) * shake * 0.35;
    camera.position.set(sim.cam.x + sx, sim.cam.y + sy, sim.cam.z);
    camera.lookAt(sim.cam.lx, sim.cam.ly, sim.cam.lz);

    const day = sim.timeOfDay;
    const ang = (day - 0.25) * Math.PI * 2;
    sunDir.set(Math.cos(ang), Math.sin(ang), 0.25).normalize();
    if (sun.current) {
      sun.current.position.set(p.x + sunDir.x * 50, p.y + sunDir.y * 50 + 20, p.z + sunDir.z * 50);
      sun.current.target.position.set(p.x, p.y, p.z);
      sun.current.target.updateMatrixWorld();
      if (sim.settings.lockDay) {
        sun.current.intensity = LIGHTING.sunIntensity;
        sun.current.color.set(LIGHTING.sunColor);
      } else {
        const up = Math.max(0, sunDir.y);
        sun.current.intensity = 0.35 + up * 1.7;
        sun.current.color.set(day > 0.7 || day < 0.15 ? "#6a7cb0" : "#fff1d0");
      }
    }
    const night = day > 0.72 || day < 0.12 ? 1 : day > 0.62 || day < 0.2 ? 0.45 : 0;
    if (skyMat.current) {
      if (night > 0.5) {
        topCol.set("#0b1430");
        botCol.set("#1a2438");
      } else if (day > 0.55 && day < 0.7) {
        topCol.set("#c07050");
        botCol.set("#e8b070");
      } else {
        topCol.set("#9ad2f0");
        botCol.set("#e7f0d4");
      }
      skyMat.current.uniforms.topColor!.value.copy(topCol);
      skyMat.current.uniforms.botColor!.value.copy(botCol);
      skyMat.current.uniforms.sunDir!.value.copy(sunDir);
      skyMat.current.uniforms.night!.value = night;
    }
    if (fogRef.current) {
      fogRef.current.color.set(night > 0.5 ? "#121820" : sim.raining ? "#8aa0a4" : LIGHTING.fogColor);
      fogRef.current.near = sim.raining ? 70 : LIGHTING.fogNear;
      fogRef.current.far = sim.raining ? 280 : LIGHTING.fogFar;
    }
    if (water.current) {
      water.current.position.y = WATER_LEVEL;
      if (water.current.material) updateWaterMaterial(water.current.material as THREE.Material, sim.t);
    }
    updateGrassWind(propMats.grass, sim.t);

    for (let i = 0; i < enemyMeshes.current.length; i++) {
      const mesh = enemyMeshes.current[i];
      const e = sim.enemies[i];
      if (!mesh || !e) continue;
      mesh.visible = e.alive && sim.shrine === null;
      mesh.position.set(e.x, e.y, e.z);
      mesh.rotation.y = e.yaw;
      mesh.scale.setScalar(e.flash > 0 ? 1.08 : 1);
      mesh.rotation.z = e.frozen > 0 ? 0.08 : 0;
    }

    for (let i = 0; i < iceMeshes.current.length; i++) {
      const m = iceMeshes.current[i];
      const ice = sim.ices[i];
      if (!m) continue;
      if (!ice) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(ice.x, ice.y, ice.z);
    }

    for (let i = 0; i < metalMeshes.current.length; i++) {
      const m = metalMeshes.current[i];
      const met = sim.metals[i];
      if (!m) continue;
      if (!met) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(met.x, met.y, met.z);
    }

    if (bombRef.current) {
      if (sim.bomb) {
        bombRef.current.visible = true;
        bombRef.current.position.set(sim.bomb.x, sim.bomb.y, sim.bomb.z);
      } else bombRef.current.visible = false;
    }

    for (let i = 0; i < WISPS.length; i++) {
      const m = wispRefs.current[i];
      const w = WISPS[i]!;
      if (!m) continue;
      m.visible = !sim.wispsGot.has(w.id) && sim.shrine === null;
      m.position.set(w.x, w.y + 1.1 + Math.sin(sim.t * 2 + i) * 0.25, w.z);
    }

    for (let i = 0; i < pickupRefs.current.length; i++) {
      const m = pickupRefs.current[i];
      const pk = sim.pickups[i];
      if (!m) continue;
      if (!pk || !pk.live) {
        m.visible = false;
        continue;
      }
      m.visible = sim.shrine === null;
      m.position.set(pk.x, pk.y + Math.sin(sim.t * 3 + i) * 0.12, pk.z);
      m.rotation.y = sim.t;
    }

    for (let i = 0; i < projRefs.current.length; i++) {
      const m = projRefs.current[i];
      const q = sim.projs[i];
      if (!m) continue;
      if (!q) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(q.x, q.y, q.z);
    }

    if (particleRef.current) {
      particlePos.fill(0);
      particleCol.fill(0);
      for (let i = 0; i < sim.particles.length && i < 180; i++) {
        const q = sim.particles[i]!;
        particlePos[i * 3] = q.x;
        particlePos[i * 3 + 1] = q.y;
        particlePos[i * 3 + 2] = q.z;
        particleCol[i * 3] = q.r;
        particleCol[i * 3 + 1] = q.g;
        particleCol[i * 3 + 2] = q.b;
      }
      const pa = particleRef.current.geometry.getAttribute("position");
      const ca = particleRef.current.geometry.getAttribute("color");
      if (pa) pa.needsUpdate = true;
      if (ca) ca.needsUpdate = true;
    }

    for (let i = 0; i < 4; i++) {
      const g = shrineRooms.current[i];
      if (g) g.visible = sim.shrine === i;
      const cr = cracked.current[i];
      if (cr) cr.visible = sim.shrine === i && !sim.crackedBroken[i];
    }
    if (terrainMesh.current) terrainMesh.current.visible = sim.worldKind !== "graybox";
    if (grayGroup.current) grayGroup.current.visible = sim.worldKind === "graybox";
    for (let i = 0; i < plankMeshes.current.length; i++) {
      const m = plankMeshes.current[i];
      const p = sim.planks[i];
      if (!m) continue;
      if (!p) {
        m.visible = false;
        continue;
      }
      m.visible = sim.worldKind === "overworld";
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = p.yaw;
    }
    if (moveBlock.current) {
      const inStill = sim.shrine !== null && SHRINES[sim.shrine]?.puzzle === "still";
      moveBlock.current.visible = inStill;
      if (inStill && sim.shrine !== null) {
        moveBlock.current.position.set(
          sim.moveBlock.x,
          shrineWorldOrigin(sim.shrine).y + STILL_BLOCK.h / 2,
          sim.moveBlock.z,
        );
      }
    }
  });

  return (
    <>
      <mesh ref={terrainMesh} geometry={terrain} material={terrainMats.splat} receiveShadow frustumCulled={false} />
      <mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} material={waterMat} frustumCulled={false}>
        <planeGeometry args={[WORLD_SIZE * 1.4, WORLD_SIZE * 1.4, quality.waterSegments, quality.waterSegments]} />
      </mesh>
      <hemisphereLight args={[LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity]} />
      <ambientLight intensity={LIGHTING.ambient} color={LIGHTING.ambientColor} />
      <directionalLight
        ref={sun}
        castShadow
        color={LIGHTING.sunColor}
        intensity={LIGHTING.sunIntensity}
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
      <GrassField geo={veg.grass[quality.grassLod]} material={propMats.grass} count={quality.grassCount} />
      {wanderer && <primitive object={wanderer.root} />}
      <SkyDome matRef={skyMat} />
      <Instances geo={trees.trunk} material={propMats.bark} items={TREES} dummy={treeDummy} count={TREES.length} />
      <Instances geo={trees.leaf} material={propMats.leaf} items={TREES} dummy={treeDummy} count={TREES.length} />
      <Instances geo={trees.leaf2} material={propMats.leafB} items={TREES} dummy={treeDummy} count={TREES.length} />
      <Instances geo={pineGeo.t} material={propMats.pineBark} items={PINES} dummy={treeDummy} count={PINES.length} />
      <Instances geo={pineGeo.c} material={propMats.pine} items={PINES} dummy={treeDummy} count={PINES.length} />
      {rockSlices.map((slice, i) => (
        <Instances key={`rock-${i}`} geo={slice.geo} material={propMats.boulder} items={slice.items} dummy={treeDummy} count={slice.items.length} />
      ))}
      {landmarks.towers.map(({ t, obj }) => (
        <primitive
          key={t.id}
          object={obj}
          position={[t.x, t.y, t.z]}
          userData={{ interactId: `tower:${t.id}`, worldId: "overworld" }}
        />
      ))}
      <mesh position={[28 + 6.4, heightAt(28, 74) + 4.35, 74 - 3.2]} receiveShadow castShadow>
        <boxGeometry args={[3.4, 0.35, 3.4]} />
        <meshLambertMaterial color="#c2b49a" />
      </mesh>
      <mesh position={[28 - 3.2, heightAt(28, 74) + 0.28, 74]} receiveShadow>
        <boxGeometry args={[3.2, 0.35, 2.4]} />
        <meshLambertMaterial color="#b8a888" />
      </mesh>
      <mesh position={[28 + 3.6, heightAt(28, 74) + 0.28, 74.4]} receiveShadow>
        <boxGeometry args={[3.2, 0.35, 2.4]} />
        <meshLambertMaterial color="#b8a888" />
      </mesh>
      {landmarks.shrines.map(({ s, obj }) => (
        <primitive
          key={s.id}
          object={obj}
          position={[s.x, s.y, s.z]}
          userData={{ interactId: `shrine:${s.id}`, worldId: "overworld" }}
        />
      ))}
      {landmarks.camps.map(({ c, obj }) => (
        <primitive key={c.id} object={obj} position={[c.x, c.y, c.z]} />
      ))}
      <primitive
        object={landmarks.citadel}
        position={[CITADEL_POI.x, CITADEL_POI.y, CITADEL_POI.z]}
        name="citadel-occluder"
        userData={{ pickOccluder: true }}
      />
      <primitive object={landmarks.wake} position={[16, heightAt(16, 102), 102]} />
      <primitive object={landmarks.sage} position={[SAGE.x, SAGE.y, SAGE.z]} userData={{ interactId: "sage", worldId: "overworld" }} />
      <PickablesRegistrar />
      <EnemyPool refs={enemyMeshes} />
      <IcePool refs={iceMeshes} />
      <MetalPool refs={metalMeshes} />
      <primitive ref={bombRef} object={bombObj} visible={false} />
      <WispPool refs={wispRefs} />
      <PickupPool refs={pickupRefs} />
      <ProjPool refs={projRefs} />
      <points ref={particleRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particlePos, 3]} />
          <bufferAttribute attach="attributes-color" args={[particleCol, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.22} vertexColors depthWrite={false} transparent opacity={0.9} />
      </points>
      {FIRES.map((f) => (
        <group key={f.id} position={[f.x, f.y, f.z]} userData={{ interactId: `fire:${f.id}`, worldId: "overworld" }}>
          <pointLight position={[0, 0.8, 0]} color="#ff8844" intensity={2.4} distance={8} />
          <mesh position={[0, 0.2, 0]}>
            <sphereGeometry args={[0.35, 8, 8]} />
            <meshBasicMaterial color="#ffaa55" transparent opacity={0.35} />
          </mesh>
        </group>
      ))}
      {CHESTS.map((c) => (
        <mesh
          key={c.id}
          position={[c.x, c.y + 0.35, c.z]}
          castShadow
          userData={{ interactId: `chest:${c.id}`, worldId: "overworld" }}
        >
          <boxGeometry args={[0.7, 0.5, 0.5]} />
          <meshLambertMaterial color="#6b4a28" />
        </mesh>
      ))}
      <ShrineRooms rooms={shrineRooms} cracked={cracked} moveBlock={moveBlock} />
      <PlankPool refs={plankMeshes} />
      <GrayboxView groupRef={grayGroup} />
      <ValidatedRouteLines />
    </>
  );
}

/** Draw only validated walk segments as support-following polylines. */
function ValidatedRouteLines() {
  const [segs, setSegs] = useState<{ key: string; positions: Float32Array }[]>([]);
  useFrame(() => {
    const snap = sim.navigationSnapshot();
    const next = snap.segments
      .filter((s) => s.validated && s.kind === "walk" && (s.polyline?.length ?? 0) >= 2)
      .map((s) => {
        const pts = s.polyline!;
        // (n-1) segments × 2 endpoints × 3 components — no zero-filled tail.
        const arr = new Float32Array((pts.length - 1) * 6);
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!;
          const b = pts[i + 1]!;
          const o = i * 6;
          arr[o] = a.x;
          arr[o + 1] = a.y + 0.35;
          arr[o + 2] = a.z;
          arr[o + 3] = b.x;
          arr[o + 4] = b.y + 0.35;
          arr[o + 5] = b.z;
        }
        // Key includes every sample so interior support changes invalidate.
        const key = `${s.id}|${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join(";")}`;
        return { key, positions: arr };
      });
    setSegs((prev) => {
      if (prev.length === next.length && prev.every((p, i) => p.key === next[i]?.key)) return prev;
      return next;
    });
  });
  return (
    <>
      {segs.map((s) => (
        <lineSegments key={s.key}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[s.positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#7dffb3" transparent opacity={0.85} />
        </lineSegments>
      ))}
    </>
  );
}

/** Collect tagged interactables from the live scene into the pick registry. */
function PickablesRegistrar() {
  const scene = useThree((s) => s.scene);
  const [activeWorld, setActiveWorld] = useState(() => sim.currentWorldId());
  useFrame(() => {
    const cur = sim.currentWorldId();
    setActiveWorld((prev) => (prev === cur ? prev : cur));
  });

  useEffect(() => {
    const list: { targetId: string; worldId: string; object: THREE.Object3D; range: number; maxDy: number }[] = [];
    const occluders: THREE.Object3D[] = [];
    const meta = new Map(sim.collectInteractionCandidates({ includeWisps: true }).map((c) => [c.targetId, c]));
    scene.traverse((obj) => {
      const id = obj.userData?.interactId as string | undefined;
      if (id) {
        const worldId = (obj.userData.worldId as string) || meta.get(id)?.worldId || "overworld";
        // Active world only — stale shrine objects must not resolve in overworld.
        if (worldId !== activeWorld) return;
        const m = meta.get(id);
        list.push({
          targetId: id,
          worldId,
          object: obj,
          range: m?.range ?? 2.4,
          maxDy: m?.maxDy ?? 4,
        });
        return;
      }
      if (obj.userData?.pickOccluder) occluders.push(obj);
    });
    const citadel = scene.getObjectByName("citadel-occluder");
    if (citadel && activeWorld === "overworld") occluders.push(citadel);
    setPickables(list);
    setOccluders(occluders);
    return () => {
      setPickables([]);
      setOccluders([]);
    };
  }, [scene, activeWorld]);
  return null;
}

function GrassField({
  geo,
  material,
  count,
}: {
  geo: THREE.BufferGeometry;
  material: THREE.Material;
  count: number;
}) {
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const items = useMemo(() => {
    const list = scatterGrass({ count, originX: 16, originZ: 88, spanX: 110, spanZ: 90 });
    return list.map((it) => ({ ...it, s: it.s * 1.85 }));
  }, [count]);
  return <Instances geo={geo} material={material} items={items} dummy={dummy} count={items.length} />;
}

function PlankPool({ refs }: { refs: MutableRefObject<THREE.Mesh[]> }) {
  const meshes = useMemo(() => {
    const list = Array.from({ length: 4 }, () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.7), new THREE.MeshLambertMaterial({ color: "#c2a078" }));
      m.castShadow = true;
      m.visible = false;
      return m;
    });
    refs.current = list;
    return list;
  }, [refs]);
  return (
    <>
      {meshes.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
    </>
  );
}

function GrayboxView({ groupRef }: { groupRef: RefObject<THREE.Group | null> }) {
  const solids = useMemo(() => grayboxSolids(), []);
  return (
    <group ref={groupRef} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshLambertMaterial color="#8a8f86" />
      </mesh>
      {solids.map((s) =>
        s.kind === "cyl" ? (
          <mesh key={s.id} position={[s.x, s.y + s.h / 2, s.z]}>
            <cylinderGeometry args={[s.r ?? 1, s.r ?? 1, s.h, 12]} />
            <meshLambertMaterial color={s.standable ? "#d2c4a4" : "#6a7068"} />
          </mesh>
        ) : (
          <mesh key={s.id} position={[s.x, s.y + s.h / 2, s.z]} rotation={[0, s.yaw ?? 0, 0]}>
            <boxGeometry args={[s.w ?? 1, s.h, s.d ?? 1]} />
            <meshLambertMaterial color={s.climbable ? "#7a8a78" : s.standable ? "#d2c4a4" : "#5c6058"} />
          </mesh>
        ),
      )}
    </group>
  );
}

function SkyDome({ matRef }: { matRef: RefObject<THREE.ShaderMaterial | null> }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        uniforms: {
          topColor: { value: new THREE.Color("#8ec8e8") },
          botColor: { value: new THREE.Color("#d8e6c8") },
          sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
          night: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => {
    matRef.current = mat;
    return () => mat.dispose();
  }, [mat, matRef]);
  return (
    <mesh>
      <sphereGeometry args={[400, 16, 12]} />
      <primitive attach="material" object={mat} />
    </mesh>
  );
}

function Instances({
  geo,
  material,
  items,
  dummy,
  count,
}: {
  geo: THREE.BufferGeometry;
  material: THREE.Material;
  items: { x: number; y: number; z: number; s: number; rot: number }[];
  dummy: THREE.Object3D;
  count: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < count; i++) {
      const it = items[i];
      if (!it) continue;
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(0, it.rot, 0);
      dummy.scale.setScalar(it.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = count;
    mesh.frustumCulled = false;
  }, [count, dummy, items, material]);
  return (
    <instancedMesh
      ref={ref}
      args={[geo, undefined, Math.max(1, count)]}
      material={material}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}

function EnemyPool({ refs }: { refs: MutableRefObject<THREE.Group[]> }) {
  const groups = useMemo(() => {
    const list: THREE.Group[] = [];
    for (let i = 0; i < sim.enemies.length; i++) {
      const e = sim.enemies[i]!;
      const g = e.kind === "boss" ? createBoss() : e.kind === "sentinel" ? createSentinel() : createBramblekin();
      list.push(g);
    }
    refs.current = list;
    return list;
  }, [refs]);
  return (
    <>
      {groups.map((g, i) => (
        <primitive key={sim.enemies[i]?.id ?? i} object={g} />
      ))}
    </>
  );
}

function IcePool({ refs }: { refs: MutableRefObject<THREE.Group[]> }) {
  const groups = useMemo(() => {
    const list = Array.from({ length: 6 }, () => {
      const g = new THREE.Group();
      g.add(createIcePillar());
      g.visible = false;
      return g;
    });
    refs.current = list;
    return list;
  }, [refs]);
  return (
    <>
      {groups.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
    </>
  );
}

function MetalPool({ refs }: { refs: MutableRefObject<THREE.Mesh[]> }) {
  const meshes = useMemo(() => {
    const list = Array.from({ length: 6 }, () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.28, 2.2), mats.metal);
      m.castShadow = true;
      m.visible = false;
      return m;
    });
    refs.current = list;
    return list;
  }, [refs]);
  return (
    <>
      {meshes.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
    </>
  );
}

function WispPool({ refs }: { refs: MutableRefObject<THREE.Mesh[]> }) {
  const meshes = useMemo(() => {
    const list = WISPS.map(() => new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mats.glow));
    refs.current = list;
    return list;
  }, [refs]);
  return (
    <>
      {meshes.map((g, i) => (
        <primitive
          key={WISPS[i]!.id}
          object={g}
          userData={{ interactId: `wisp:${WISPS[i]!.id}`, worldId: "overworld" }}
        />
      ))}
    </>
  );
}

function PickupPool({ refs }: { refs: MutableRefObject<THREE.Mesh[]> }) {
  const meshes = useMemo(() => {
    const list = Array.from({ length: 24 }, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), new THREE.MeshLambertMaterial({ color: "#c45c4a" }));
      m.visible = false;
      return m;
    });
    refs.current = list;
    return list;
  }, [refs]);
  return (
    <>
      {meshes.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
    </>
  );
}

function ProjPool({ refs }: { refs: MutableRefObject<THREE.Mesh[]> }) {
  const meshes = useMemo(() => {
    const list = Array.from({ length: 12 }, () => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshLambertMaterial({ color: "#f0e0a0", emissive: "#c8a040" }),
      );
      m.visible = false;
      return m;
    });
    refs.current = list;
    return list;
  }, [refs]);
  return (
    <>
      {meshes.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
    </>
  );
}

function ShrineRooms({
  rooms,
  cracked,
  moveBlock,
}: {
  rooms: MutableRefObject<THREE.Group[]>;
  cracked: MutableRefObject<THREE.Mesh[]>;
  moveBlock: RefObject<THREE.Mesh | null>;
}) {
  const built = useMemo(() => {
    const list: THREE.Group[] = [];
    const cracks: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const o = shrineWorldOrigin(i);
      const g = new THREE.Group();
      g.position.set(o.x, o.y, o.z);
      const floorIn = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 9.2), mats.stone);
      floorIn.position.set(0, -0.2, 4.4);
      const floorAltar = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 7.2), mats.stone);
      floorAltar.position.set(0, -0.2, 23.2);
      const wallL = new THREE.Mesh(new THREE.BoxGeometry(SHRINE_ROOM.wallW, SHRINE_ROOM.wallH, SHRINE_ROOM.wallD), mats.stone);
      wallL.position.set(-SHRINE_ROOM.wallX, SHRINE_ROOM.wallH / 2, SHRINE_ROOM.wallZ);
      const wallR = wallL.clone();
      wallR.position.x = SHRINE_ROOM.wallX;
      const wallB = new THREE.Mesh(new THREE.BoxGeometry(20, SHRINE_ROOM.wallH, 0.5), mats.stone);
      wallB.position.set(0, SHRINE_ROOM.wallH / 2, SHRINE_ROOM.backZ);
      const wallF = new THREE.Mesh(new THREE.BoxGeometry(20, SHRINE_ROOM.wallH, 0.5), mats.stone);
      wallF.position.set(0, SHRINE_ROOM.wallH / 2, SHRINE_ROOM.frontZ);
      const altar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, SHRINE_ROOM.altarH, 6), mats.teal);
      altar.position.set(0, SHRINE_ROOM.altarH / 2, SHRINE_ROOM.altarZ);
      const shrineId = SHRINES[i]?.id ?? String(i);
      const shrineWorld = `shrine:${shrineId}`;
      altar.userData.interactId = `altar:${shrineId}`;
      altar.userData.worldId = shrineWorld;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), mats.glow);
      glow.position.set(0, 1.4, SHRINE_ROOM.altarZ);
      // Exterior exit pick surface (front of room).
      const exit = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.4), mats.teal);
      exit.position.set(0, 0.2, 1.2);
      exit.userData.interactId = `exit:${shrineId}`;
      exit.userData.worldId = shrineWorld;
      g.add(floorIn, floorAltar, wallL, wallR, wallB, wallF, altar, glow, exit);
      const puzzle = SHRINES[i]?.puzzle;
      // Sidewalks only where sim still has shrine-sidewalk solids (not still).
      if (shrineHasSidewalk(puzzle)) {
        const walkR = new THREE.Mesh(
          new THREE.BoxGeometry(SHRINE_SIDEWALK.w, SHRINE_SIDEWALK.h + 0.08, SHRINE_SIDEWALK.d),
          mats.stone,
        );
        walkR.position.set(SHRINE_SIDEWALK.x, SHRINE_SIDEWALK.y + 0.18, SHRINE_SIDEWALK.z);
        const walkL = walkR.clone();
        walkL.position.x = -SHRINE_SIDEWALK.x;
        g.add(walkR, walkL);
      }
      if (puzzle === "rime" || puzzle === "pull" || puzzle === "still") {
        const half = shrinePitHalfWidth(puzzle);
        const { z0, z1, depth } = shrinePitSpanZ(puzzle);
        const pitW = half * 2;
        const pitD = z1 - z0;
        const pitMidZ = (z0 + z1) * 0.5;
        const pit = new THREE.Mesh(
          new THREE.BoxGeometry(pitW, 0.2, pitD),
          new THREE.MeshLambertMaterial({
            color: puzzle === "rime" ? "#2a6e78" : "#1a1a1e",
            transparent: puzzle === "rime",
            opacity: puzzle === "rime" ? 0.7 : 1,
          }),
        );
        pit.position.set(0, -depth / 2, pitMidZ);
        g.add(pit);
        // Still: full-width pit — add a north floor strip the sidewalks used to cover.
        if (puzzle === "still") {
          const north = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 6.6), mats.stone);
          north.position.set(0, -0.2, z1 + 3.2);
          g.add(north);
        }
      }
      if (puzzle === "burst") {
        // World-space crack (not parented to g) — match BURST_WALL collision.
        const cr = new THREE.Mesh(new THREE.BoxGeometry(BURST_WALL.w, BURST_WALL.h, BURST_WALL.d), mats.cracked);
        cr.position.set(o.x, o.y + BURST_WALL.h / 2, o.z + BURST_WALL.z);
        cracks[i] = cr;
      }
      g.visible = false;
      list.push(g);
    }
    rooms.current = list;
    cracked.current = cracks;
    return { list, cracks };
  }, [cracked, rooms]);

  const block = useMemo(() => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(STILL_BLOCK.w, STILL_BLOCK.h, STILL_BLOCK.d), mats.stone);
    m.visible = false;
    return m;
  }, []);
  useEffect(() => {
    (moveBlock as MutableRefObject<THREE.Mesh | null>).current = block;
  }, [block, moveBlock]);

  return (
    <>
      {built.list.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
      {built.cracks.map((c, i) => (c ? <primitive key={`c${i}`} object={c} /> : null))}
      <primitive object={block} />
    </>
  );
}
