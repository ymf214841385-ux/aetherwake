import {
  CITADEL,
  FOREST,
  LAKE,
  MOUNTAIN,
  PLATEAU,
  WATER_LEVEL,
  WIND_RUIN,
  fbm,
  hash01,
  heightAt,
  normalAt,
} from "./height.ts";
import type { Solid } from "./physics.ts";

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

/**
 * Still-shrine moving slab. Pit is lz∈(10,16.5) |lx|<8.8 (full interior
 * span) so the old ±7.15 walkway cannot claim without 凝时. The old
 * extraSupport r=1.5 at y+0.9 sat above FOOT_SNAP and left a 1.5 m pit gap
 * at the lip, so freeze-and-walk never stood on the block. A standable
 * floor-height box with d=7 spans the pit in Z; w=3.2 is the timed lane.
 */
export const STILL_BLOCK = {
  w: 3.2,
  h: 0.4,
  d: 7.0,
  zOff: 13,
  xAmp: 5.4,
  omega: 0.9,
};

/** Shared shrine interior metrics — Scene meshes and sim solids must match. */
export const SHRINE_ROOM = {
  wallX: 9.6,
  wallW: 0.5,
  wallH: 8,
  wallZ: 13,
  wallD: 28,
  backZ: 26.4,
  frontZ: -0.4,
  altarZ: 23,
  altarR: 1,
  altarPadR: 2.15,
  altarH: 1.1,
};

export const SHRINE_SIDEWALK = {
  x: 7.15,
  w: 2.55,
  /** solid h in sim; visual box slightly thicker for readability */
  h: 0.34,
  y: -0.06,
  z: 14.2,
  d: 20.6,
};

export type ShrinePitKind = "rime" | "pull" | "still";

export function shrinePitHalfWidth(puzzle: ShrinePitKind) {
  if (puzzle === "rime") return 4.8;
  if (puzzle === "still") return 8.8;
  return 4.6;
}

export function shrinePitSpanZ(puzzle: ShrinePitKind): { z0: number; z1: number; depth: number } {
  if (puzzle === "rime") return { z0: 8, z1: 20.4, depth: 4.6 };
  return { z0: 10, z1: 16.5, depth: 4.4 };
}

/** Still pit is full interior — no continuous ±7.15 walkway bypass. */
export function shrineHasSidewalk(puzzle: string | undefined) {
  return puzzle !== "still";
}

export const BURST_WALL = {
  z: 12.4,
  w: 18.6,
  h: 6,
  d: 0.8,
};

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

/** Keep pad is ~1.5 m above the +Z courtyard. Walls that start on the pad float over the fight floor. */
export const CITADEL_WALL_H = 4.5;
export const CITADEL_COURTYARD_DZ = 7.2;
export const CITADEL_WALL_DROP = 2.6;
/** Review19 51264: boss walked under the west face at y≈3.6–6.3 — wall bottom must reach the low ground. */
export const CITADEL_WALL_FOOT_Y = 3.2;

export function citadelWallMetrics() {
  const courtyardY = heightAt(CITADEL_POI.x, CITADEL_POI.z + CITADEL_COURTYARD_DZ);
  // Old bottom was courtyard-2.6 ≈ 8; terrain west of the face drops to ~5.
  const y = Math.min(CITADEL_WALL_FOOT_Y, Math.min(CITADEL_POI.y, courtyardY) - CITADEL_WALL_DROP);
  const top = CITADEL_POI.y + CITADEL_WALL_H;
  const h = top - y;
  return { y, h, top, localY: y + h * 0.5 - CITADEL_POI.y };
}

