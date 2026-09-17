/**
 * Mainline navigation graph.
 *
 * Walk edges are bidirectional where both ends are ground-approachable.
 * Climb edges stay directed (base → top).
 * Until corridor geometry is validated, findRoute reports "approximate"
 * bearing/cost — never a proven traversable route.
 */

export const TOWER_CLIMB_HEIGHT = 38; // keep in sync with world TOWER_HEIGHT

export type NavNodeKind =
  | "spawn"
  | "poi"
  | "hub"
  | "corridor"
  | "tower-base"
  | "tower-top"
  | "shrine-door"
  | "citadel"
  | "shrine-altar"
  | "shrine-exit";

export type NavNode = {
  id: string;
  worldId: string;
  kind: NavNodeKind;
  x: number;
  y: number;
  z: number;
  label: string;
};

export type NavEdgeKind = "walk" | "climb" | "world";

export type NavEdge = {
  id: string;
  from: string;
  to: string;
  kind: NavEdgeKind;
  cost: number;
  enabled: boolean;
  /** Walk edges are traversable both ways when reverse is also present. */
  bidirectional?: boolean;
  note?: string;
};

export type RouteStatus =
  | { status: "approximate"; path: string[]; cost: number; nextNodeId: string | null; reason: string }
  | { status: "action-required"; anchorId: string; instruction: string }
  | { status: "unavailable"; reason: string };

