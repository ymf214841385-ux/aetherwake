/**
 * Rime / Pull / Still shrine interior routes.
 * Consumes Sim.extraSupports only — no fabricated ice/metal/frozen supports.
 * Paths are contiguous from the player; jump hops are action segments, not fake walks.
 */

import { type Solid, solidTop } from "./physics.ts";
import { SHRINE_ROOM, STILL_BLOCK, shrineWorldOrigin } from "./world.ts";
import {
  assembleContiguousPath,
  nearPoint,
  validateWalkSegment,
  type NavigationSnapshot,
  type RoutePoint,
  type RouteSegment,
} from "./shrine-route.ts";

type Extra = { y: number; id: string; x: number; z: number; r: number };

function baseSnapshot(
  worldId: string,
  status: NavigationSnapshot["status"],
  reason: string,
  nextAction: string,
  guidance: string,
  targetId: string | null,
  segments: RouteSegment[],
  requiredArt: string | null = null,
): NavigationSnapshot {
  return { worldId, status, reason, nextAction, requiredArt, targetId, segments, guidance };
}

function makeValidate(opts: {
  solids: Solid[];
  heightFn: (x: number, z: number) => number;
  extraSupports?: Extra[];
  worldId: string;
}) {
  return (a: RoutePoint, b: RoutePoint, id: string) =>
    validateWalkSegment(a, b, {
      solids: opts.solids,
      heightFn: opts.heightFn,
      extraSupports: opts.extraSupports ?? [],
      worldId: opts.worldId,
      id,
    });
}

/** Live ice supports come from extraSupports (y+3.35, r1.2) — filter by proximity to pit. */
export function buildRimeShrineRoute(opts: {
  shrineIndex: number;
  player: { x: number; y: number; z: number };
  ices: { x: number; y: number; z: number; life: number }[];
  solids: Solid[];
  heightFn: (x: number, z: number) => number;
  extraSupports?: Extra[];
}): NavigationSnapshot {
  const o = shrineWorldOrigin(opts.shrineIndex);
  const worldId = "shrine:rime";
  const entry: RoutePoint = { x: o.x, y: o.y, z: o.z + 4.4 };
  const action: RoutePoint = { x: o.x + 4, y: o.y, z: o.z + 10, label: "施术水面" };
  const altar: RoutePoint = { x: o.x, y: o.y, z: o.z + SHRINE_ROOM.altarZ - 2.5, label: "祭坛前" };
  const here: RoutePoint = { x: opts.player.x, y: opts.player.y, z: opts.player.z };

  // Only ice with life is walkable; extraSupports already encodes physical tops.
  const liveIce = opts.ices.filter((i) => i.life > 0.2);
  const vOpts = {
    solids: opts.solids,
    heightFn: opts.heightFn,
    extraSupports: opts.extraSupports ?? [],
    worldId,
  };
  const validate = makeValidate(vOpts);

  if (liveIce.length < 2) {
    // Crop: don't force walk back through entry if already past it.
    const wps =
      nearPoint(here, action, 3)
        ? []
        : [entry, action].filter((p) => !nearPoint(here, p, 1.5) && (p.z >= here.z - 1.5 || nearPoint(here, entry, 2)));
    const { segments } = assembleContiguousPath(here, wps, validate, "rime");
    return baseSnapshot(
      worldId,
      "action-required",
      "水面阻断通路",
      "选择霜息，在水面唤出可踏霜柱",
      "前往机关附近：面向水面施放霜息",
      "rime-pit",
      segments,
      "rime",
    );
  }

  // Hops between ice tops are short walks if extraSupports makes them continuous enough;
  // otherwise mark an action jump (not a fake walk).
  const icePts = liveIce
    .filter((i) => Math.abs(i.x - o.x) < 12 && i.z > o.z + 6 && i.z < o.z + 22)
    .slice(0, 3)
    .map((i, n) => ({ x: i.x, y: i.y + 3.35, z: i.z, label: `霜柱${n + 1}` }));
  if (icePts.length < 1) {
    const { segments } = assembleContiguousPath(here, [entry, action], validate, "rime");
    return baseSnapshot(worldId, "action-required", "霜柱未接通", "继续在水面施放霜息", "霜柱失效后需重新施术", "rime-pit", segments, "rime");
  }

  // Remaining ice hops only — skip entry if already past it.
  const iceRemaining = icePts.filter((p) => p.z > here.z - 1.5);
  const wps = [...iceRemaining, altar].filter((p) => !nearPoint(here, p, 1.2));
  const { segments, end, complete } = assembleContiguousPath(here, wps, validate, "rime");
  const reached = complete && nearPoint(end, altar, 2.5);
  if (reached) {
    return baseSnapshot(worldId, "walk", "", "靠近祭坛并互动领取灵核", "踏霜柱前往祭坛", "altar:rime", segments.filter((s) => s.validated));
  }
  return baseSnapshot(
    worldId,
    "action-required",
    "霜柱尚未连通",
    "继续在水面施放霜息，铺出通路",
    "霜柱失效后需重新施术",
    "rime-pit",
    segments.filter((s) => s.validated),
    "rime",
  );
}

