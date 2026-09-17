import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOverworldGraph, findRoute, nearestNodeId, buildShrineInteriorGraph } from "./navigation.ts";

const towers = [
  { id: "dawn", name: "晨光塔", x: 10, y: 0, z: 68 },
  { id: "mere", name: "镜湖塔", x: -108, y: 0, z: 8 },
  { id: "crown", name: "雪冠塔", x: 48, y: 0, z: -128 },
];
const shrines = [
  { id: "rime", name: "霜息祠", x: -72, y: 0, z: 36 },
  { id: "burst", name: "爆鸣祠", x: 118, y: 0, z: 28 },
  { id: "pull", name: "牵引祠", x: 36, y: 0, z: 8 },
  { id: "still", name: "凝时祠", x: 14, y: 0, z: -78 },
];

function graph() {
  return buildOverworldGraph({
    spawn: { x: 16, y: 12, z: 102 },
    towers,
    shrines,
    sage: { x: 4, y: 16, z: 114 },
    citadel: { x: 0, y: 8, z: -160 },
    towersOn: new Set(),
  });
}

describe("C05 navigation graph", () => {
  it("routes spawn → dawn tower base as approximate approach", () => {
    const { nodes, edges } = graph();
    const r = findRoute(nodes, edges, "spawn", "tower-base:dawn");
    assert.equal(r.status, "approximate");
    if (r.status === "approximate") {
      assert.ok(r.path.includes("tower-base:dawn"));
      assert.ok(r.cost > 10);
      assert.match(r.reason, /未|验证/);
    }
  });

  it("tower top is climb, not a ground walk line", () => {
    const { nodes, edges } = graph();
    const r = findRoute(nodes, edges, "tower-base:dawn", "tower-top:dawn");
    assert.equal(r.status, "action-required");
    if (r.status === "action-required") assert.match(r.instruction, /攀爬/);
  });

  it("tower-top y differs from base y", () => {
    const { nodes } = graph();
    const base = nodes.find((n) => n.id === "tower-base:dawn")!;
    const top = nodes.find((n) => n.id === "tower-top:dawn")!;
    assert.ok(top.y - base.y > 10);
  });

  it("walk edges are bidirectional (sage→spawn)", () => {
    const { nodes, edges } = graph();
    const r = findRoute(nodes, edges, "sage", "spawn");
    assert.notEqual(r.status, "unavailable");
  });

  it("shrine-to-shrine connects via hub", () => {
    const { nodes, edges } = graph();
    const r = findRoute(nodes, edges, "shrine-door:rime", "shrine-door:burst");
    assert.notEqual(r.status, "unavailable");
  });

  it("burst corridor waypoints exist and connect in graph topology", () => {
    const { nodes, edges } = graph();
    assert.ok(nodes.some((n) => n.id === "corr-b1"));
    assert.ok(edges.some((e) => e.from === "corr-b1" && e.to === "corr-b2"));
    const r = findRoute(nodes, edges, "spawn", "shrine-door:burst");
    assert.notEqual(r.status, "unavailable");
  });

  it("citadel edge disabled while sealed", () => {
    const { nodes, edges } = graph();
    const r = findRoute(nodes, edges, "spawn", "citadel");
    assert.equal(r.status, "unavailable");
  });

  it("enabling citadel edges makes it approximate-routable", () => {
    const { nodes, edges } = graph();
    for (const e of edges) if (e.to === "citadel" || e.from === "citadel") e.enabled = true;
    const r = findRoute(nodes, edges, "spawn", "citadel");
    assert.equal(r.status, "approximate");
  });

  it("nearest ground node near tower xz is base, not top", () => {
    const { nodes } = graph();
    const top = nodes.find((n) => n.id === "tower-top:dawn")!;
    const id = nearestNodeId(nodes, top.x, 1, top.z);
    assert.equal(id, "tower-base:dawn");
  });

  it("shrine interior mechanism edge stays disabled until solved", () => {
    const { nodes, edges } = buildShrineInteriorGraph({
      shrineId: "rime",
      origin: { x: 0, y: 0, z: 0 },
      altarZ: 23,
      mechanismSolved: false,
    });
    const r = findRoute(nodes, edges, "shrine-in:rime", "shrine-altar:rime");
    assert.equal(r.status, "unavailable");
    const solved = buildShrineInteriorGraph({
      shrineId: "rime",
      origin: { x: 0, y: 0, z: 0 },
      altarZ: 23,
      mechanismSolved: true,
    });
    const r2 = findRoute(solved.nodes, solved.edges, "shrine-in:rime", "shrine-altar:rime");
    assert.notEqual(r2.status, "unavailable");
  });
});
