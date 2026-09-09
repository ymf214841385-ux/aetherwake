import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
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
  createWanderer,
  mats,
} from "./figures";
import { WATER_LEVEL, WORLD_SIZE, colorAt, heightAt } from "./height";
import { sampleActions } from "./input";
import { sim } from "./sim";
import {
  CAMPS,
  CITADEL_POI,
  CHESTS,
  FIRES,
  PINES,
  ROCKS,
  SAGE,
  SHRINES,
  TOWERS,
  TREES,
  WISPS,
  shrineWorldOrigin,
} from "./world";

function buildTerrain() {
  const res = 108;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const c = colorAt(x, z, y);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
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
  const { camera, scene } = useThree();
  const wanderer = useMemo(() => createWanderer(), []);
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
  const acc = useRef(0);
  const fogRef = useRef<THREE.FogExp2 | null>(null);
  const shrineRooms = useRef<THREE.Group[]>([]);
  const cracked = useRef<THREE.Mesh[]>([]);
  const moveBlock = useRef<THREE.Mesh>(null);
  const bombObj = useMemo(() => createBomb(), []);
  const treeDummy = useMemo(() => new THREE.Object3D(), []);
  const sunDir = useMemo(() => new THREE.Vector3(), []);
  const topCol = useMemo(() => new THREE.Color(), []);
  const botCol = useMemo(() => new THREE.Color(), []);

  const landmarks = useMemo(
    () => ({
      towers: TOWERS.map((t) => ({ t, obj: createTower() })),
      shrines: SHRINES.map((s) => ({ s, obj: createShrine() })),
      camps: CAMPS.map((c) => ({ c, obj: createCamp() })),
      citadel: createCitadel(),
      wake: createAwakening(),
      sage: createSage(),
    }),
    [],
  );

  useEffect(() => {
    const f = new THREE.FogExp2("#87a0b4", 0.0065);
    scene.fog = f;
    fogRef.current = f;
    camera.near = 0.12;
    camera.far = 520;
    camera.updateProjectionMatrix();
    const light = sun.current;
    if (light) scene.add(light.target);
    return () => {
      terrain.dispose();
      if (light) scene.remove(light.target);
    };
  }, [camera, scene, terrain]);

  const trees = useMemo(() => {
    const trunk = new THREE.CylinderGeometry(0.14, 0.2, 1.7, 5);
    trunk.translate(0, 0.85, 0);
    const leaf = new THREE.SphereGeometry(1.05, 6, 5);
    leaf.translate(0, 2.1, 0);
    return { trunk, leaf };
  }, []);
  const pineGeo = useMemo(() => {
    const t = new THREE.CylinderGeometry(0.1, 0.16, 1.4, 5);
    t.translate(0, 0.7, 0);
    const c = new THREE.ConeGeometry(0.85, 2.6, 6);
    c.translate(0, 2.2, 0);
    return { t, c };
  }, []);
  const rockGeo = useMemo(() => new THREE.DodecahedronGeometry(0.7, 0), []);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    acc.current += d;
    const fixed = 1 / 60;
    const actions = sampleActions();
    let first = true;
    while (acc.current >= fixed) {
      sim.step(fixed, actions);
      acc.current -= fixed;
      if (first) {
        actions.lookX = 0;
        actions.lookY = 0;
        actions.jump = false;
        actions.attack = false;
        actions.interact = false;
        actions.art = false;
        actions.pause = false;
        actions.map = false;
        actions.bag = false;
        first = false;
      }
    }
    const p = sim.player;
    wanderer.root.position.set(p.x, p.y, p.z);
    wanderer.root.rotation.y = p.yaw;
    const moving = Math.hypot(p.vx, p.vz) > 0.4;
    const st = p.gliding
      ? "glide"
      : p.climbing
        ? "climb"
        : p.attackT > 0
          ? "attack"
          : p.aiming
            ? "bow"
            : p.swimming
              ? "swim"
              : moving
                ? Math.hypot(p.vx, p.vz) > 8
                  ? "run"
                  : "walk"
                : "idle";
    animateWanderer(wanderer, sim.t, st, p.attackT);

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
      const up = Math.max(0, sunDir.y);
      sun.current.intensity = 0.35 + up * 1.7;
      sun.current.color.set(day > 0.7 || day < 0.15 ? "#6a7cb0" : "#fff1d0");
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
        topCol.set("#8ec8e8");
        botCol.set("#d8e6c8");
      }
      skyMat.current.uniforms.topColor!.value.copy(topCol);
      skyMat.current.uniforms.botColor!.value.copy(botCol);
      skyMat.current.uniforms.sunDir!.value.copy(sunDir);
      skyMat.current.uniforms.night!.value = night;
    }
    if (fogRef.current) {
      fogRef.current.color.set(night > 0.5 ? "#121820" : sim.raining ? "#6a7a80" : "#9eb4a8");
      fogRef.current.density = sim.raining ? 0.011 : 0.0062;
    }
    if (water.current) {
      water.current.position.y = WATER_LEVEL + Math.sin(sim.t * 0.6) * 0.04;
    }

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
    if (moveBlock.current) {
      const inStill = sim.shrine !== null && SHRINES[sim.shrine]?.puzzle === "still";
      moveBlock.current.visible = inStill;
      if (inStill && sim.shrine !== null) {
        moveBlock.current.position.set(sim.moveBlock.x, shrineWorldOrigin(sim.shrine).y + 0.7, sim.moveBlock.z);
      }
    }
  });

  return (
    <>
      <mesh geometry={terrain} receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]}>
        <planeGeometry args={[WORLD_SIZE * 1.4, WORLD_SIZE * 1.4, 1, 1]} />
        <meshLambertMaterial color="#2a6e78" transparent opacity={0.72} />
      </mesh>
      <hemisphereLight args={["#c8e4ff", "#3a4a30", 0.7]} />
      <directionalLight
        ref={sun}
        castShadow
        intensity={1.4}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={2}
        shadow-camera-far={90}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
      />
      <primitive object={wanderer.root} />
      <SkyDome matRef={skyMat} />
      <Instances geo={trees.trunk} color="#5a3a22" items={TREES} dummy={treeDummy} count={TREES.length} />
      <Instances geo={trees.leaf} color="#2d5a32" items={TREES} dummy={treeDummy} count={TREES.length} />
      <Instances geo={pineGeo.t} color="#4a3220" items={PINES} dummy={treeDummy} count={PINES.length} />
      <Instances geo={pineGeo.c} color="#1f4630" items={PINES} dummy={treeDummy} count={PINES.length} />
      <Instances geo={rockGeo} color="#6b6560" items={ROCKS} dummy={treeDummy} count={ROCKS.length} />
      {landmarks.towers.map(({ t, obj }) => (
        <primitive key={t.id} object={obj} position={[t.x, t.y, t.z]} />
      ))}
      {landmarks.shrines.map(({ s, obj }) => (
        <primitive key={s.id} object={obj} position={[s.x, s.y, s.z]} />
      ))}
      {landmarks.camps.map(({ c, obj }) => (
        <primitive key={c.id} object={obj} position={[c.x, c.y, c.z]} />
      ))}
      <primitive object={landmarks.citadel} position={[CITADEL_POI.x, CITADEL_POI.y, CITADEL_POI.z]} />
      <primitive object={landmarks.wake} position={[16, heightAt(16, 102), 102]} />
      <primitive object={landmarks.sage} position={[SAGE.x, SAGE.y, SAGE.z]} />
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
        <pointLight key={f.id} position={[f.x, f.y + 0.8, f.z]} color="#ff8844" intensity={2.4} distance={8} />
      ))}
      {CHESTS.map((c) => (
        <mesh key={c.id} position={[c.x, c.y + 0.35, c.z]} castShadow>
          <boxGeometry args={[0.7, 0.5, 0.5]} />
          <meshLambertMaterial color="#6b4a28" />
        </mesh>
      ))}
      <ShrineRooms rooms={shrineRooms} cracked={cracked} moveBlock={moveBlock} />
    </>
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
  color,
  items,
  dummy,
  count,
}: {
  geo: THREE.BufferGeometry;
  color: string;
  items: { x: number; y: number; z: number; s: number; rot: number }[];
  dummy: THREE.Object3D;
  count: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
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
  }, [count, dummy, items]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, Math.max(1, count)]} castShadow receiveShadow>
      <meshLambertMaterial color={color} />
    </instancedMesh>
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
        <primitive key={WISPS[i]!.id} object={g} />
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
      const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 28), mats.stone);
      floor.position.set(0, -0.2, 13);
      const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 28), mats.stone);
      wallL.position.set(-9.6, 4, 13);
      const wallR = wallL.clone();
      wallR.position.x = 9.6;
      const wallB = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 0.5), mats.stone);
      wallB.position.set(0, 4, 26.4);
      const wallF = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 0.5), mats.stone);
      wallF.position.set(0, 4, -0.4);
      const altar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 1.1, 6), mats.teal);
      altar.position.set(0, 0.55, 23);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), mats.glow);
      glow.position.set(0, 1.4, 23);
      g.add(floor, wallL, wallR, wallB, wallF, altar, glow);
      const puzzle = SHRINES[i]?.puzzle;
      if (puzzle === "rime") {
        const pit = new THREE.Mesh(
          new THREE.BoxGeometry(12, 0.2, 12),
          new THREE.MeshLambertMaterial({ color: "#2a6e78", transparent: true, opacity: 0.7 }),
        );
        pit.position.set(0, -2.2, 14);
        g.add(pit);
      }
      if (puzzle === "burst") {
        const cr = new THREE.Mesh(new THREE.BoxGeometry(9, 6, 0.8), mats.cracked);
        cr.position.set(o.x, o.y + 3, o.z + 12.4);
        cracks[i] = cr;
      }
      if (puzzle === "pull" || puzzle === "still") {
        const pit = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 6), new THREE.MeshLambertMaterial({ color: "#1a1a1e" }));
        pit.position.set(0, -2, 13);
        g.add(pit);
      }
      g.visible = false;
      list.push(g);
    }
    rooms.current = list;
    cracked.current = cracks;
    return { list, cracks };
  }, [cracked, rooms]);

  const block = useMemo(() => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.4), mats.stone);
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
