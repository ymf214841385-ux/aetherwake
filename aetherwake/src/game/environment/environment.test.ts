import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { ShaderChunk, ShaderLib } from "three";
import { WATER_LEVEL, WORLD_SIZE, TERRAIN_RES } from "../height.ts";
import {
  LIGHTING,
  QUALITY_TIERS,
  LOD_DISTANCES,
  ROCK_VARIANT_COUNT,
  createRockGeometries,
  createRockGeometry,
  createTerrainMaterials,
  createSplatTerrainMaterial,
  createPropMaterials,
  createWaterMaterial,
  createVegetationKit,
  createGrassClumpGeometry,
  scatterGrass,
  bucketByLod,
  resolveQualityTier,
  sunDirFromTimeOfDay,
  DAYTIME_TOD,
  applySplatShaderPatch,
  SPLAT_SHADER_NEEDLES,
  buildDisplacedTerrainGeometry,
  averageIndexedFaceNormalY,
  averageVertexNormalY,
} from "./index.ts";

describe("environment lighting + quality", () => {
  it("exposes the daytime lighting keys Scene needs", () => {
    for (const k of [
      "sunColor",
      "sunIntensity",
      "sunDir",
      "ambient",
      "hemiSky",
      "hemiGround",
      "fogColor",
      "fogNear",
      "fogFar",
      "exposure",
      "shadowMapSize",
    ] as const) {
      assert.ok(k in LIGHTING, k);
    }
    assert.ok(LIGHTING.sunDir.y > 0.6, "sun is high, daytime");
    assert.ok(LIGHTING.fogFar > LIGHTING.fogNear + 200, "fog does not hide mid-field");
    assert.equal(LIGHTING.fogNear, 100);
  });

  it("quality tiers scale grass, shadows, anisotropy", () => {
    assert.equal(QUALITY_TIERS.low.grassCount, 420);
    assert.equal(QUALITY_TIERS.mid.grassCount, 900);
    assert.equal(QUALITY_TIERS.high.grassCount, 1600);
    assert.ok(QUALITY_TIERS.low.shadowMapSize < QUALITY_TIERS.mid.shadowMapSize);
    assert.ok(QUALITY_TIERS.mid.shadowMapSize < QUALITY_TIERS.high.shadowMapSize);
    assert.equal(QUALITY_TIERS.low.terrainAnisotropy, 1);
    assert.equal(QUALITY_TIERS.high.terrainAnisotropy, 8);
    assert.equal(resolveQualityTier("high"), "high");
  });

  it("sunDirFromTimeOfDay matches Scene's day-cycle formula", () => {
    const d = sunDirFromTimeOfDay(DAYTIME_TOD);
    const ang = (DAYTIME_TOD - 0.25) * Math.PI * 2;
    const expected = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.25).normalize();
    assert.ok(Math.abs(d.x - expected.x) < 1e-6);
    assert.ok(Math.abs(d.y - expected.y) < 1e-6);
    assert.ok(d.y > 0.5);
  });
});

describe("environment materials", () => {
  it("terrain materials have distinct roughness and color", () => {
    const mats = createTerrainMaterials();
    assert.ok(mats.grass.roughness > mats.rock.roughness);
    assert.ok(mats.dirt.roughness > mats.grass.roughness);
    assert.ok(mats.wetShore.roughness < 0.4);
    assert.ok(mats.rock.metalness > mats.grass.metalness);
    assert.ok(mats.splat.vertexColors);
    assert.notEqual(mats.grass.color.getHex(), mats.dirt.color.getHex());
    assert.notEqual(mats.rock.color.getHex(), mats.wetShore.color.getHex());
  });

  it("water material carries ripple uniforms and matches WATER_LEVEL", () => {
    assert.equal(WATER_LEVEL, 3.35);
    const mat = createWaterMaterial();
    assert.ok(mat.userData.awWater.uTime);
    assert.ok(mat.transparent);
    assert.ok(mat.roughness < 0.4);
    assert.ok(mat.opacity > 0.7 && mat.opacity < 0.95);
  });
});

function axisExtents(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return {
    x: b.max.x - b.min.x,
    y: b.max.y - b.min.y,
    z: b.max.z - b.min.z,
    count: geo.attributes.position!.count,
  };
}

