/**
 * Lightweight mainline quest derivation from real Sim progress.
 * Does not invent completion: towers/orbs/boss come only from existing sets.
 */

export type QuestPhase =
  | "approach"
  | "climb"
  | "activate"
  | "enter"
  | "solve"
  | "claim"
  | "leave"
  | "fight"
  | "done";

export type TrackedObjective = {
  objectiveId: string;
  targetId: string;
  phase: QuestPhase;
  title: string;
  nextAction: string;
  /** World XZ of the approach anchor when known. */
  x?: number;
  z?: number;
  /** Straight-line distance hint; route length is separate. */
  distance?: number;
  /** Graph route cost when navigation is available. */
  routeCost?: number | null;
  routeStatus?: "approximate" | "action-required" | "unavailable" | null;
  routeHint?: string | null;
};

export type QuestInput = {
  towersOn: ReadonlySet<string>;
  shrinesOn: ReadonlySet<string>;
  orbs: number;
  bossDead: boolean;
  worldKind: string;
  shrine: string | null;
  px: number;
  py: number;
  pz: number;
  towers: ReadonlyArray<{ id: string; name: string; x: number; z: number; y: number }>;
  shrines: ReadonlyArray<{ id: string; name: string; x: number; z: number; y: number; hint?: string }>;
  citadel: { x: number; z: number };
  sealOpen: boolean;
  prompt: string;
  /** Stable map selection (tower/shrine/citadel id). Ignored if completed/invalid. */
  preferredTargetId?: string | null;
};

