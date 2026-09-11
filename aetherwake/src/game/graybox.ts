import type { Solid } from "./physics.ts";

export const GRAYBOX_GROUND = (x: number, z: number) => {
  if (x > 6 && x < 18 && z > -4 && z < 10) return (x - 6) * 0.35;
  if (x > 22 && x < 28 && z > 0 && z < 8) {
    const step = Math.floor((x - 22) / 1.2);
    return step * 0.45;
  }
  if (x > -18 && x < -8 && z > -8 && z < 2) return -1.6;
  return 0;
};

export function grayboxSolids(): Solid[] {
  return [
    { id: "gb-wall", kind: "box", x: 0, y: 0, z: -14, w: 10, h: 9, d: 1.1, climbable: true, standable: false },
    { id: "gb-ledge1", kind: "box", x: 2.2, y: 2.6, z: -13.2, w: 1.8, h: 0.28, d: 1.2, standable: true },
    { id: "gb-ledge2", kind: "box", x: -2.1, y: 5.2, z: -13.2, w: 1.8, h: 0.28, d: 1.2, standable: true },
    { id: "gb-top", kind: "box", x: 0, y: 8.6, z: -13.4, w: 4.2, h: 0.3, d: 2.4, standable: true },
    { id: "gb-ceil", kind: "box", x: 14, y: 1.55, z: 16, w: 4, h: 0.3, d: 4, standable: false },
    { id: "gb-narrow-l", kind: "box", x: -12.2, y: 0, z: 12, w: 1.2, h: 2.4, d: 8, standable: false },
    { id: "gb-narrow-r", kind: "box", x: -9.4, y: 0, z: 12, w: 1.2, h: 2.4, d: 8, standable: false },
    { id: "gb-plat", kind: "box", x: 8, y: 2.2, z: -6, w: 3.2, h: 0.3, d: 3.2, standable: true },
    { id: "gb-crate", kind: "box", x: -4, y: 0, z: 4, w: 1.2, h: 1.1, d: 1.2, standable: true },
    { id: "gb-move", kind: "box", x: 4, y: 0.1, z: 14, w: 2.4, h: 0.35, d: 1.6, standable: true },
  ];
}

export const GRAYBOX_RESET = { x: 0, y: 0.1, z: 6 };
export const GRAYBOX_WATER = { x: -13, z: -3, r: 5, level: -1.6 };