export function buildPullShrineRoute(opts: {
  shrineIndex: number;
  player: { x: number; y: number; z: number };
  metals: { id: string; x: number; y: number; z: number; held: boolean }[];
  solids: Solid[];
  heightFn: (x: number, z: number) => number;
  extraSupports?: Extra[];
}): NavigationSnapshot {
  const o = shrineWorldOrigin(opts.shrineIndex);
  const worldId = "shrine:pull";
  const entry: RoutePoint = { x: o.x, y: o.y, z: o.z + 4.4 };
  const action: RoutePoint = { x: o.x + 5, y: o.y, z: o.z + 10, label: "金属板旁" };
  const altar: RoutePoint = { x: o.x, y: o.y, z: o.z + SHRINE_ROOM.altarZ - 2.5, label: "祭坛前" };
  const here: RoutePoint = { x: opts.player.x, y: opts.player.y, z: opts.player.z };

  // Held boards are not supports — extraSupports already skips them.
  const unheld = opts.metals.filter((m) => !m.held && m.id.startsWith("metal-shrine"));
  const bridged = unheld.filter((b) => Math.abs(b.x - o.x) < 5 && b.z > o.z + 10 && b.z < o.z + 20);
  const validate = makeValidate({
    solids: opts.solids,
    heightFn: opts.heightFn,
    extraSupports: opts.extraSupports ?? [],
    worldId,
  });

  const onSidewalk = here.x > o.x + 5.5 && here.z > o.z + 4;
  const onFarShore = here.z > o.z + 17;

  /** Legal +X sidewalk rim → far shore → altar. Validated only; walk iff complete. */
  const trySidewalkFallback = (reasonWhenBlocked: string, guidanceWhenBlocked: string): NavigationSnapshot => {
    const sidewalkFar: RoutePoint = {
      x: o.x + 7.15,
      y: o.y,
      z: o.z + 17.5,
      label: "侧廊尽头",
    };
    // Corner on the rim so we never cut the pit diagonally.
    const sidewalkEntry: RoutePoint = {
      x: o.x + 7.15,
      y: o.y,
      z: o.z + 6.5,
      label: "侧廊入口",
    };
    // Already past the entry corner on the rim: do not route backward.
    // Far shore: altar only. Off sidewalk: keep the safe corner approach.
    const pastEntryCorner = here.z > o.z + 6.5 + 0.4;
    let wps: RoutePoint[];
    if (onFarShore) wps = [altar];
    else if (onSidewalk && pastEntryCorner) wps = [sidewalkFar, altar];
    else wps = [sidewalkEntry, sidewalkFar, altar];
    wps = wps.filter((p) => !nearPoint(here, p, 1.2));
    const { segments, end, complete } = assembleContiguousPath(here, wps, validate, "pull-sidewalk");
    const walks = segments.filter((s) => s.validated && s.kind === "walk");
    const reached = complete && nearPoint(end, altar, 2.5);
    if (reached && walks.length > 0) {
      return baseSnapshot(
        worldId,
        "walk",
        "",
        "靠近祭坛并互动领取灵核",
        "沿侧廊绕过坑洞前往祭坛",
        "altar:pull",
        walks,
      );
    }
    if (walks.length > 0) {
      return baseSnapshot(
        worldId,
        "action-required",
        "侧廊到祭坛受阻",
        "沿侧廊继续前往祭坛",
        "沿侧廊绕过坑洞，不要直穿坑心",
        "altar:pull",
        walks,
      );
    }
    return baseSnapshot(
      worldId,
      "action-required",
      reasonWhenBlocked,
      guidanceWhenBlocked,
      "亦可走右侧侧廊绕过坑洞",
      "altar:pull",
      segments.filter((s) => s.validated),
    );
  };

  if (bridged.length < 1) {
    // Known legal alternate: +X sidewalk rim — offered from entry too, not only
    // when already standing on it. Single plate cannot span the 6.5m pit.
    if (onSidewalk || onFarShore) {
      return trySidewalkFallback("侧廊未形成完整通路", "沿右侧侧廊绕过坑洞前往祭坛");
    }
    const wps = nearPoint(here, action, 3) ? [] : [entry, action].filter((p) => !nearPoint(here, p, 1.5) && p.z >= here.z - 1.5);
    const { segments } = assembleContiguousPath(here, wps, validate, "pull");
    // Try sidewalk approach from the entry floor as well.
    const sidewalk = trySidewalkFallback("坑洞无桥", "选择牵引调整金属板，或走右侧侧廊");
    if (sidewalk.status === "walk") return sidewalk;
    return baseSnapshot(
      worldId,
      "action-required",
      "坑洞无桥",
      "选择牵引调整金属板，或走右侧侧廊",
      "前往侧廊入口；对金属板使用牵引可尝试搭桥",
      "pull-pit",
      sidewalk.segments.length > 0 ? sidewalk.segments : segments,
      "pull",
    );
  }

  // Candidate plate(s) exist — try the plate path first, then the same sidewalk fallback.
  const board: RoutePoint = { x: bridged[0]!.x, y: bridged[0]!.y + 0.28, z: bridged[0]!.z, label: "金属板" };
  const wps = [entry, board, altar]
    .filter((p) => !nearPoint(here, p, 1.2))
    .filter((p) => p.z >= here.z - 1.5 || p === altar);
  const { segments, end, complete } = assembleContiguousPath(here, wps, validate, "pull");
  const reached = complete && nearPoint(end, altar, 2.5);
  if (reached) {
    const walks = segments.filter((s) => s.validated);
    return baseSnapshot(worldId, "walk", "", "靠近祭坛并互动领取灵核", "沿金属板前往祭坛", "altar:pull", walks);
  }
  // R35: unusable in-band plate must NOT suppress the legal sidewalk.
  const sidewalk = trySidewalkFallback(
    "金属板未形成可走桥面",
    onSidewalk || onFarShore ? "沿侧廊继续前往祭坛" : "走右侧侧廊，或再调整金属板",
  );
  if (sidewalk.status === "walk") return sidewalk;
  return baseSnapshot(
    worldId,
    sidewalk.status === "action-required" && sidewalk.segments.length > 0 ? "action-required" : "action-required",
    sidewalk.reason || "金属板未形成可走桥面",
    sidewalk.nextAction || "用牵引调整金属板位置",
    sidewalk.guidance || "板子移开后通路会失效",
    "altar:pull",
    sidewalk.segments.length > 0 ? sidewalk.segments : segments.filter((s) => s.validated),
    "pull",
  );
}