function dist2d(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

export function deriveTrackedObjective(q: QuestInput): TrackedObjective {
  if (q.worldKind === "graybox") {
    return {
      objectiveId: "graybox",
      targetId: "graybox",
      phase: "approach",
      title: "灰盒试炼",
      nextAction: "练习走、跑、跳、攀爬与滑翔",
    };
  }

  if (q.shrine !== null) {
    const s = q.shrines.find((x) => x.id === q.shrine);
    const name = s?.name ?? "灵祠";
    const done = q.shrinesOn.has(q.shrine);
    if (q.prompt.includes("领取") || q.prompt.includes("离开")) {
      return {
        objectiveId: `shrine-${q.shrine}`,
        targetId: q.shrine,
        phase: done ? "leave" : "claim",
        title: done ? `离开${name}` : `领取${name}灵核`,
        nextAction: done ? "与出口互动，返回原野" : "靠近祭坛并互动领取",
      };
    }
    return {
      objectiveId: `shrine-${q.shrine}`,
      targetId: q.shrine,
      phase: "solve",
      title: `解开${name}`,
      nextAction: s?.hint ?? "按祠内机关提示行动",
    };
  }

  // Stable map selection overrides the default next target when still valid.
  const pref = q.preferredTargetId;
  if (pref && q.worldKind === "overworld" && q.shrine === null) {
    const tw = q.towers.find((t) => t.id === pref);
    if (tw && !q.towersOn.has(tw.id)) {
      const d = dist2d(q.px, q.pz, tw.x, tw.z);
      return {
        objectiveId: `tower-${tw.id}`,
        targetId: tw.id,
        phase: d < 8 ? "climb" : "approach",
        title: `点亮${tw.name}`,
        nextAction: d < 8 ? "靠近塔壁，点击「攀爬」登顶" : `前往${tw.name}`,
        x: tw.x,
        z: tw.z,
        distance: d,
      };
    }
    const sh = q.shrines.find((s) => s.id === pref);
    if (sh && !q.shrinesOn.has(sh.id)) {
      const d = dist2d(q.px, q.pz, sh.x, sh.z);
      return {
        objectiveId: `shrine-${sh.id}`,
        targetId: sh.id,
        phase: d < 5 ? "enter" : "approach",
        title: `进入${sh.name}`,
        nextAction: d < 5 ? "在祠门前互动进入" : `前往${sh.name}`,
        x: sh.x,
        z: sh.z,
        distance: d,
      };
    }
    if (pref === "citadel" && q.sealOpen && !q.bossDead) {
      const d = dist2d(q.px, q.pz, q.citadel.x, q.citadel.z);
      return {
        objectiveId: "citadel-boss",
        targetId: "citadel",
        phase: d < 16 ? "fight" : "approach",
        title: "挑战空王",
        nextAction: d < 16 ? "进入残堡战斗区域" : "前往残堡合法入口",
        x: q.citadel.x,
        z: q.citadel.z,
        distance: d,
      };
    }
  }

  // Prefer an in-progress tower climb: player is high on an unfinished tower.
  for (const tw of q.towers) {
    if (q.towersOn.has(tw.id)) continue;
    const d = dist2d(q.px, q.pz, tw.x, tw.z);
    if (d < 8 && q.py > tw.y + 8) {
      return {
        objectiveId: `tower-${tw.id}`,
        targetId: tw.id,
        phase: d < 5.2 && q.py > tw.y + 12 ? "activate" : "climb",
        title: `启动${tw.name}`,
        nextAction: d < 5.2 && q.py > tw.y + 12 ? "在塔顶点击「启动」" : "靠近塔壁攀爬至塔顶",
        x: tw.x,
        z: tw.z,
        distance: d,
      };
    }
  }

  if (!q.towersOn.has("dawn")) {
    const tw = q.towers.find((t) => t.id === "dawn")!;
    const d = dist2d(q.px, q.pz, tw.x, tw.z);
    return {
      objectiveId: "tower-dawn",
      targetId: "dawn",
      phase: d < 8 ? "climb" : "approach",
      title: "点亮晨光塔",
      nextAction: d < 8 ? "靠近塔壁，点击「攀爬」登顶" : "沿指引前往晨光塔塔脚攀爬点",
      x: tw.x,
      z: tw.z,
      distance: d,
    };
  }

  if (q.towersOn.size < 3) {
    const next = q.towers.find((t) => !q.towersOn.has(t.id))!;
    const d = dist2d(q.px, q.pz, next.x, next.z);
    return {
      objectiveId: `tower-${next.id}`,
      targetId: next.id,
      phase: d < 8 ? "climb" : "approach",
      title: `点亮${next.name}`,
      nextAction: d < 8 ? "攀爬至塔顶后启动" : `前往${next.name}`,
      x: next.x,
      z: next.z,
      distance: d,
    };
  }

  if (q.orbs < 4) {
    const next = q.shrines.find((s) => !q.shrinesOn.has(s.id));
    // Inconsistent save/fixture: all shrines claimed but orb count lags.
    // Do not crash the HUD — fall through to seal/boss using real sets.
    if (next) {
      const d = dist2d(q.px, q.pz, next.x, next.z);
      return {
        objectiveId: `shrine-${next.id}`,
        targetId: next.id,
        phase: d < 5 ? "enter" : "approach",
        title: `进入${next.name}`,
        nextAction: d < 5 ? "在祠门前互动进入" : `前往${next.name}`,
        x: next.x,
        z: next.z,
        distance: d,
      };
    }
  }

  if (!q.sealOpen) {
    return {
      objectiveId: "citadel-seal",
      targetId: "citadel",
      phase: "approach",
      title: "残堡封印未开",
      nextAction: "集齐三塔与四枚灵核后封印才会打开",
      x: q.citadel.x,
      z: q.citadel.z,
    };
  }

  if (!q.bossDead) {
    const d = dist2d(q.px, q.pz, q.citadel.x, q.citadel.z);
    return {
      objectiveId: "citadel-boss",
      targetId: "citadel",
      phase: d < 16 ? "fight" : "approach",
      title: "挑战空王",
      nextAction: d < 16 ? "进入残堡战斗区域" : "前往残堡合法入口",
      x: q.citadel.x,
      z: q.citadel.z,
      distance: d,
    };
  }

  return {
    objectiveId: "free-roam",
    targetId: "free-roam",
    phase: "done",
    title: "原野暂时平静了",
    nextAction: "可继续探索未完成的塔与灵祠",
  };
}
