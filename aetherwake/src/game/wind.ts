export type WindSample = {
  x: number;
  y: number;
  z: number;
  strength: number;
  updraft: number;
};

export type WindZone = {
  id: string;
  x: number;
  z: number;
  r: number;
  dirX: number;
  dirZ: number;
  strength: number;
  updraft: number;
};

export type Gust = {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  radius: number;
  strength: number;
  t: number;
  max: number;
};

export type WindWorld = {
  baseX: number;
  baseZ: number;
  baseStr: number;
  zones: WindZone[];
  gust: Gust | null;
};

export function createWindWorld(): WindWorld {
  return {
    baseX: 0.55,
    baseZ: 0.22,
    baseStr: 0.35,
    zones: [],
    gust: null,
  };
}

export function sampleWind(world: WindWorld, x: number, y: number, z: number, time: number): WindSample {
  const gustN = 0.08 * Math.sin(time * 0.7 + x * 0.03 + z * 0.02);
  let wx = world.baseX * (world.baseStr + gustN);
  let wz = world.baseZ * (world.baseStr + gustN);
  let wy = 0;
  let str = Math.hypot(wx, wz);
  for (const zone of world.zones) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d > zone.r) continue;
    const k = 1 - d / zone.r;
    wx += zone.dirX * zone.strength * k;
    wz += zone.dirZ * zone.strength * k;
    wy += zone.updraft * k;
  }
  if (world.gust) {
    const g = world.gust;
    const dx = x - g.ox;
    const dy = y - g.oy;
    const dz = z - g.oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < g.radius) {
      const along = (dx * g.dx + dy * g.dy + dz * g.dz) / (Math.hypot(g.dx, g.dy, g.dz) || 1);
      if (along > -0.95 || dist < g.radius * 0.55) {
        const fade = (1 - dist / g.radius) * (g.t / g.max);
        const mag = g.strength * fade;
        const len = Math.hypot(g.dx, g.dy, g.dz) || 1;
        wx += (g.dx / len) * mag;
        wy += (g.dy / len) * mag;
        wz += (g.dz / len) * mag;
      }
    }
  }
  str = Math.min(22, Math.hypot(wx, wy, wz));
  return { x: wx, y: wy, z: wz, strength: str, updraft: wy };
}

export function tickGust(world: WindWorld, dt: number) {
  if (!world.gust) return;
  world.gust.t -= dt;
  if (world.gust.t <= 0) world.gust = null;
}

export function occluded(from: { x: number; y: number; z: number }, to: { x: number; z: number }, blocked: (x: number, z: number) => boolean) {
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if (blocked(x, z)) return true;
  }
  return false;
}