export function buildStillShrineRoute(opts: {
  shrineIndex: number;
  player: { x: number; y: number; z: number };
  moveBlock: { x: number; y: number; z: number; frozen: number };
  solids: Solid[];
  heightFn: (x: number, z: number) => number;
  extraSupports?: Extra[];
}): NavigationSnapshot {
  const o = shrineWorldOrigin(opts.shrineIndex);
  const worldId = "shrine:still";
  const entry: RoutePoint = { x: o.x, y: o.y, z: o.z + 4.4, label: "祠内入口" };
  const action: RoutePoint = { x: o.x, y: o.y, z: o.z + 8, label: "凝时施术点" };
  const altar: RoutePoint = { x: o.x, y: o.y, z: o.z + SHRINE_ROOM.altarZ - 2.5, label: "祭坛前" };
  const here: RoutePoint = { x: opts.player.x, y: opts.player.y, z: opts.player.z };
  const frozen = opts.moveBlock.frozen > 0.15;
  const validate = makeValidate({
    solids: opts.solids,
    heightFn: opts.heightFn,
    extraSupports: opts.extraSupports ?? [],
    worldId,
  });

  // Pit z span for still is [10, 16.5] local (world.ts shrinePitSpanZ).
  const pitFront = o.z + 10;
  const pitBack = o.z + 16.5;
  const onFarShore = opts.player.z > pitBack + 0.5;
  const onNearShore = opts.player.z < pitFront - 0.3;

  // FAR SHORE: walk to altar regardless of freeze/offset — do not wait for ice/block.
  if (onFarShore) {
    const wps = [altar].filter((p) => !nearPoint(here, p, 1.5));
    const { segments, end, complete } = assembleContiguousPath(here, wps, validate, "still");
    const reached = complete && nearPoint(end, altar, 2.5);
    if (reached) {
      return baseSnapshot(
        worldId,
        "walk",
        "",
        "靠近祭坛并互动领取",
        "已过坑，前往祭坛",
        "altar:still",
        segments.filter((s) => s.validated),
      );
    }
    return baseSnapshot(
      worldId,
      "action-required",
      "祭坛方向受阻",
      "绕开障碍靠近祭坛",
      "已到对岸，前往祭坛",
      "altar:still",
      segments.filter((s) => s.validated),
    );
  }

  if (!frozen) {
    // Near shore needs freeze; mid-board without freeze is unstable.
    const wps = nearPoint(here, action, 3) ? [] : [entry, action].filter((p) => !nearPoint(here, p, 1.5) && p.z > opts.player.z - 1);
    const { segments } = assembleContiguousPath(here, wps, validate, "still");
    return baseSnapshot(
      worldId,
      "action-required",
      onNearShore ? "石块移动中，无法踏足" : "石块未冻结，无法通行",
      "选择凝时，冻结移动石块后快速通过",
      "前往机关附近：对石块使用凝时",
      "still-block",
      segments,
      "still",
    );
  }

  const slab = opts.solids.find((s) => s.id === "move-block");
  const slabY = slab ? solidTop(slab) : opts.moveBlock.y + 0.2;
  const halfW = STILL_BLOCK.w / 2;
  const halfD = STILL_BLOCK.d / 2;
  const alignOk = Math.abs(opts.moveBlock.x - o.x) <= halfW - 0.35;
  // Only require alignment when still approaching from near shore.
  if (!alignOk && onNearShore) {
    return baseSnapshot(
      worldId,
      "action-required",
      "石块未对齐通路",
      "等待石块横向对齐后再凝时通过",
      "石块左右摇摆，对齐后冻结",
      "still-block",
      [],
      "still",
    );
  }

  const boardTop = slabY;
  const front: RoutePoint = {
    x: opts.moveBlock.x,
    y: boardTop,
    z: opts.moveBlock.z - halfD + 0.6,
    label: "板前沿",
  };
  const back: RoutePoint = {
    x: opts.moveBlock.x,
    y: boardTop,
    z: opts.moveBlock.z + halfD - 0.6,
    label: "板后沿",
  };

  // Crop remaining stages from CURRENT player support — never route back to entry.
  const wps: RoutePoint[] = [];
  const pz = opts.player.z;
  if (pz < pitFront - 1) {
    // Near shore: approach lip, then board
    if (!nearPoint(here, action, 2)) wps.push(action);
    wps.push(front, back);
  } else if (pz < front.z + 1.2) {
    // At/near front lip: just board
    wps.push(front, back);
  } else if (pz < back.z + 0.8) {
    // On board: finish crossing only
    wps.push(back);
  }
  // After back lip, remaining is altar (far-shore branch handles z>pitBack)
  wps.push(altar);

  const { segments, end, complete } = assembleContiguousPath(here, wps, validate, "still");
  const reached = complete && nearPoint(end, altar, 2.5);
  if (reached) {
    return baseSnapshot(
      worldId,
      "walk",
      "",
      "冻结窗口内快速前往祭坛领取",
      "沿冻结石块中线过坑，解冻后通路失效",
      "altar:still",
      segments.filter((s) => s.validated),
    );
  }
  return baseSnapshot(
    worldId,
    "action-required",
    "冻结石块未接通对岸",
    "沿石块中线通过，或再次凝时后快速通过",
    "保持板内，对岸后再转向祭坛",
    "still-block",
    segments.filter((s) => s.validated),
    "still",
  );
}