function walkCost(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

/** Build overworld graph from live world coordinates. */
export function buildOverworldGraph(opts: {
  spawn: { x: number; y: number; z: number };
  towers: ReadonlyArray<{ id: string; name: string; x: number; y: number; z: number }>;
  shrines: ReadonlyArray<{ id: string; name: string; x: number; y: number; z: number }>;
  sage: { x: number; y: number; z: number };
  citadel: { x: number; y: number; z: number };
  towersOn: ReadonlySet<string>;
  towerHeight?: number;
  heightFn?: (x: number, z: number) => number;
}): { nodes: NavNode[]; edges: NavEdge[] } {
  const towerH = opts.towerHeight ?? TOWER_CLIMB_HEIGHT;
  const hf = opts.heightFn ?? (() => opts.spawn.y);
  const nodes: NavNode[] = [
    {
      id: "spawn",
      worldId: "overworld",
      kind: "spawn",
      x: opts.spawn.x,
      y: opts.spawn.y,
      z: opts.spawn.z,
      label: "苏醒处",
    },
    {
      id: "sage",
      worldId: "overworld",
      kind: "poi",
      x: opts.sage.x,
      y: opts.sage.y,
      z: opts.sage.z,
      label: "守塔人",
    },
    // Central hub so shrine↔shrine and tower↔tower remain connected.
    {
      id: "hub",
      worldId: "overworld",
      kind: "hub",
      x: 16,
      y: opts.spawn.y,
      z: 90,
      label: "原野中枢",
    },
    {
      id: "citadel",
      worldId: "overworld",
      kind: "citadel",
      x: opts.citadel.x,
      y: opts.citadel.y,
      z: opts.citadel.z,
      label: "残堡",
    },
  ];

  // Physically observed safe corridor spawn→burst door (headed burst-seg4 walk).
  // y from live heightFn; denser hops so step-up stays within production limits.
  const burstCorridor = [
    { id: "corr-b1", x: 32, z: 86 },
    { id: "corr-b2", x: 47, z: 70 },
    // Detour north of camp-a brambles (≈42,52 / 55,56) — damage-probe enemy hit.
    { id: "corr-b3", x: 58, z: 68 },
    { id: "corr-b4", x: 72, z: 58 },
    { id: "corr-b5", x: 90, z: 42 },
    { id: "corr-b6", x: 108, z: 35 },
    { id: "corr-b7", x: 116, z: 35 },
    { id: "corr-b8", x: 118, z: 34 },
    { id: "corr-b9", x: 118, z: 33 },
    { id: "corr-b10", x: 118, z: 31 },
  ];
  for (const c of burstCorridor) {
    nodes.push({
      id: c.id,
      worldId: "overworld",
      kind: "corridor",
      x: c.x,
      y: hf(c.x, c.z),
      z: c.z,
      label: "通路点",
    });
  }

  for (const t of opts.towers) {
    nodes.push({
      id: `tower-base:${t.id}`,
      worldId: "overworld",
      kind: "tower-base",
      x: t.x,
      y: t.y,
      z: t.z,
      label: `${t.name}塔脚`,
    });
    // Distinct top height — must not share base y.
    nodes.push({
      id: `tower-top:${t.id}`,
      worldId: "overworld",
      kind: "tower-top",
      x: t.x,
      y: t.y + towerH - 1.5,
      z: t.z,
      label: `${t.name}塔顶`,
    });
  }
  for (const s of opts.shrines) {
    // Door approach sits on the apron pad top (standable), not buried terrain.
    // landmarkSolids apron: y = s.y - 0.06, h = 0.22 → top = s.y + 0.16.
    // hf(door)+0.28 is terrain+offset and is NOT the real support height.
    const dx = s.x;
    const dz = s.z + 2.8;
    const doorY = s.y + 0.16;
    nodes.push({
      id: `shrine-door:${s.id}`,
      worldId: "overworld",
      kind: "shrine-door",
      x: dx,
      y: doorY,
      z: dz,
      label: s.name,
    });
  }

  const edges: NavEdge[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const addWalkPair = (a: string, b: string, note?: string) => {
    const na = byId.get(a);
    const nb = byId.get(b);
    if (!na || !nb) return;
    const cost = walkCost(na.x, na.z, nb.x, nb.z);
    edges.push({ id: `${a}->${b}`, from: a, to: b, kind: "walk", cost, enabled: true, bidirectional: true, note });
    edges.push({ id: `${b}->${a}`, from: b, to: a, kind: "walk", cost, enabled: true, bidirectional: true, note });
  };
  const addClimb = (from: string, to: string, note: string) => {
    edges.push({ id: `${from}->${to}`, from, to, kind: "climb", cost: 14, enabled: true, note });
  };

  addWalkPair("spawn", "sage", "教学可选");
  addWalkPair("spawn", "hub");
  addWalkPair("sage", "hub");
  // Observed burst corridor (headed walk) — still requires per-edge physics validate.
  addWalkPair("spawn", "corr-b1", "burst通路");
  addWalkPair("corr-b1", "corr-b2", "burst通路");
  addWalkPair("corr-b2", "corr-b3", "burst通路");
  addWalkPair("corr-b3", "corr-b4", "burst通路");
  addWalkPair("corr-b4", "corr-b5", "burst通路");
  addWalkPair("corr-b5", "corr-b6", "burst通路");
  addWalkPair("corr-b6", "corr-b7", "burst通路");
  addWalkPair("corr-b7", "corr-b8", "burst通路");
  addWalkPair("corr-b8", "corr-b9", "burst通路");
  addWalkPair("corr-b9", "corr-b10", "burst通路");
  addWalkPair("corr-b10", "shrine-door:burst", "burst通路");
  addWalkPair("hub", "corr-b2");
  for (const t of opts.towers) {
    addWalkPair("hub", `tower-base:${t.id}`);
    addWalkPair("spawn", `tower-base:${t.id}`);
    addClimb(`tower-base:${t.id}`, `tower-top:${t.id}`, "需攀爬；塔脚≠塔顶");
  }
  for (const s of opts.shrines) {
    addWalkPair("hub", `shrine-door:${s.id}`);
    addWalkPair("spawn", `shrine-door:${s.id}`);
  }
  addWalkPair("hub", "citadel", "封印未开时禁用");
  const citadelIn = edges.filter((e) => e.to === "citadel" || e.from === "citadel");
  for (const e of citadelIn) {
    e.enabled = false;
    e.note = "残堡封印未开时禁用";
  }

  return { nodes, edges };
}

/**
 * Shrine interior graph. Mechanism edges are disabled until the sim flips them.
 */
export function buildShrineInteriorGraph(opts: {
  shrineId: string;
  origin: { x: number; y: number; z: number };
  altarZ: number;
  mechanismSolved: boolean;
}): { nodes: NavNode[]; edges: NavEdge[] } {
  const worldId = `shrine:${opts.shrineId}`;
  const o = opts.origin;
  const nodes: NavNode[] = [
    {
      id: `shrine-in:${opts.shrineId}`,
      worldId,
      kind: "poi",
      x: o.x,
      y: o.y,
      z: o.z + 4.4,
      label: "祠内入口",
    },
    {
      id: `shrine-altar:${opts.shrineId}`,
      worldId,
      kind: "shrine-altar",
      x: o.x,
      y: o.y,
      z: o.z + opts.altarZ,
      label: "祭坛",
    },
    {
      id: `shrine-exit:${opts.shrineId}`,
      worldId,
      kind: "shrine-exit",
      x: o.x,
      y: o.y,
      z: o.z + 1,
      label: "祠出口",
    },
  ];
  const edges: NavEdge[] = [
    {
      id: "in->exit",
      from: `shrine-in:${opts.shrineId}`,
      to: `shrine-exit:${opts.shrineId}`,
      kind: "walk",
      cost: 3.5,
      enabled: true,
      bidirectional: true,
    },
    {
      id: "exit->in",
      from: `shrine-exit:${opts.shrineId}`,
      to: `shrine-in:${opts.shrineId}`,
      kind: "walk",
      cost: 3.5,
      enabled: true,
      bidirectional: true,
    },
    {
      id: "in->altar",
      from: `shrine-in:${opts.shrineId}`,
      to: `shrine-altar:${opts.shrineId}`,
      kind: "walk",
      cost: Math.hypot(0, opts.altarZ - 4.4),
      enabled: opts.mechanismSolved,
      note: opts.mechanismSolved ? "机关已解" : "机关未解，通路不可用",
    },
  ];
  return { nodes, edges };
}

/**
 * Dijkstra. Returns approximate (unvalidated corridor) rather than ready.
 */
export function findRoute(nodes: NavNode[], edges: NavEdge[], fromId: string, toId: string): RouteStatus {
  if (!nodes.some((n) => n.id === fromId) || !nodes.some((n) => n.id === toId)) {
    return { status: "unavailable", reason: "未知节点" };
  }
  if (fromId === toId) {
    return { status: "approximate", path: [fromId], cost: 0, nextNodeId: null, reason: "已在目标节点" };
  }

  const adj = new Map<string, { to: string; cost: number; kind: NavEdgeKind }[]>();
  for (const e of edges) {
    if (!e.enabled) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push({ to: e.to, cost: e.cost, kind: e.kind });
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(fromId, 0);

  while (true) {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (!best) break;
    if (best === toId) break;
    visited.add(best);
    for (const n of adj.get(best) ?? []) {
      const nd = bestD + n.cost;
      if (nd < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, nd);
        prev.set(n.to, best);
      }
    }
  }

  if (!dist.has(toId)) return { status: "unavailable", reason: "当前无连通路线" };

  const path: string[] = [];
  let cur: string | undefined = toId;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  const next = path[1] ?? null;
  const nextNode = next ? nodes.find((n) => n.id === next) : null;
  if (nextNode?.kind === "tower-top") {
    return { status: "action-required", anchorId: next, instruction: "攀爬至塔顶后启动" };
  }
  return {
    status: "approximate",
    path,
    cost: dist.get(toId)!,
    nextNodeId: next,
    reason: "路径图连线，未做碰撞走廊验证",
  };
}

/**
 * Nearest ground node to a world position.
 * Does not snap to tower-top when the player is on the ground.
 */
export function nearestNodeId(nodes: NavNode[], x: number, y: number, z: number, opts?: { maxY?: number }) {
  const maxDy = opts?.maxY ?? 12;
  let best = "";
  let bd = Infinity;
  for (const n of nodes) {
    if (n.kind === "tower-top" && Math.abs(n.y - y) > maxDy) continue;
    const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 0.35;
    if (d < bd) {
      bd = d;
      best = n.id;
    }
  }
  if (!best) {
    // Fall back to any nearest including tops.
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
  }
  return best;
}
