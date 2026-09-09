import {
  CITADEL,
  FOREST,
  LAKE,
  MOUNTAIN,
  PLATEAU,
  WATER_LEVEL,
  fbm,
  hash01,
  heightAt,
  normalAt,
} from "./height";

export type Prop = {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  kind: number;
};

export type Poi = {
  id: string;
  name: string;
  x: number;
  z: number;
  y: number;
  kind: "tower" | "shrine" | "camp" | "citadel" | "wisp" | "fire" | "chest" | "sage";
  puzzle?: "rime" | "burst" | "pull" | "still";
  hint?: string;
};

function ground(x: number, z: number) {
  return heightAt(x, z);
}

export const TOWERS: Poi[] = [
  {
    id: "dawn",
    name: "晨光塔",
    x: 10,
    z: 68,
    y: 0,
    kind: "tower",
  },
  {
    id: "mere",
    name: "镜湖塔",
    x: -108,
    z: 8,
    y: 0,
    kind: "tower",
  },
  {
    id: "crown",
    name: "雪冠塔",
    x: 48,
    z: -128,
    y: 0,
    kind: "tower",
  },
];

export const SHRINES: Poi[] = [
  {
    id: "rime",
    name: "霜息祠",
    x: -72,
    z: 36,
    y: 0,
    kind: "shrine",
    puzzle: "rime",
    hint: "在水面唤出霜柱，踏过去",
  },
  {
    id: "burst",
    name: "爆鸣祠",
    x: 118,
    z: 28,
    y: 0,
    kind: "shrine",
    puzzle: "burst",
    hint: "用爆鸣打碎裂纹岩壁",
  },
  {
    id: "pull",
    name: "牵引祠",
    x: 36,
    z: 8,
    y: 0,
    kind: "shrine",
    puzzle: "pull",
    hint: "牵引金属板，铺成桥梁",
  },
  {
    id: "still",
    name: "凝时祠",
    x: 14,
    z: -78,
    y: 0,
    kind: "shrine",
    puzzle: "still",
    hint: "冻结移动的石块，借它过桥",
  },
];

export const CAMPS: Poi[] = [
  { id: "camp-a", name: "荆棘营地", x: 42, z: 52, y: 0, kind: "camp" },
  { id: "camp-b", name: "林缘营地", x: 88, z: -8, y: 0, kind: "camp" },
  { id: "camp-c", name: "残堡前哨", x: -18, z: 16, y: 0, kind: "camp" },
];

export const WISPS: Poi[] = [
  { id: "w1", name: "风之种", x: 28, z: 110, y: 0, kind: "wisp" },
  { id: "w2", name: "风之种", x: -40, z: 88, y: 0, kind: "wisp" },
  { id: "w3", name: "风之种", x: -96, z: 48, y: 0, kind: "wisp" },
  { id: "w4", name: "风之种", x: 128, z: 8, y: 0, kind: "wisp" },
  { id: "w5", name: "风之种", x: 70, z: -48, y: 0, kind: "wisp" },
  { id: "w6", name: "风之种", x: -20, z: -50, y: 0, kind: "wisp" },
  { id: "w7", name: "风之种", x: 8, z: -140, y: 0, kind: "wisp" },
  { id: "w8", name: "风之种", x: -60, z: -20, y: 0, kind: "wisp" },
];

export const CITADEL_POI: Poi = {
  id: "citadel",
  name: "残堡",
  x: CITADEL.x,
  z: CITADEL.z,
  y: 0,
  kind: "citadel",
};

export const SAGE: Poi = {
  id: "sage",
  name: "守塔人",
  x: 14,
  z: 104,
  y: 0,
  kind: "sage",
};

export const FIRES: Poi[] = [];
export const CHESTS: Poi[] = [];

export const TREES: Prop[] = [];
export const ROCKS: Prop[] = [];
export const PINES: Prop[] = [];

export const TOWER_RADIUS = 4.2;
export const TOWER_HEIGHT = 38;

function settlePois() {
  for (const list of [TOWERS, SHRINES, CAMPS, WISPS, FIRES, CHESTS]) {
    for (const p of list) {
      p.y = ground(p.x, p.z);
    }
  }
  CITADEL_POI.y = ground(CITADEL_POI.x, CITADEL_POI.z);
  SAGE.y = ground(SAGE.x, SAGE.z);
  for (const c of CAMPS) {
    FIRES.push({
      id: `fire-${c.id}`,
      name: "篝火",
      x: c.x + 1.6,
      z: c.z - 1.2,
      y: ground(c.x + 1.6, c.z - 1.2),
      kind: "fire",
    });
    CHESTS.push({
      id: `chest-${c.id}`,
      name: "木箱",
      x: c.x - 2.4,
      z: c.z + 1.8,
      y: ground(c.x - 2.4, c.z + 1.8),
      kind: "chest",
    });
  }
  CHESTS.push({
    id: "chest-start",
    name: "石匣",
    x: 20,
    z: 108,
    y: ground(20, 108),
    kind: "chest",
  });
}

function scatter() {
  TREES.length = 0;
  ROCKS.length = 0;
  PINES.length = 0;
  for (let i = 0; i < 2200; i++) {
    const x = (hash01(i, 2) - 0.5) * 360;
    const z = (hash01(i, 9) - 0.5) * 360;
    const h = heightAt(x, z);
    const n = normalAt(x, z);
    if (h < WATER_LEVEL + 1.4 || n.y < 0.72) continue;
    const pd = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
    const fd = Math.hypot(x - FOREST.x, z - FOREST.z);
    const md = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
    const r = hash01(i, 17);
    if (h > 44 && md < 90 && r > 0.45) {
      PINES.push({
        x,
        y: h,
        z,
        s: 0.8 + r * 0.7,
        rot: r * 6.2,
        kind: 2,
      });
      continue;
    }
    const forestChance = fd < 72 ? 0.22 : pd < 50 ? 0.04 : 0.08;
    if (h < 38 && r < forestChance) {
      TREES.push({
        x,
        y: h,
        z,
        s: 0.75 + hash01(i, 21) * 0.9,
        rot: r * 6.2,
        kind: fd < 72 ? 0 : 1,
      });
    } else if (r > 0.93 && h < 42) {
      ROCKS.push({
        x,
        y: h,
        z,
        s: 0.5 + hash01(i, 5) * 1.4,
        rot: r * 6,
        kind: 0,
      });
    }
  }
}

let ready = false;
export function initWorld() {
  if (ready) return;
  ready = true;
  settlePois();
  scatter();
}

export function shrineWorldOrigin(index: number) {
  return { x: 220 + index * 48, y: 520, z: 0 };
}

export const MATERIALS = {
  apple: { id: "apple", name: "野苹果", raw: true },
  pepper: { id: "pepper", name: "火棘椒", raw: true },
  berry: { id: "berry", name: "寒莓", raw: true },
  meat: { id: "meat", name: "兽肉", raw: true },
  ore: { id: "ore", name: "琥珀矿", raw: false },
};

export { PLATEAU, FOREST, LAKE, MOUNTAIN, CITADEL, fbm };