describe("environment rocks", () => {
  it("builds several unique non-spherical boulders", () => {
    const geos = createRockGeometries();
    assert.ok(geos.length >= 5);
    assert.equal(geos.length, ROCK_VARIANT_COUNT);
    const signatures = geos.map((g) => {
      const e = axisExtents(g);
      const max = Math.max(e.x, e.y, e.z);
      const min = Math.min(e.x, e.y, e.z);
      assert.ok(e.count > 12, "more than a cube/tetra");
      assert.ok(max / min > 1.22, "not a scaled sphere");
      assert.ok(g.attributes.uv, "has uvs");
      return `${e.count}:${e.x.toFixed(2)}:${e.y.toFixed(2)}:${e.z.toFixed(2)}`;
    });
    assert.equal(new Set(signatures).size, signatures.length);
    const low = axisExtents(createRockGeometry(0, "low"));
    const high = axisExtents(createRockGeometry(0, "high"));
    assert.ok(high.count > low.count);
  });
});

describe("environment vegetation", () => {
  it("builds pine vs broadleaf with LOD and grass clumps", () => {
    const kit = createVegetationKit();
    assert.ok(kit.broadleaf.length >= 2);
    assert.ok(kit.pine.length >= 2);
    const leaf = axisExtents(kit.broadleaf[0]!.crown.high);
    const pine = axisExtents(kit.pine[0]!.crown.high);
    assert.ok(leaf.count > 20);
    assert.ok(pine.count > 20);
    assert.notEqual(leaf.count, pine.count);
    const grassH = createGrassClumpGeometry("high");
    const grassL = createGrassClumpGeometry("low");
    assert.ok(grassH.attributes.position!.count > grassL.attributes.position!.count);
    assert.ok(grassH.attributes.position!.count > 24);
  });

  it("scatters grass above water around spawn", () => {
    const items = scatterGrass({ count: 200 });
    assert.ok(items.length > 40);
    for (const it of items) {
      assert.ok(it.y >= WATER_LEVEL + 0.6 - 1e-6);
      assert.ok(Math.abs(it.x) < WORLD_SIZE);
    }
  });
});

describe("environment lod + world constants", () => {
  it("buckets instances by camera distance", () => {
    const items = [
      { x: 0, y: 0, z: 0, s: 1, rot: 0 },
      { x: 30, y: 0, z: 0, s: 1, rot: 0 },
      { x: 80, y: 0, z: 0, s: 1, rot: 0 },
      { x: 400, y: 0, z: 0, s: 1, rot: 0 },
    ];
    const b = bucketByLod(items, new THREE.Vector3(), LOD_DISTANCES.tree);
    assert.ok(b.high.includes(0));
    assert.ok(b.mid.includes(1));
    assert.ok(b.low.includes(2));
    assert.ok(!b.high.includes(3) && !b.mid.includes(3) && !b.low.includes(3));
  });

  it("matches the live terrain size", () => {
    assert.equal(WORLD_SIZE, 384);
    assert.equal(TERRAIN_RES, 160);
  });
});

describe("prop materials", () => {
  it("shares standard materials suitable for instancing", () => {
    const p = createPropMaterials();
    assert.equal(p.leaf.side, THREE.DoubleSide);
    assert.ok(p.bark.roughness > 0.8);
    assert.ok(p.grass.userData.awGrass);
  });
});