export const SAGE: Poi = {
  id: "sage",
  name: "守塔人",
  x: 4,
  z: 114,
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
export const TOWER_LEDGE_COLUMNS = 4;
export const TOWER_LEDGE_ROWS = 3;
export const TOWER_LEDGE_COUNT = TOWER_LEDGE_COLUMNS * TOWER_LEDGE_ROWS;
export const TOWER_LEDGE_RADIUS = 5.9;
export const TOWER_LEDGE_W = 3.45;
export const TOWER_LEDGE_D = 2.45;
export const TOWER_LEDGE_H = 0.42;
export const TOWER_DOCK_RADIUS = 5.7;
export const TOWER_RING_W = 4.4;
export const TOWER_RING_D = 2.15;

export function towerLedgeLocalY0(baseY: number) {
  return Math.max(2.1, WATER_LEVEL + 0.55 - baseY);
}

export function towerNeedsDock(tw: { x: number; y: number; z: number }) {
  if (tw.y < WATER_LEVEL + 0.9) return true;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (heightAt(tw.x + Math.cos(a) * 8, tw.z + Math.sin(a) * 8) < WATER_LEVEL + 0.35) return true;
  }
  return false;
}

/** Wet towers must be grabable from the lake. Shaft collision starts at pad y, which sits ~4 m above WATER_LEVEL at mere. */
export function towerShaftBaseY(tw: { x: number; y: number; z: number }) {
  if (!towerNeedsDock(tw)) return tw.y;
  return Math.min(tw.y, WATER_LEVEL - 0.6);
}

export type WindPlank = {
  id: string;
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeY: number;
  homeZ: number;
  yaw: number;
};

export const UPDRAFTS = [
  { id: "valley-lift", x: 20, z: 86, r: 4.5, updraft: 7.5 },
  { id: "ruin-lift", x: 32, z: 70, r: 3.6, updraft: 6.2 },
  { id: "mere-lift", x: -96, z: 14, r: 5.5, updraft: 5.5 },
];

export function isTowerRest(id: string) {
  return id.includes("-ledge-") || id.includes("-spiral-") || id.includes("-cap");
}

export type TowerLedgePlacement = {
  kind: "ledge" | "ring";
  index: number;
  a: number;
  y: number;
  w: number;
  d: number;
};

/** 4 columns × 3 rest rows so a straight climb meets a balcony; ring fillers at the same Y. */
export function towerLedgePlacements(baseY: number): TowerLedgePlacement[] {
  const y0 = towerLedgeLocalY0(baseY);
  const yTop = TOWER_HEIGHT - 1.55;
  const ySpan = Math.max(6, yTop - y0);
  const out: TowerLedgePlacement[] = [];
  let li = 0;
  let ri = 0;
  for (let row = 0; row < TOWER_LEDGE_ROWS; row++) {
    const y = y0 + (row / Math.max(1, TOWER_LEDGE_ROWS - 1)) * ySpan;
    for (let col = 0; col < TOWER_LEDGE_COLUMNS; col++) {
      const a = (col / TOWER_LEDGE_COLUMNS) * Math.PI * 2 + 0.18;
      out.push({ kind: "ledge", index: li++, a, y, w: TOWER_LEDGE_W, d: TOWER_LEDGE_D });
      const am = a + Math.PI / TOWER_LEDGE_COLUMNS;
      out.push({ kind: "ring", index: ri++, a: am, y, w: TOWER_RING_W, d: TOWER_RING_D });
    }
  }
  return out;
}