describe("splat shader vs Three.js MeshStandardMaterial", () => {
  function physicalSource() {
    const phys = ShaderLib.physical;
    return {
      vertexShader: phys.vertexShader as string,
      fragmentShader: phys.fragmentShader as string,
    };
  }

  it("MeshStandardMaterial uses ShaderLib.physical whose includes match our needles", () => {
    const { vertexShader, fragmentShader } = physicalSource();
    assert.ok(vertexShader.includes(SPLAT_SHADER_NEEDLES.common), "vertex #include <common>");
    assert.ok(vertexShader.includes(SPLAT_SHADER_NEEDLES.worldposVertex), "worldpos_vertex");
    assert.ok(fragmentShader.includes(SPLAT_SHADER_NEEDLES.common), "fragment #include <common>");
    assert.ok(fragmentShader.includes(SPLAT_SHADER_NEEDLES.diffuseColor), "diffuseColor");
    assert.ok(fragmentShader.includes(SPLAT_SHADER_NEEDLES.colorFragment), "color_fragment");
    assert.ok(fragmentShader.includes(SPLAT_SHADER_NEEDLES.mapFragment), "map_fragment");
    assert.ok(fragmentShader.includes(SPLAT_SHADER_NEEDLES.roughnessmapFragment), "roughnessmap_fragment");
    const mapBeforeColor = fragmentShader.indexOf(SPLAT_SHADER_NEEDLES.mapFragment);
    const colorAt = fragmentShader.indexOf(SPLAT_SHADER_NEEDLES.colorFragment);
    const roughAt = fragmentShader.indexOf(SPLAT_SHADER_NEEDLES.roughnessmapFragment);
    assert.ok(mapBeforeColor >= 0 && mapBeforeColor < colorAt, "map_fragment before color_fragment");
    assert.ok(colorAt < roughAt, "color_fragment before roughnessmap_fragment");
  });

  it("color_pars_fragment declares vec4 vColor (the old vec3 assign was a compile error)", () => {
    const pars = ShaderChunk.color_pars_fragment as string;
    assert.match(pars, /varying vec4 vColor/);
    const colorFrag = ShaderChunk.color_fragment as string;
    assert.match(colorFrag, /diffuseColor \*= vColor/);
  });

  it("applySplatShaderPatch rewrites needles and uses vColor.rgb", () => {
    const src = physicalSource();
    const shader = {
      vertexShader: src.vertexShader,
      fragmentShader: src.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    applySplatShaderPatch(shader, { uWaterLevel: { value: WATER_LEVEL } });
    assert.ok(shader.vertexShader.includes("varying vec3 vAwWorldPos"));
    assert.ok(shader.vertexShader.includes("objectNormal"));
    assert.ok(shader.fragmentShader.includes("vColor.rgb"));
    assert.equal(shader.fragmentShader.includes("vec3 awVert = vColor;"), false);
    assert.equal(shader.fragmentShader.includes(SPLAT_SHADER_NEEDLES.mapFragment), false);
    assert.equal(shader.fragmentShader.includes(SPLAT_SHADER_NEEDLES.roughnessmapFragment), false);
    assert.ok(shader.fragmentShader.includes("float roughnessFactor = awRough"));
    assert.ok(shader.fragmentShader.includes("texture2D( uGrassMap"));
    assert.ok(shader.fragmentShader.includes("float awRough = roughness"));
    assert.ok("uWaterLevel" in shader.uniforms);
  });

  it("createSplatTerrainMaterial is opaque FrontSide with a patching onBeforeCompile", () => {
    const mat = createSplatTerrainMaterial();
    assert.equal(mat.side, THREE.FrontSide);
    assert.equal(mat.transparent, false);
    assert.equal(mat.depthWrite, true);
    assert.ok(mat.vertexColors);
    assert.ok(mat.map);
    const src = physicalSource();
    const shader = {
      vertexShader: src.vertexShader,
      fragmentShader: src.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    mat.onBeforeCompile(shader as never, null as never);
    assert.ok(shader.fragmentShader.includes("vColor.rgb"));
    assert.equal(shader.fragmentShader.includes("vec3 awVert = vColor;"), false);
  });

  it("throws if a needle is missing rather than silently compiling a broken program", () => {
    const shader = {
      vertexShader: "void main() {}",
      fragmentShader: "void main() {}",
      uniforms: {} as Record<string, { value: unknown }>,
    };
    assert.throws(() => applySplatShaderPatch(shader, {}), /aw splat: missing/);
  });
});

describe("terrain geometry winding after rotateX + height displace", () => {
  it("index winding averages +Y so FrontSide shows the ground", () => {
    const geo = buildDisplacedTerrainGeometry();
    const faceY = averageIndexedFaceNormalY(geo);
    const vertY = averageVertexNormalY(geo);
    assert.ok(faceY > 0.55, `face normal Y ${faceY} — winding would cull FrontSide if negative`);
    assert.ok(vertY > 0.55, `vertex normal Y ${vertY}`);
    assert.equal(geo.getAttribute("color")?.itemSize, 3);
    geo.dispose();
  });

  it("FrontSide raycast hits spawn and a mountain sample from +Y", () => {
    const geo = buildDisplacedTerrainGeometry();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    mesh.updateMatrixWorld(true);
    const samples: [number, number][] = [
      [16, 102],
      [10, 68],
      [0, 0],
      [48, -128],
      [-40, 88],
    ];
    for (const [x, z] of samples) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(mesh, false);
      assert.ok(hits.length > 0, `FrontSide miss at ${x},${z} — winding flipped or bounds empty`);
    }
    geo.dispose();
  });
});