export function towerSolids(tw: { id: string; x: number; y: number; z: number }): Solid[] {
  const shaftBase = towerShaftBaseY(tw);
  const shaftTop = tw.y + TOWER_HEIGHT - 0.45;
  const solids: Solid[] = [
    {
      id: `${tw.id}-shaft`,
      kind: "cyl",
      x: tw.x,
      y: shaftBase,
      z: tw.z,
      r: TOWER_RADIUS,
      h: Math.max(4, shaftTop - shaftBase),
      climbable: true,
      standable: false,
    },
    {
      id: `${tw.id}-cap`,
      kind: "cyl",
      x: tw.x,
      y: tw.y + TOWER_HEIGHT - 0.4,
      z: tw.z,
      r: 3.2,
      h: 0.45,
      standable: true,
    },
  ];
  for (const p of towerLedgePlacements(tw.y)) {
    const id = p.kind === "ledge" ? `${tw.id}-ledge-${p.index}` : `${tw.id}-spiral-${p.index}`;
    solids.push({
      id,
      kind: "box",
      x: tw.x + Math.cos(p.a) * TOWER_LEDGE_RADIUS,
      y: tw.y + p.y - TOWER_LEDGE_H * 0.5,
      z: tw.z + Math.sin(p.a) * TOWER_LEDGE_RADIUS,
      w: p.w,
      h: TOWER_LEDGE_H,
      d: p.d,
      yaw: -p.a,
      standable: true,
    });
  }
  if (towerNeedsDock(tw)) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      solids.push({
        id: `${tw.id}-dock-${i}`,
        kind: "box",
        x: tw.x + Math.cos(a) * TOWER_DOCK_RADIUS,
        y: WATER_LEVEL - 0.14,
        z: tw.z + Math.sin(a) * TOWER_DOCK_RADIUS,
        w: 2.6,
        h: 0.34,
        d: 2.1,
        yaw: -a,
        standable: true,
      });
    }
  }
  return solids;
}

export function landmarkSolids(): Solid[] {
  const list: Solid[] = [];
  for (const tw of TOWERS) list.push(...towerSolids(tw));
  for (const s of SHRINES) {
    // Hut is a blocker, not a floor: walking into a standable 2.8 m box made
    // the explorer climb/launch off the roof instead of 叩响 at the door.
    list.push({
      id: `${s.id}-body`,
      kind: "box",
      x: s.x,
      y: s.y,
      z: s.z,
      w: 4.4,
      h: 2.8,
      d: 4.4,
      climbable: false,
      standable: false,
    });
    list.push({
      id: `${s.id}-apron`,
      kind: "cyl",
      x: s.x,
      y: s.y - 0.06,
      z: s.z,
      r: 5.5,
      h: 0.22,
      standable: true,
    });
  }
  list.push({
    id: "citadel-keep",
    kind: "box",
    x: CITADEL_POI.x,
    y: CITADEL_POI.y,
    z: CITADEL_POI.z,
    w: 10,
    h: 8,
    d: 10,
    climbable: true,
    standable: true,
  });
  const wall = citadelWallMetrics();
  for (const [dx, dz] of [
    [0, -11],
    [11, 0],
    [-11, 0],
  ] as const) {
    list.push({
      id: `citadel-wall-${dx}-${dz}`,
      kind: "box",
      x: CITADEL_POI.x + dx,
      y: wall.y,
      z: CITADEL_POI.z + dz,
      w: dx === 0 ? 22 : 1.4,
      h: wall.h,
      d: dz === 0 ? 22 : 1.4,
      standable: false,
      climbable: true,
    });
  }
  // Visual gate is at local z=+11. Collision must leave that opening; a closed
  // 22 m bar made "挑战空王" a wall hug even after the seal opened.
  const gateGap = 4.6;
  const wing = (22 - gateGap) / 2;
  for (const side of [-1, 1]) {
    list.push({
      id: `citadel-wall-0-11-${side < 0 ? "w" : "e"}`,
      kind: "box",
      x: CITADEL_POI.x + side * (gateGap / 2 + wing / 2),
      y: wall.y,
      z: CITADEL_POI.z + 11,
      w: wing,
      h: wall.h,
      d: 1.4,
      standable: false,
      climbable: true,
    });
  }
  list.push({
    id: "ruin-deck-a",
    kind: "box",
    x: WIND_RUIN.x - 3.2,
    y: heightAt(WIND_RUIN.x, WIND_RUIN.z) + 0.1,
    z: WIND_RUIN.z,
    w: 3.2,
    h: 0.35,
    d: 2.4,
    standable: true,
  });
  const ruinY = heightAt(WIND_RUIN.x, WIND_RUIN.z);
  list.push({
    id: "ruin-side",
    kind: "box",
    x: WIND_RUIN.x + 6.4,
    y: ruinY + 4.2,
    z: WIND_RUIN.z - 3.2,
    w: 3.4,
    h: 0.35,
    d: 3.4,
    standable: true,
    climbable: true,
  });
  list.push({
    id: "ruin-deck-b",
    kind: "box",
    x: WIND_RUIN.x + 3.6,
    y: ruinY + 0.1,
    z: WIND_RUIN.z + 0.4,
    w: 3.2,
    h: 0.35,
    d: 2.4,
    standable: true,
  });
  return list;
}

export function makeWindPlanks(): WindPlank[] {
  const y = heightAt(WIND_RUIN.x, WIND_RUIN.z) + 0.4;
  return [
    {
      id: "plank-a",
      x: WIND_RUIN.x - 0.9,
      y,
      z: WIND_RUIN.z + 6.2,
      homeX: WIND_RUIN.x - 0.9,
      homeY: y,
      homeZ: WIND_RUIN.z + 6.2,
      yaw: 0.2,
    },
    {
      id: "plank-b",
      x: WIND_RUIN.x + 1.0,
      y,
      z: WIND_RUIN.z + 6.8,
      homeX: WIND_RUIN.x + 1.0,
      homeY: y,
      homeZ: WIND_RUIN.z + 6.8,
      yaw: -0.4,
    },
  ];
}

export const CONTENT = {
  towers: ["dawn", "mere", "crown"],
  shrines: ["rime", "burst", "pull", "still"],
  camps: ["camp-a", "camp-b", "camp-c"],
  wisps: ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"],
  arts: ["wind", "burst", "rime", "pull", "still"],
  citadel: "citadel",
  ruin: "wind-ruin",
} as const;

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
  const crown = TOWERS.find((t) => t.id === "crown");
  if (crown) {
    const fx = crown.x + 9.2;
    const fz = crown.z + 11.5;
    FIRES.push({
      id: "fire-crown",
      name: "雪线篝火",
      x: fx,
      z: fz,
      y: ground(fx, fz),
      kind: "fire",
    });
  }
}

function clearing(x: number, z: number) {
  if (Math.hypot(x - 16, z - 102) < 9) return true;
  if (Math.hypot(x - WIND_RUIN.x, z - WIND_RUIN.z) < 8) return true;
  for (const t of TOWERS) if (Math.hypot(x - t.x, z - t.z) < 8) return true;
  for (const s of SHRINES) if (Math.hypot(x - s.x, z - s.z) < 6) return true;
  for (const c of CAMPS) if (Math.hypot(x - c.x, z - c.z) < 7) return true;
  if (Math.hypot(x - CITADEL.x, z - CITADEL.z) < 16) return true;
  return false;
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
    if (clearing(x, z)) continue;
    if (h > 36 && md < 90 && r > 0.45) {
      PINES.push({
        x,
        y: h,
        z,
        s: 2.4 + r * 2.2,
        rot: r * 6.2,
        kind: 2,
      });
      continue;
    }
    const forestChance = fd < 72 ? 0.32 : pd < 55 ? 0.14 : 0.06;
    if (h < 38 && r < forestChance) {
      TREES.push({
        x,
        y: h,
        z,
        s: 2.1 + hash01(i, 21) * 2.4,
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
  const nearSpawn: [number, number][] = [
    [8, 84],
    [24, 82],
    [4, 92],
    [28, 100],
    [-8, 88],
    [20, 108],
    [-2, 78],
  ];
  for (const [x, z] of nearSpawn) {
    const h = heightAt(x, z);
    if (h < WATER_LEVEL + 1.4) continue;
    TREES.push({ x, y: h, z, s: 3.4, rot: hash01(x + 3, z + 9) * 6, kind: 0 });
  }
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
