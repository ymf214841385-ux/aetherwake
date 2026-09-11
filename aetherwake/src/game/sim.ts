import { sfx, setWind } from "./audio.ts";
import { createAttack, createBrain, losBlocked, meleeHit, startAttack, tickAttack } from "./combat.ts";
import type { AttackState, EnemyBrain } from "./combat.ts";
import { GRAYBOX_GROUND, GRAYBOX_RESET, GRAYBOX_WATER, grayboxSolids } from "./graybox.ts";
import { WATER_LEVEL, WIND_RUIN, WORLD_SIZE, climateAt, heightAt } from "./height.ts";
import { resetInput, setKeys } from "./input.ts";
import type { Actions } from "./input.ts";
import {
  ACCEL_TIME,
  AIR_CONTROL,
  ART_NAMES,
  BASE_STAMINA,
  BENCHMARK_TOD,
  BRAKE_TIME,
  CAM_DIST,
  CAM_DIST_AIM,
  CAM_DIST_CLIMB,
  CAM_DIST_GLIDE,
  CAM_PITCH_MAX,
  CAM_PITCH_MIN,
  CLIMB_SPEED,
  CLIMB_STAMINA,
  CLIMB_SHIMMY,
  MANTLE_REACH_XZ,
  MANTLE_REACH_Y,
  MANTLE_STEP_XZ,
  MANTLE_STEP_Y,
  COYOTE_TIME,
  DAY_SECONDS,
  DODGE_COOLDOWN,
  DODGE_IFRAMES,
  DODGE_SPEED,
  DODGE_STAMINA,
  DODGE_TIME,
  EYE_HEIGHT,
  FOOT_SNAP,
  GLIDE_MAX_XZ,
  GLIDE_SINK,
  GLIDE_STAMINA,
  GLIDE_TURN,
  GRAVITY,
  GUST_COOLDOWN,
  GUST_DURATION,
  GUST_RADIUS,
  GUST_STAMINA,
  GUST_STRENGTH,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  LOOK_SENS,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  SPRINT_STAMINA,
  STAMINA_REGEN,
  STEP_UP,
  SWIM_SPEED,
  WALK_SPEED,
  WISP_STAMINA,
} from "./params.ts";
import {
  browserStorage,
  createDefaultSave,
  loadSave,
  resolveWeaponIds,
  sealOpen as sealFromProgress,
  writeSave,
  type SaveEnvelope,
  type SaveStorage,
} from "./persistence.ts";
import {
  clamp,
  closestPointOnSolidXZ,
  lerp,
  lerpAng,
  queryWall,
  resolveHorizontal,
  solidTop,
  sphereCast,
  supportY,
  type Solid,
} from "./physics.ts";
import { loadSettings, type Settings } from "./settings.ts";
import { hasSaveFile, useHud } from "./store.ts";
import type { InvMeal, InvWeapon, Marker, Mode } from "./store.ts";
import { createWindWorld, sampleWind, tickGust, type WindWorld } from "./wind.ts";
import {
  BURST_WALL,
  CAMPS,
  CITADEL_POI,
  CHESTS,
  FIRES,
  SAGE,
  SHRINES,
  SHRINE_ROOM,
  SHRINE_SIDEWALK,
  STILL_BLOCK,
  TOWERS,
  TOWER_HEIGHT,
  TOWER_RADIUS,
  UPDRAFTS,
  WISPS,
  initWorld,
  landmarkSolids,
  isTowerRest,
  makeWindPlanks,
  shrineHasSidewalk,
  shrinePitHalfWidth,
  shrinePitSpanZ,
  shrineWorldOrigin,
  type ShrinePitKind,
  type WindPlank,
} from "./world.ts";

export type MoveState = "grounded" | "airborne" | "climbing" | "gliding" | "swimming" | "dead";
export type WorldKind = "overworld" | "graybox" | "shrine";

export type Enemy = {
  id: string;
  kind: "bramble" | "sentinel" | "boss";
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  max: number;
  homeX: number;
  homeZ: number;
  flash: number;
  frozen: number;
  timer: number;
  alive: boolean;
  hurt: number;
  brain: EnemyBrain;
  telegraph: number;
};

export type Pickup = { id: string; kind: "apple" | "meat" | "pepper" | "amber" | "heart"; x: number; y: number; z: number; live: boolean };
export type Particle = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; r: number; g: number; b: number };
export type Proj = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; kind: "arrow" | "beam"; dmg: number };
export type Ice = { x: number; y: number; z: number; life: number };
export type Metal = { id: string; x: number; y: number; z: number; held: boolean; vx: number; vy: number; vz: number };

function weapon(id: string, name: string, dmg: number, max: number, kind: InvWeapon["kind"]): InvWeapon {
  return { id, name, dmg, dur: max, max, kind };
}

export class Sim {
  mode: Mode = "title";
  worldKind: WorldKind = "overworld";
  t = 0;
  player = {
    x: 16,
    y: 12,
    z: 102,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    stamina: BASE_STAMINA,
    staminaMax: BASE_STAMINA,
    hp: 3,
    heartsMax: 3,
    state: "grounded" as MoveState,
    climbing: false,
    gliding: false,
    swimming: false,
    grounded: true,
    attackT: 0,
    aiming: false,
    invuln: 0,
    spicy: 0,
    cold: false,
    coyote: 0,
    jumpBuf: 0,
    dodgeT: 0,
    dodgeCd: 0,
  };
  cam = { yaw: 0, pitch: 0.38, dist: CAM_DIST, x: 16, y: 18, z: 110, lx: 16, ly: 13, lz: 102, trauma: 0 };
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  particles: Particle[] = [];
  projs: Proj[] = [];
  ices: Ice[] = [];
  metals: Metal[] = [];
  planks: WindPlank[] = [];
  bomb: { x: number; y: number; z: number } | null = null;
  wispsGot = new Set<string>();
  towersOn = new Set<string>();
  shrinesOn = new Set<string>();
  chestsGot = new Set<string>();
  timeOfDay = BENCHMARK_TOD;
  raining = false;
  art = 0;
  arrows = 24;
  amber = 0;
  orbs = 0;
  weapons: InvWeapon[] = [];
  meals: InvMeal[] = [];
  mats: Record<string, number> = { apple: 2, pepper: 1 };
  equippedId: string | null = "blade";
  bowId: string | null = "bow";
  prompt = "";
  toast = "";
  toastT = 0;
  dialogue = "";
  shrine: number | null = null;
  shrineHint = "";
  crackedBroken = [false, false, false, false];
  moveBlock = { t: 0, frozen: 0, x: 0, z: 0 };
  heldMetal = -1;
  overworld = { x: 16, y: 12, z: 102, yaw: 0 };
  surveyT = 0;
  interactLock = 0;
  stepAcc = 0;
  windAmt = 0;
  bossDead = false;
  endingT = 0;
  spawn = { id: "spawn", x: 16, y: 12, z: 102 };
  hudAcc = 0;
  coldAcc = 0;
  attack: AttackState = createAttack();
  solids: Solid[] = [];
  wind: WindWorld = createWindWorld();
  gustCd = 0;
  storage: SaveStorage;
  settings: Settings;
  saveError = "";
  sealRule: SaveEnvelope["progress"]["sealRule"] = "towers-and-shrines";
  tutorial = "";
  tutorialSeen = new Set<string>();
  lastSaveAt = 0;
  overflow = 0;
  ruinSolved = false;
  glLost = false;
  glRestoredAt = 0;
  portrait = false;

  constructor(storage?: SaveStorage) {
    this.storage = storage ?? (typeof localStorage !== "undefined" ? browserStorage() : { getItem: () => null, setItem: () => undefined });
    this.settings = typeof localStorage !== "undefined" ? loadSettings() : { lookSens: 1, invertY: false, shake: 1, masterVol: 0.7, sfxVol: 0.9, musicVol: 0.22, quality: "auto", lockDay: true };
    initWorld();
    this.resetWorldEntities(false);
    this.player.y = this.heightFn(this.player.x, this.player.z);
    this.rebuildSolids();
    this.syncWindZones();
    if (typeof window !== "undefined") {
      window.__controlsTest = {
        getYaw: () => this.player.yaw,
        getSpeed: () => Math.hypot(this.player.vx, this.player.vz),
        setKeys,
      };
    }
  }

  heightFn = (x: number, z: number) => {
    if (this.worldKind === "graybox") return GRAYBOX_GROUND(x, z);
    if (this.shrine !== null) {
      const o = shrineWorldOrigin(this.shrine);
      const lx = x - o.x;
      const lz = z - o.z;
      let h = o.y;
      const puzzle = SHRINES[this.shrine]?.puzzle as ShrinePitKind | undefined;
      // Shared with Scene.tsx ShrineRooms via shrinePitHalfWidth/SpanZ.
      if (puzzle === "rime" || puzzle === "pull" || puzzle === "still") {
        const { z0, z1, depth } = shrinePitSpanZ(puzzle);
        if (lz > z0 && lz < z1 && Math.abs(lx) < shrinePitHalfWidth(puzzle)) h = o.y - depth;
      }
      return h;
    }
    return heightAt(x, z);
  };

  rebuildSolids() {
    if (this.worldKind === "graybox") {
      this.solids = grayboxSolids();
      return;
    }
    if (this.shrine !== null) {
      const o = shrineWorldOrigin(this.shrine);
      this.solids = [
        { id: "shrine-l", kind: "box", x: o.x - SHRINE_ROOM.wallX, y: o.y, z: o.z + SHRINE_ROOM.wallZ, w: SHRINE_ROOM.wallW, h: SHRINE_ROOM.wallH, d: SHRINE_ROOM.wallD, standable: false },
        { id: "shrine-r", kind: "box", x: o.x + SHRINE_ROOM.wallX, y: o.y, z: o.z + SHRINE_ROOM.wallZ, w: SHRINE_ROOM.wallW, h: SHRINE_ROOM.wallH, d: SHRINE_ROOM.wallD, standable: false },
        { id: "shrine-b", kind: "box", x: o.x, y: o.y, z: o.z + SHRINE_ROOM.backZ, w: 20, h: SHRINE_ROOM.wallH, d: 0.5, standable: false },
        { id: "shrine-f", kind: "box", x: o.x, y: o.y, z: o.z + SHRINE_ROOM.frontZ, w: 20, h: SHRINE_ROOM.wallH, d: 0.5, standable: false },
        { id: "shrine-altar", kind: "cyl", x: o.x, y: o.y, z: o.z + SHRINE_ROOM.altarZ, r: SHRINE_ROOM.altarR, h: SHRINE_ROOM.altarH, standable: true },
        { id: "shrine-altar-pad", kind: "cyl", x: o.x, y: o.y, z: o.z + SHRINE_ROOM.altarZ, r: SHRINE_ROOM.altarPadR, h: 0.1, standable: true },
      ];
      const puzzle = SHRINES[this.shrine]?.puzzle;
      if (puzzle === "burst" && !this.crackedBroken[this.shrine]) {
        this.solids.push({
          id: "crack",
          kind: "box",
          x: o.x,
          y: o.y,
          z: o.z + BURST_WALL.z,
          w: BURST_WALL.w,
          h: BURST_WALL.h,
          d: BURST_WALL.d,
          standable: false,
        });
      }
      if (puzzle === "rime" || puzzle === "pull" || puzzle === "still") {
        const pitW = shrinePitHalfWidth(puzzle) * 2;
        const { z0, z1 } = shrinePitSpanZ(puzzle);
        const pitH = 4.1;
        const midZ = o.z + (z0 + z1) * 0.5;
        const pitD = z1 - z0;
        this.solids.push(
          { id: "pit-e", kind: "box", x: o.x + pitW * 0.5, y: o.y - pitH, z: midZ, w: 0.4, h: pitH, d: pitD, climbable: true, standable: false },
          { id: "pit-w", kind: "box", x: o.x - pitW * 0.5, y: o.y - pitH, z: midZ, w: 0.4, h: pitH, d: pitD, climbable: true, standable: false },
          { id: "pit-n", kind: "box", x: o.x, y: o.y - pitH, z: o.z + z1, w: pitW, h: pitH, d: 0.4, climbable: true, standable: false },
        );
      }
      if (shrineHasSidewalk(puzzle)) {
        for (const side of [SHRINE_SIDEWALK.x, -SHRINE_SIDEWALK.x] as const) {
          this.solids.push({
            id: side > 0 ? "shrine-sidewalk" : "shrine-sidewalk-l",
            kind: "box",
            x: o.x + side,
            y: o.y + SHRINE_SIDEWALK.y,
            z: o.z + SHRINE_SIDEWALK.z,
            w: SHRINE_SIDEWALK.w,
            h: SHRINE_SIDEWALK.h,
            d: SHRINE_SIDEWALK.d,
            standable: true,
          });
        }
      }
      if (puzzle === "still") {
        this.solids.push({
          id: "move-block",
          kind: "box",
          x: this.moveBlock.x,
          y: o.y,
          z: this.moveBlock.z,
          w: STILL_BLOCK.w,
          h: STILL_BLOCK.h,
          d: STILL_BLOCK.d,
          standable: true,
        });
      }
      return;
    }
    this.solids = landmarkSolids();
  }

  extraSupports(exclude?: string | null) {
    const extra: { y: number; id: string; x: number; z: number; r: number }[] = [];
    for (const ice of this.ices) extra.push({ id: `ice-${ice.x.toFixed(1)}`, x: ice.x, y: ice.y + 3.35, z: ice.z, r: 1.2 });
    for (const m of this.metals) {
      if (m.held) continue;
      extra.push({ id: m.id, x: m.x, y: m.y + 0.28, z: m.z, r: 1.15 });
    }
    for (const p of this.planks) extra.push({ id: p.id, x: p.x, y: p.y + 0.16, z: p.z, r: 1.4 });
    // Still freeze-bridge is a standable solid in rebuildSolids (floor-height
    // slab spanning the pit). extraSupport r=1.5 at y+0.9 was not walkable.
    if (this.worldKind === "graybox") {
      extra.push({ id: "gb-move", x: 4 + Math.sin(this.t) * 3, y: 0.45, z: 14, r: 1.4 });
    }
    return extra.filter((e) => e.id !== exclude);
  }

  surfaceY(x: number, z: number, feetY?: number, exclude?: string | null) {
    const fy = feetY ?? this.player.y + FOOT_SNAP;
    return supportY(x, z, fy, this.solids, this.heightFn, this.extraSupports(exclude), exclude).y;
  }

  syncWindZones() {
    this.wind.zones = UPDRAFTS.map((u) => ({
      id: u.id,
      x: u.x,
      z: u.z,
      r: u.r,
      dirX: 0,
      dirZ: 0,
      strength: 0,
      updraft: u.updraft,
    }));
  }

  resetWorldEntities(keepProgress: boolean) {
    this.enemies = [];
    CAMPS.forEach((c, ci) => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + ci * 0.4;
        const x = c.x + Math.cos(a) * (3.6 + i * 0.4);
        const z = c.z + Math.sin(a) * (3.6 + i * 0.4);
        this.enemies.push(this.makeEnemy(`b-${ci}-${i}`, "bramble", x, z, 3));
      }
    });
    for (const [i, p] of [
      [22, -36],
      [52, -72],
    ].entries()) {
      this.enemies.push(this.makeEnemy(`s-${i}`, "sentinel", p[0]!, p[1]!, 8));
    }
    // P0-2: only a progress-keeping load may place a corpse boss.
    // freshRuntime(false) clears bossDead AFTER this call — never spawn dead
    // from a stale flag (b80cf12 regression: new game got a dead boss).
    if (keepProgress && this.bossDead) {
      const deadBoss = this.makeEnemy("boss", "boss", CITADEL_POI.x, CITADEL_POI.z + 7.2, 20);
      deadBoss.alive = false;
      deadBoss.hp = 0;
      deadBoss.brain.phase = "dead";
      deadBoss.brain.rewarded = true;
      this.enemies.push(deadBoss);
    } else {
      this.enemies.push(this.makeEnemy("boss", "boss", CITADEL_POI.x, CITADEL_POI.z + 7.2, 20));
    }
    this.pickups = [];
    for (let i = 0; i < 14; i++) {
      const x = (Math.sin(i * 12.1) * 0.5 + 0.5) * 160 - 40;
      const z = (Math.cos(i * 7.7) * 0.5 + 0.5) * 80 + 40;
      this.pickups.push({ id: `ap-${i}`, kind: i % 5 === 0 ? "pepper" : "apple", x, y: heightAt(x, z) + 0.4, z, live: true });
    }
    this.metals = [
      { id: "metal-field-0", x: 34, y: heightAt(34, 10) + 0.5, z: 10, held: false, vx: 0, vy: 0, vz: 0 },
      { id: "metal-field-1", x: 90, y: heightAt(90, 20) + 0.5, z: 20, held: false, vx: 0, vy: 0, vz: 0 },
    ];
    this.planks = makeWindPlanks();
    this.ices = [];
    this.bomb = null;
    this.projs = [];
    this.particles = [];
    if (!keepProgress) {
      this.wispsGot.clear();
      this.towersOn.clear();
      this.shrinesOn.clear();
      this.chestsGot.clear();
      this.crackedBroken = [false, false, false, false];
      this.orbs = 0;
      this.bossDead = false;
      this.ruinSolved = false;
    }
  }

  makeEnemy(id: string, kind: Enemy["kind"], x: number, z: number, hp: number): Enemy {
    return {
      id,
      kind,
      x,
      y: heightAt(x, z),
      z,
      yaw: 0,
      hp,
      max: hp,
      homeX: x,
      homeZ: z,
      flash: 0,
      frozen: 0,
      timer: 1,
      alive: true,
      hurt: 0,
      brain: createBrain(),
      telegraph: 0,
    };
  }

  freshRuntime(persist: boolean) {
    this.mode = "playing";
    this.worldKind = "overworld";
    this.shrine = null;
    this.saveError = "";
    this.player.x = 16;
    this.player.z = 102;
    this.player.y = this.heightFn(16, 102);
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
    this.player.yaw = 0;
    this.player.hp = 3;
    this.player.heartsMax = 3;
    this.player.stamina = BASE_STAMINA;
    this.player.staminaMax = BASE_STAMINA;
    this.setMove("grounded");
    this.cam.yaw = 0;
    this.cam.pitch = 0.38;
    this.weapons = [weapon("blade", "旅人短剑", 18, 24, "sword"), weapon("bow", "林间长弓", 12, 20, "bow")];
    this.equippedId = "blade";
    this.bowId = "bow";
    this.meals = [];
    this.mats = { apple: 2, pepper: 1 };
    this.arrows = 24;
    this.amber = 0;
    this.art = 0;
    this.timeOfDay = BENCHMARK_TOD;
    this.sealRule = "towers-and-shrines";
    this.resetWorldEntities(false);
    this.spawn = { id: "spawn", x: 16, y: this.player.y, z: 102 };
    this.rebuildSolids();
    this.tutorial = "先走出去。看到塔之后，再决定路线。";
    this.pushToast("走出小路，看向晨光塔。空中再按跳跃滑翔，靠近可攀墙按互动攀爬。");
    resetInput();
    if (persist) this.save();
    this.syncHud();
  }

  startNew() {
    this.freshRuntime(true);
  }

  continueSave() {
    const loaded = loadSave(this.storage);
    if (!loaded.ok) {
      if (loaded.reason === "missing") {
        this.freshRuntime(true);
        return;
      }
      this.saveError = "存档损坏，原文已保留。可开始新的旅途。";
      this.mode = "title";
      this.syncHud();
      return;
    }
    this.applySave(loaded.data);
    this.mode = "playing";
    this.syncHud();
  }

  applySave(d: SaveEnvelope) {
    this.player.x = d.player.x;
    this.player.z = d.player.z;
    this.player.yaw = d.player.yaw;
    this.cam.yaw = d.player.camYaw;
    this.player.hp = d.player.hp;
    this.player.heartsMax = d.player.heartsMax;
    this.player.staminaMax = d.player.staminaMax;
    this.player.stamina = d.player.staminaMax;
    this.player.spicy = d.player.spicy;
    this.arrows = d.player.arrows;
    this.amber = d.player.amber;
    this.art = d.player.art;
    this.orbs = d.progress.orbs;
    this.towersOn = new Set(d.progress.towers);
    this.shrinesOn = new Set(d.progress.shrines);
    this.wispsGot = new Set(d.progress.wisps);
    this.chestsGot = new Set(d.progress.chests);
    this.bossDead = d.progress.bossDead;
    this.ruinSolved = d.progress.ruinSolved === true;
    this.sealRule = d.progress.sealRule;
    this.weapons = d.inventory.weapons;
    this.meals = d.inventory.meals;
    this.mats = d.inventory.mats;
    const ids = resolveWeaponIds(this.weapons, d.inventory.equippedId, d.inventory.bowId);
    this.equippedId = ids.equippedId;
    this.bowId = ids.bowId;
    // P0-3: never restore a dangling shrine interior — saves are overworld/graybox.
    this.worldKind = d.progress.graybox ? "graybox" : "overworld";
    this.shrine = null;
    this.resetWorldEntities(true);
    if (this.ruinSolved) this.dockSolvedPlanks();
    this.rebuildSolids();
    this.spawn = this.resolveCheckpoint(d.checkpoint);
    // Continue restores the SAVED player pose. Checkpoint is only death-respawn.
    // 43e78cb regression: tower-* id forced player onto the cap even when the
    // save already stood in the courtyard / shrine entrance.
    const onTowerId = this.spawn.id.startsWith("tower-");
    const nearTowerXZ =
      onTowerId && Math.hypot(this.player.x - this.spawn.x, this.player.z - this.spawn.z) < 8;
    const poseBroken =
      !Number.isFinite(this.player.x) || !Number.isFinite(this.player.z) || !Number.isFinite(this.player.y);
    if (poseBroken || nearTowerXZ) {
      // Broken pose, or saved pose is on that tower’s xz → stand on cap.
      // Far poses (courtyard / shrine door) keep their saved xz.
      this.player.x = this.spawn.x;
      this.player.z = this.spawn.z;
      this.player.y = this.spawn.y;
    } else {
      const support = this.surfaceY(this.player.x, this.player.z, this.player.y + 2);
      if (!Number.isFinite(this.player.y) || this.player.y < support - 0.2 || this.player.y > support + 8) {
        this.player.y = support;
      }
    }
    this.setMove("grounded");
    this.clearTransients();
  }

  /**
   * P0-3 review: resolve by checkpoint ID against real support, not a
   * terrain..terrain+48 window. Tower caps use authored TOWER_HEIGHT; other
   * ids stand on terrain at xz. applySave aligns the player to this spawn.
   */
  resolveCheckpoint(cp: { id: string; x: number; y: number; z: number }) {
    if (cp.id === "graybox") {
      return { id: "graybox", x: GRAYBOX_RESET.x, y: GRAYBOX_RESET.y, z: GRAYBOX_RESET.z };
    }
    if (cp.id === "spawn") {
      const g = this.heightFn(16, 102);
      return { id: "spawn", x: 16, y: Number.isFinite(g) ? g : 12, z: 102 };
    }
    const towerMatch = /^tower-(.+)$/.exec(cp.id);
    if (towerMatch) {
      const tw = TOWERS.find((t) => t.id === towerMatch[1]);
      if (tw) {
        // Authored cap: base + TOWER_HEIGHT, stand slightly inside the lip.
        const capY = tw.y + TOWER_HEIGHT - 1.2;
        const near = Math.hypot(cp.x - tw.x, cp.z - tw.z) < 8;
        return {
          id: cp.id,
          x: near ? cp.x : tw.x,
          y: capY,
          z: near ? cp.z : tw.z,
        };
      }
    }
    // Camp/fire/unknown: legal support is the terrain at the saved xz.
    const g = this.heightFn(cp.x, cp.z);
    return { id: cp.id, x: cp.x, y: Number.isFinite(g) ? g : 12, z: cp.z };
  }

  /**
   * Read-only player→target LOS using the same queryWall path as enemy AI.
   * D3: QA snapshot only — never mutates player/enemy state.
   */
  targetVisibility(tx: number, tz: number) {
    const p = this.player;
    const sample = (x: number, z: number) => Boolean(queryWall(x, z, p.y + 0.8, this.solids));
    const blocked = losBlocked(p.x, p.z, tx, tz, sample);
    let blockerId: string | null = null;
    if (blocked) {
      const steps = 6;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const hit = queryWall(p.x + (tx - p.x) * t, p.z + (tz - p.z) * t, p.y + 0.8, this.solids);
        if (hit) {
          blockerId = hit.id;
          break;
        }
      }
    }
    return { blocked, blockerId };
  }

  captureSave(): SaveEnvelope {
    // P0-3: if autosave fires inside a shrine, store the overworld entrance
    // pose — shrine-local coords are not a recoverable overworld spawn.
    const pose =
      this.shrine !== null && this.overworld
        ? {
            x: this.overworld.x,
            y: this.overworld.y,
            z: this.overworld.z,
            yaw: this.overworld.yaw,
            camYaw: this.overworld.yaw,
            hp: this.player.hp,
            heartsMax: this.player.heartsMax,
            staminaMax: this.player.staminaMax,
            arrows: this.arrows,
            amber: this.amber,
            art: this.art,
            spicy: this.player.spicy,
          }
        : {
            x: this.player.x,
            y: this.player.y,
            z: this.player.z,
            yaw: this.player.yaw,
            camYaw: this.cam.yaw,
            hp: this.player.hp,
            heartsMax: this.player.heartsMax,
            staminaMax: this.player.staminaMax,
            arrows: this.arrows,
            amber: this.amber,
            art: this.art,
            spicy: this.player.spicy,
          };
    return {
      ...createDefaultSave(),
      player: pose,
      inventory: {
        weapons: this.weapons,
        meals: this.meals,
        mats: this.mats,
        equippedId: this.equippedId,
        bowId: this.bowId,
      },
      progress: {
        towers: [...this.towersOn],
        shrines: [...this.shrinesOn],
        wisps: [...this.wispsGot],
        chests: [...this.chestsGot],
        orbs: this.orbs,
        bossDead: this.bossDead,
        ruinSolved: this.ruinSolved,
        sealRule: this.sealRule,
        graybox: this.worldKind === "graybox",
      },
      checkpoint: { ...this.spawn },
    };
  }

  save() {
    const result = writeSave(this.storage, this.captureSave());
    if (!result.ok) this.saveError = "进度未能写入（空间或权限）。已留在内存中。";
    else this.saveError = "";
    this.lastSaveAt = this.t;
  }

  tryAutosave() {
    if (this.t - this.lastSaveAt < 1.2) return;
    this.save();
  }

  clearTransients() {
    this.player.invuln = 0;
    this.player.dodgeT = 0;
    this.player.aiming = false;
    this.attack = createAttack();
    this.heldMetal = -1;
    this.bomb = null;
    this.projs = [];
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
    if (this.player.state === "climbing" || this.player.state === "gliding") this.setMove("grounded");
    resetInput();
  }

  setMove(state: MoveState) {
    this.player.state = state;
    this.player.grounded = state === "grounded";
    this.player.climbing = state === "climbing";
    this.player.gliding = state === "gliding";
    this.player.swimming = state === "swimming";
    if (state === "dead") this.mode = "dead";
  }

  pushToast(msg: string) {
    this.toast = msg;
    this.toastT = 3.6;
  }

  lookDir() {
    const cy = this.cam.yaw;
    const cp = this.cam.pitch;
    const horiz = Math.cos(cp);
    return { x: -Math.sin(cy) * horiz, y: -Math.sin(cp) * 0.55, z: -Math.cos(cy) * horiz };
  }

  bodyFwd() {
    return { x: -Math.sin(this.player.yaw), z: -Math.cos(this.player.yaw) };
  }

  nearestTower() {
    const p = this.player;
    let best: (typeof TOWERS)[number] | null = null;
    let bd = 24;
    for (const tw of TOWERS) {
      const d = Math.hypot(p.x - tw.x, p.z - tw.z);
      if (d < bd) {
        bd = d;
        best = tw;
      }
    }
    return best ? { tw: best, d: bd } : null;
  }

  towerShelter() {
    const p = this.player;
    if (p.state === "climbing") return true;
    const n = this.nearestTower();
    if (!n) return false;
    return n.d < 7.4 && p.y > n.tw.y + 0.6;
  }

  faceTower(tw: (typeof TOWERS)[number]) {
    const p = this.player;
    const dx = p.x - tw.x;
    const dz = p.z - tw.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    p.yaw = Math.atan2(dx, dz);
  }

  sealIsOpen() {
    return sealFromProgress({
      towers: [...this.towersOn],
      shrines: [...this.shrinesOn],
      wisps: [...this.wispsGot],
      chests: [...this.chestsGot],
      orbs: this.orbs,
      bossDead: this.bossDead,
      ruinSolved: this.ruinSolved,
      sealRule: this.sealRule,
    });
  }

  enterGraybox() {
    this.worldKind = "graybox";
    this.shrine = null;
    this.player.x = GRAYBOX_RESET.x;
    this.player.z = GRAYBOX_RESET.z;
    this.player.y = GRAYBOX_RESET.y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
    this.setMove("grounded");
    this.rebuildSolids();
    this.spawn = { id: "graybox", x: GRAYBOX_RESET.x, y: GRAYBOX_RESET.y, z: GRAYBOX_RESET.z };
    this.pushToast("灰盒测试场。走跑跳攀滑与镜头在此验收。");
  }

  step(dt: number, a: Actions) {
    const d = Math.min(dt, 0.1);
    this.t += d;
    if (this.mode === "title") {
      this.timeOfDay = this.settings.lockDay ? BENCHMARK_TOD : 0.2 + Math.sin(this.t * 0.07) * 0.04;
      this.cam.yaw = this.t * 0.08;
      this.cam.pitch = 0.28;
      this.cam.dist = 16;
      this.player.x = 16;
      this.player.z = 102;
      this.player.y = this.heightFn(16, 102);
      this.updateCamera(d);
      this.hudAcc += d;
      if (this.hudAcc > 0.08) {
        this.hudAcc = 0;
        this.syncHud();
      }
      return;
    }
    if (this.mode === "ending") {
      this.endingT += d;
      this.updateCamera(d);
      this.syncHud();
      return;
    }
    if (this.mode === "paused" || this.mode === "inventory" || this.mode === "map" || this.mode === "cooking" || this.mode === "dialogue") {
      if (a.pause && this.mode === "paused") this.mode = "playing";
      else if (a.pause) this.mode = "paused";
      if (a.bag && this.mode === "inventory") this.mode = "playing";
      if (a.map && this.mode === "map") this.mode = "playing";
      this.syncHud();
      return;
    }
    if (this.mode === "dead") {
      this.syncHud();
      return;
    }
    if (this.mode !== "playing") {
      this.syncHud();
      return;
    }

    if (a.pause) {
      this.mode = "paused";
      resetInput();
      this.syncHud();
      return;
    }
    if (a.bag) this.mode = "inventory";
    if (a.map) this.mode = "map";
    if (a.artSlot >= 0) this.art = a.artSlot;

    const lookSign = this.settings.invertY ? -1 : 1;
    this.cam.yaw -= a.lookX * LOOK_SENS * this.settings.lookSens;
    this.cam.pitch = clamp(this.cam.pitch + a.lookY * 0.0018 * lookSign * this.settings.lookSens, CAM_PITCH_MIN, CAM_PITCH_MAX);

    this.toastT = Math.max(0, this.toastT - d);
    if (this.toastT <= 0) this.toast = "";
    this.interactLock = Math.max(0, this.interactLock - d);
    this.player.invuln = Math.max(0, this.player.invuln - d);
    this.player.spicy = Math.max(0, this.player.spicy - d);
    this.surveyT = Math.max(0, this.surveyT - d);
    this.gustCd = Math.max(0, this.gustCd - d);
    this.player.dodgeCd = Math.max(0, this.player.dodgeCd - d);
    tickAttack(this.attack, d);
    this.player.attackT = this.attack.phase === "idle" ? 0 : this.attack.t;
    if (!this.settings.lockDay) this.timeOfDay = (this.timeOfDay + d / DAY_SECONDS) % 1;
    else this.timeOfDay = BENCHMARK_TOD;
    this.raining = !this.settings.lockDay && Math.sin(this.timeOfDay * 6.2 + 1.2) > 0.72;

    const fx = -Math.sin(this.cam.yaw);
    const fz = -Math.cos(this.cam.yaw);
    const rx = Math.cos(this.cam.yaw);
    const rz = -Math.sin(this.cam.yaw);
    const wishX = fx * a.moveY + rx * a.moveX;
    const wishZ = fz * a.moveY + rz * a.moveX;
    const wishLen = Math.hypot(wishX, wishZ);

    this.handleInteract(a);
    this.handleLocomotion(d, a, wishX, wishZ, wishLen);
    this.handleCombat(a);
    this.handleArts(a);
    this.updateEnemies(d);
    this.updateProjs(d);
    this.updateMetals(d);
    this.updatePlanks(d);
    if (!this.ruinSolved && this.planksBridge()) {
      this.ruinSolved = true;
      this.pushToast("风桥合拢。回程捷径已开。");
      this.save();
    }
    this.updateIces(d);
    this.updateShrineBlock(d);
    tickGust(this.wind, d);
    this.presentFx(d);
    this.updateCamera(d);
    const w = sampleWind(this.wind, this.player.x, this.player.y, this.player.z, this.t);
    this.windAmt = lerp(this.windAmt, this.player.gliding ? 1 : wishLen * 0.25 + w.strength * 0.04, 1 - Math.exp(-3 * d));
    setWind(this.windAmt);

    this.hudAcc += d;
    if (this.hudAcc > 0.05) {
      this.hudAcc = 0;
      this.syncHud();
    }
  }

  handleLocomotion(dt: number, a: Actions, wishX: number, wishZ: number, wishLen: number) {
    const p = this.player;
    if (a.jump) p.jumpBuf = JUMP_BUFFER;
    else p.jumpBuf = Math.max(0, p.jumpBuf - dt);

    if (p.dodgeT > 0) {
      p.dodgeT -= dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      // i-frames are not wall-clip. 90227 dashed through citadel-wall--11-0
      // and dropped to x≈-11 y≈7.4, then could not bee-line back.
      const resolved = resolveHorizontal(p.x, p.z, p.y, this.solids);
      p.x = resolved.x;
      p.z = resolved.z;
      this.snapVertical(dt);
      if (p.dodgeT <= 0) p.vx *= 0.3;
      return;
    }

    if (a.dodge && p.dodgeCd <= 0 && p.state === "grounded" && p.stamina > DODGE_STAMINA) {
      const len = wishLen > 0.1 ? wishLen : 1;
      // Look facing, not stale body yaw (same defect as look-then-click melee).
      const dx = wishLen > 0.1 ? wishX / len : -Math.sin(this.cam.yaw);
      const dz = wishLen > 0.1 ? wishZ / len : -Math.cos(this.cam.yaw);
      p.vx = dx * DODGE_SPEED;
      p.vz = dz * DODGE_SPEED;
      p.dodgeT = DODGE_TIME;
      p.dodgeCd = DODGE_COOLDOWN;
      p.invuln = Math.max(p.invuln, DODGE_IFRAMES);
      p.stamina -= DODGE_STAMINA;
      return;
    }

    const support = supportY(p.x, p.z, p.y + FOOT_SNAP, this.solids, this.heightFn, this.extraSupports(), null);
    const inWater =
      this.worldKind === "graybox"
        ? Math.hypot(p.x - GRAYBOX_WATER.x, p.z - GRAYBOX_WATER.z) < GRAYBOX_WATER.r && p.y < GRAYBOX_WATER.level + 0.4
        : p.y < WATER_LEVEL - 0.05 && this.shrine === null;

    const nearTw = this.nearestTower();
    if (
      nearTw &&
      nearTw.d < 8 &&
      (isTowerRest(support.id) || inWater || p.state === "swimming" || p.state === "climbing")
    ) {
      this.faceTower(nearTw.tw);
    }
    const fwd = this.bodyFwd();
    let wall = queryWall(p.x + fwd.x * 1.05, p.z + fwd.z * 1.05, p.y, this.solids);
    if ((!wall || !wall.climbable) && nearTw && nearTw.d < TOWER_RADIUS + 3.4) {
      const towardX = (nearTw.tw.x - p.x) / Math.max(0.2, nearTw.d);
      const towardZ = (nearTw.tw.z - p.z) / Math.max(0.2, nearTw.d);
      const probeY = p.y < WATER_LEVEL + 0.8 ? Math.max(p.y, WATER_LEVEL + 0.25) : p.y;
      const hit = queryWall(p.x + towardX * 1.15, p.z + towardZ * 1.15, probeY, this.solids);
      if (hit?.climbable) wall = hit;
    }

    if (p.state === "climbing") {
      const rest = supportY(p.x, p.z, p.y + 0.5, this.solids, this.heightFn, this.extraSupports(), null);
      const wantRest = a.moveY < -0.2 || p.stamina <= 2;
      const nearestRestAtHeight = () => {
        let best: { x: number; y: number; z: number; edge: number } | null = null;
        for (const s of this.solids) {
          if (!s.standable || !isTowerRest(s.id) || s.id.includes("-cap")) continue;
          const top = solidTop(s);
          if (Math.abs(top - p.y) > MANTLE_REACH_Y) continue;
          const c = closestPointOnSolidXZ(s, p.x, p.z);
          const ix = s.x - c.x;
          const iz = s.z - c.z;
          const il = Math.hypot(ix, iz) || 1;
          const inset = Math.min(0.45, il);
          const sx = c.x + (ix / il) * inset;
          const sz = c.z + (iz / il) * inset;
          if (!best || c.dist < best.edge) best = { x: sx, y: top, z: sz, edge: c.dist };
        }
        return best;
      };
      const tryMantle = () => {
        const best = nearestRestAtHeight();
        if (!best || best.edge > MANTLE_REACH_XZ) return false;
        const ox = p.x;
        const oy = p.y;
        const oz = p.z;
        const dx = best.x - p.x;
        const dz = best.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        if (best.edge > 0.008) {
          const step = Math.min(MANTLE_STEP_XZ, len);
          p.x += (dx / len) * step;
          p.z += (dz / len) * step;
        }
        p.y += clamp(best.y - p.y, -MANTLE_STEP_Y, MANTLE_STEP_Y);
        const resolved = resolveHorizontal(p.x, p.z, p.y, this.solids);
        p.x = resolved.x;
        p.z = resolved.z;
        const moved = Math.hypot(p.x - ox, p.z - oz, p.y - oy);
        if (moved > MANTLE_STEP_XZ + MANTLE_STEP_Y + 0.05) {
          p.x = ox;
          p.y = oy;
          p.z = oz;
          return false;
        }
        const landed = supportY(p.x, p.z, p.y + 0.5, this.solids, this.heightFn, this.extraSupports(), null);
        if (isTowerRest(landed.id) && Math.abs(landed.y - p.y) < 0.55) {
          p.y = landed.y;
          p.vy = 0;
          this.setMove("grounded");
          return true;
        }
        if (best.edge <= 0.16 && Math.abs(best.y - p.y) < 0.28) {
          p.x = best.x;
          p.z = best.z;
          p.y = best.y;
          p.vy = 0;
          this.setMove("grounded");
          return true;
        }
        return moved > 0.012;
      };
      const tryShimmy = () => {
        const best = nearestRestAtHeight();
        if (!best || !wall) return false;
        if (best.edge <= MANTLE_REACH_XZ) return tryMantle();
        const ox = p.x;
        const oy = p.y;
        const oz = p.z;
        const tx = best.x - p.x;
        const tz = best.z - p.z;
        const tangent = -wall.nz * tx + wall.nx * tz;
        const dir = tangent >= 0 ? 1 : -1;
        const step = CLIMB_SHIMMY * dt;
        p.x += -wall.nz * dir * step;
        p.z += wall.nx * dir * step;
        p.y += clamp(best.y - p.y, -MANTLE_STEP_Y, MANTLE_STEP_Y);
        const resolved = resolveHorizontal(p.x, p.z, p.y, this.solids);
        p.x = resolved.x;
        p.z = resolved.z;
        const moved = Math.hypot(p.x - ox, p.z - oz, p.y - oy);
        if (moved > step + MANTLE_STEP_Y + 0.08) {
          p.x = ox;
          p.y = oy;
          p.z = oz;
          return false;
        }
        return moved > 0.008;
      };
      if (wantRest && isTowerRest(rest.id) && Math.abs(rest.y - p.y) < 0.85) {
        p.y = rest.y;
        p.vy = 0;
        this.setMove("grounded");
        return;
      }
      if (wantRest && (tryMantle() || tryShimmy())) return;
      // Dodge is an explicit dismount — do not prefer mantle/shimmy while
      // dodging (play-routes KeyC on east wall / tower stuck in climbing).
      if (a.dodge) {
        this.setMove("airborne");
        p.vy = 0.6;
        p.x -= fwd.x * 0.35;
        p.z -= fwd.z * 0.35;
        return;
      }
      if (!wall) {
        if (tryMantle() || tryShimmy()) return;
        this.setMove("airborne");
        p.vy = 0.6;
        p.x -= fwd.x * 0.35;
        p.z -= fwd.z * 0.35;
        return;
      }
      if (p.stamina <= 0) {
        if (tryMantle() || tryShimmy()) return;
        if (isTowerRest(rest.id) && Math.abs(rest.y - p.y) < 0.85) {
          p.y = rest.y;
          this.setMove("grounded");
          return;
        }
        this.setMove("airborne");
        p.vy = 0.2;
        p.x -= fwd.x * 0.3;
        p.z -= fwd.z * 0.3;
        return;
      }
      const up = a.moveY > 0.05 ? 1 : a.moveY < -0.15 ? -0.75 : 0;
      p.y += CLIMB_SPEED * up * dt;
      const side = a.moveX;
      p.x += -wall.nz * side * 2.2 * dt;
      p.z += wall.nx * side * 2.2 * dt;
      const resolved = resolveHorizontal(p.x, p.z, p.y, this.solids);
      p.x = resolved.x;
      p.z = resolved.z;
      if (up > 0.2) p.stamina -= CLIMB_STAMINA * dt;
      else if (up < -0.2) p.stamina -= CLIMB_STAMINA * 0.45 * dt;
      else p.stamina -= CLIMB_STAMINA * 0.22 * dt;
      if (p.y > wall.top - 1.7) {
        p.x -= wall.nx * 2.35;
        p.z -= wall.nz * 2.35;
        p.y = wall.top + 0.18;
        p.vy = 0;
        this.setMove("grounded");
      }
      if (wishLen > 0.15) p.yaw = lerpAng(p.yaw, Math.atan2(-wishX, -wishZ), 1 - Math.exp(-8 * dt));
      return;
    }

    const onCap = TOWERS.some((tw) => Math.hypot(p.x - tw.x, p.z - tw.z) < 5.2 && p.y > tw.y + TOWER_HEIGHT - 2.2);
    const resting = isTowerRest(support.id);
    const wantClimb =
      a.climb ||
      a.interact ||
      (resting && a.moveY > 0.12) ||
      // Lake grab is E/climb. W-only auto-grab trapped the headed route on mere
      // when goTo tried to swim toward crown.
      ((p.state === "swimming" || inWater) && (a.climb || a.interact));
    if (wall?.climbable && p.stamina > 8 && p.state !== "gliding" && wantClimb && !onCap) {
      if (resting || p.state === "swimming" || inWater || !this.nearInteractable()) {
        if (nearTw) this.faceTower(nearTw.tw);
        this.setMove("climbing");
        p.vy = 0;
        p.yaw = Math.atan2(wall.nx, wall.nz);
        if (p.y < WATER_LEVEL - 0.05 && this.shrine === null) p.y = WATER_LEVEL + 0.08;
        return;
      }
    }

    if (inWater && p.state !== "gliding") this.setMove("swimming");

    if (p.state === "swimming") {
      const target = this.worldKind === "graybox" ? GRAYBOX_WATER.level : WATER_LEVEL;
      p.vy += (target - 0.45 - p.y) * 3.2 * dt;
      p.vy *= 0.92;
      this.applyWish(dt, wishX, wishZ, wishLen, SWIM_SPEED, false);
      if (p.jumpBuf > 0) {
        p.vy = 5.2;
        p.jumpBuf = 0;
        this.setMove("airborne");
      }
      if (p.y > target + 0.2) this.setMove("airborne");
      this.integrate(dt, a);
      return;
    }

    if (p.state === "gliding") {
      p.stamina -= GLIDE_STAMINA * dt;
      const w = sampleWind(this.wind, p.x, p.y, p.z, this.t);
      p.vy = lerp(p.vy, GLIDE_SINK + w.updraft * 0.35, 1 - Math.exp(-4 * dt));
      p.vx += w.x * 0.35 * dt;
      p.vz += w.z * 0.35 * dt;
      if (wishLen > 0.08) {
        p.vx += (wishX / wishLen) * GLIDE_TURN * dt;
        p.vz += (wishZ / wishLen) * GLIDE_TURN * dt;
        p.yaw = lerpAng(p.yaw, Math.atan2(-wishX, -wishZ), 1 - Math.exp(-6 * dt));
      }
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > GLIDE_MAX_XZ) {
        p.vx *= GLIDE_MAX_XZ / sp;
        p.vz *= GLIDE_MAX_XZ / sp;
      }
      if (a.jump || p.stamina <= 0) {
        this.setMove("airborne");
        p.jumpBuf = 0;
      }
      this.integrate(dt, a);
      return;
    }

    if (p.state === "grounded") {
      p.coyote = COYOTE_TIME;
      if (a.sprint && p.stamina > 1 && wishLen > 0.2) p.stamina -= SPRINT_STAMINA * dt;
      else p.stamina = Math.min(p.staminaMax, p.stamina + STAMINA_REGEN * dt);
      const speed = a.sprint && p.stamina > 1 && wishLen > 0.2 ? SPRINT_SPEED : WALK_SPEED;
      this.applyWish(dt, wishX, wishZ, wishLen, p.stamina <= 0 ? WALK_SPEED * 0.7 : speed, true);
      if (p.jumpBuf > 0) {
        p.vy = JUMP_VELOCITY;
        p.jumpBuf = 0;
        p.coyote = 0;
        this.setMove("airborne");
        sfx("jump");
      }
      this.integrate(dt, a);
      if (p.y > support.y + FOOT_SNAP) this.setMove("airborne");
      return;
    }

    if (p.state === "airborne") {
      p.coyote = Math.max(0, p.coyote - dt);
      p.vy -= GRAVITY * dt;
      this.applyWish(dt, wishX, wishZ, wishLen, WALK_SPEED * AIR_CONTROL, false);
      if (p.jumpBuf > 0 && p.coyote > 0) {
        p.vy = JUMP_VELOCITY;
        p.jumpBuf = 0;
        p.coyote = 0;
        sfx("jump");
      } else if (a.jump && p.vy < 1.4 && p.stamina > 8) {
        this.setMove("gliding");
        p.jumpBuf = 0;
        sfx("jump");
      }
      this.integrate(dt, a);
    }
  }

  applyWish(dt: number, wishX: number, wishZ: number, wishLen: number, speed: number, brake: boolean) {
    const p = this.player;
    if (wishLen > 0.08 && !p.aiming) {
      const tx = (wishX / Math.max(wishLen, 1)) * speed;
      const tz = (wishZ / Math.max(wishLen, 1)) * speed;
      const k = 1 - Math.exp(-dt / ACCEL_TIME);
      p.vx = lerp(p.vx, tx, k);
      p.vz = lerp(p.vz, tz, k);
      p.yaw = lerpAng(p.yaw, Math.atan2(-wishX, -wishZ), 1 - Math.exp(-12 * dt));
    } else if (p.aiming && wishLen > 0.08) {
      p.vx = (wishX / wishLen) * speed * 0.45;
      p.vz = (wishZ / wishLen) * speed * 0.45;
    } else if (brake) {
      const k = 1 - Math.exp(-dt / BRAKE_TIME);
      p.vx = lerp(p.vx, 0, k);
      p.vz = lerp(p.vz, 0, k);
    }
  }

  integrate(dt: number, a: Actions) {
    const p = this.player;
    const nx = p.x + p.vx * dt;
    const nz = p.z + p.vz * dt;
    const cur = this.surfaceY(p.x, p.z, p.y + STEP_UP);
    const next = this.surfaceY(nx, nz, p.y + STEP_UP);
    const wallAhead = queryWall(nx, nz, p.y + 0.4, this.solids);
    if (wallAhead && next > p.y + STEP_UP + 0.4) {
      const hx = this.surfaceY(nx, p.z, p.y + STEP_UP);
      const hz = this.surfaceY(p.x, nz, p.y + STEP_UP);
      if (hx <= p.y + STEP_UP) p.x = nx;
      else p.vx = 0;
      if (hz <= p.y + STEP_UP) p.z = nz;
      else p.vz = 0;
    } else {
      p.x = nx;
      p.z = nz;
    }
    const resolved = resolveHorizontal(p.x, p.z, p.y, this.solids, PLAYER_RADIUS);
    p.x = resolved.x;
    p.z = resolved.z;
    this.snapVertical(dt);
    if (this.shrine !== null) {
      const o = shrineWorldOrigin(this.shrine);
      p.x = clamp(p.x, o.x - 9.2, o.x + 9.2);
      p.z = clamp(p.z, o.z + 0.8, o.z + 26);
    } else if (this.worldKind !== "graybox") {
      const lim = WORLD_SIZE * 0.48;
      p.x = clamp(p.x, -lim, lim);
      p.z = clamp(p.z, -lim, lim);
      if (p.y < WATER_LEVEL - 14 && p.state !== "swimming") this.die("沉入深海");
    }
    const climate =
      this.worldKind === "overworld" && this.shrine === null && !this.towerShelter() ? climateAt(p.x, p.z, p.y) : "temperate";
    p.cold = climate === "frost" && p.spicy <= 0;
    if (p.cold) {
      this.coldAcc += dt;
      if (this.coldAcc > 3.2) {
        this.coldAcc = 0;
        this.hurt(0.25, "严寒");
        this.pushToast("太冷了。烤火棘椒可以驱寒。");
      }
    } else this.coldAcc = 0;
    if (wishStep(a) && p.grounded) {
      this.stepAcc += dt * (a.sprint ? 1.6 : 1);
      if (this.stepAcc > 0.38) {
        this.stepAcc = 0;
        sfx("step");
      }
    }
    void cur;
  }

  snapVertical(dt: number) {
    const p = this.player;
    p.y += p.vy * dt;
    const g = this.surfaceY(p.x, p.z, p.y + FOOT_SNAP);
    if (p.y <= g) {
      if (!p.grounded && p.vy < -15) this.hurt(p.vy < -22 ? 1.5 : 0.75, "坠落");
      if (!p.grounded && p.vy < -4) this.burst(p.x, g + 0.1, p.z, 6, 0.45, 0.4, 0.32, 0.8);
      p.y = g;
      p.vy = 0;
      if (p.state === "airborne" || p.state === "gliding" || p.state === "climbing") this.setMove("grounded");
    } else if (p.state === "grounded") {
      this.setMove("airborne");
    }
  }

  nearInteractable() {
    const p = this.player;
    if (this.shrine !== null) {
      const o = shrineWorldOrigin(this.shrine);
      if (Math.hypot(p.x - o.x, p.z - (o.z + 23)) < 2.2) return true;
      if (p.z < o.z + 3.2) return true;
      return false;
    }
    for (const tw of TOWERS) if (Math.hypot(p.x - tw.x, p.z - tw.z) < 5.2 && p.y > tw.y + TOWER_HEIGHT - 2.2) return true;
    for (const s of SHRINES) if (Math.hypot(p.x - s.x, p.z - s.z) < 3.2) return true;
    if (Math.hypot(p.x - SAGE.x, p.z - SAGE.z) < 2.4) return true;
    for (const f of FIRES) if (Math.hypot(p.x - f.x, p.z - f.z) < 2.1) return true;
    for (const c of CHESTS) if (!this.chestsGot.has(c.id) && Math.hypot(p.x - c.x, p.z - c.z) < 1.8) return true;
    return false;
  }

  handleCombat(a: Actions) {
    const p = this.player;
    const melee = this.weapons.find((w) => w.id === this.equippedId && w.kind !== "bow") ?? this.weapons.find((w) => w.kind !== "bow") ?? null;
    const bow = this.weapons.find((w) => w.id === this.bowId && w.kind === "bow") ?? this.weapons.find((w) => w.kind === "bow") ?? null;
    p.aiming = a.bow && Boolean(bow);

    if (a.attack && p.aiming && bow) {
      if (this.arrows <= 0) this.pushToast("没有箭矢");
      else {
        const look = this.lookDir();
        this.arrows -= 1;
        this.projs.push({
          x: p.x + look.x * 0.8,
          y: p.y + 1.35,
          z: p.z + look.z * 0.8,
          vx: look.x * 38,
          vy: look.y * 38 + 2,
          vz: look.z * 38,
          life: 2.2,
          kind: "arrow",
          dmg: 1.4,
        });
        sfx("bow");
      }
      return;
    }

    if (a.attack && !p.aiming && melee) {
      const heavy = melee.kind === "claymore";
      if (startAttack(this.attack, heavy)) {
        // Swing faces the camera. Body yaw only lerps while walking, so a
        // look-then-click would otherwise miss with a stale rear-facing body.
        p.yaw = this.cam.yaw;
        sfx("swing");
      }
    }

    if (this.attack.phase === "active" && melee) {
      const rangeBoost = melee.kind === "claymore" ? 0.4 : 0;
      const faceYaw = this.cam.yaw;
      for (const e of this.enemies) {
        if (!e.alive || this.attack.hit.has(e.id)) continue;
        if (e.kind === "boss" && !this.sealIsOpen()) continue;
        if (!meleeHit(p.x, p.y, p.z, faceYaw, e.x, e.y, e.z, rangeBoost + (e.kind === "boss" ? 0.6 : 0))) continue;
        if (losBlocked(p.x, p.z, e.x, e.z, (x, z) => Boolean(queryWall(x, z, (p.y + e.y) * 0.5, this.solids)))) continue;
        this.attack.hit.add(e.id);
        this.damageEnemy(e, melee.dmg / 10 + (e.frozen > 0 ? 1.6 : 0), -Math.sin(faceYaw), -Math.cos(faceYaw));
        melee.dur -= 1;
        this.cam.trauma = Math.min(1, this.cam.trauma + 0.28 * this.settings.shake);
        sfx("hit");
        if (melee.dur <= 0) {
          this.pushToast(`${melee.name} 损坏了`);
          this.weapons = this.weapons.filter((w) => w.id !== melee.id);
          const ids = resolveWeaponIds(this.weapons, this.equippedId, this.bowId);
          this.equippedId = ids.equippedId;
          this.bowId = ids.bowId;
        }
      }
    }
  }

  handleArts(a: Actions) {
    if (!a.art) return;
    const p = this.player;
    const look = this.lookDir();
    if (this.art === 0) {
      if (this.gustCd > 0 || p.stamina < GUST_STAMINA) {
        this.pushToast(this.gustCd > 0 ? "引风尚未就绪" : "耐力不足");
        return;
      }
      const fx = -Math.sin(this.cam.yaw);
      const fz = -Math.cos(this.cam.yaw);
      this.wind.gust = {
        ox: p.x,
        oy: p.y + 1.1,
        oz: p.z,
        dx: fx,
        dy: 0.04,
        dz: fz,
        radius: GUST_RADIUS,
        strength: GUST_STRENGTH,
        t: GUST_DURATION,
        max: GUST_DURATION,
      };
      this.gustCd = GUST_COOLDOWN;
      p.stamina -= GUST_STAMINA;
      this.burst(p.x + look.x, p.y + 1, p.z + look.z, 16, 0.7, 0.85, 0.9, 2.2);
      sfx("ui");
      this.hintOnce("wind", "风会推动轻物，也能托起滑翔。隔墙无效。");
      return;
    }
    if (this.art === 1) {
      if (!this.bomb) {
        this.bomb = { x: p.x + look.x * 2.2, y: p.y + 0.7, z: p.z + look.z * 2.2 };
        this.pushToast("爆鸣已放置。再按使用以引爆。");
      } else {
        this.explode(this.bomb.x, this.bomb.y, this.bomb.z);
        this.bomb = null;
      }
    } else if (this.art === 2) {
      const tx = p.x + look.x * 4.5;
      const tz = p.z + look.z * 4.5;
      const hy = this.surfaceY(tx, tz, p.y);
      const wet = this.shrine !== null ? hy < shrineWorldOrigin(this.shrine!).y - 1 : hy < WATER_LEVEL + 0.4;
      if (wet || this.shrine !== null) {
        const y = this.shrine !== null ? shrineWorldOrigin(this.shrine).y - 4.6 : WATER_LEVEL;
        this.ices.push({ x: tx, y, z: tz, life: 40 });
        if (this.ices.length > 6) this.ices.shift();
        sfx("ui");
      } else this.pushToast("霜息需要水面。");
    } else if (this.art === 3) {
      if (this.heldMetal >= 0) {
        const m = this.metals[this.heldMetal]!;
        m.held = false;
        m.vx = look.x * 16;
        m.vy = 4;
        m.vz = look.z * 16;
        this.heldMetal = -1;
      } else {
        let best = -1;
        let bd = 18;
        for (let i = 0; i < this.metals.length; i++) {
          const m = this.metals[i]!;
          const d = Math.hypot(m.x - p.x, m.z - p.z, m.y - p.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (best >= 0) {
          this.heldMetal = best;
          this.metals[best]!.held = true;
        } else this.pushToast("附近没有金属。");
      }
    } else if (this.art === 4) {
      let best: Enemy | null = null;
      let bd = 16;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best) {
        best.frozen = 4.2;
        this.pushToast("凝时：目标已冻结");
        sfx("ui");
      } else if (this.shrine !== null && SHRINES[this.shrine]?.puzzle === "still") {
        this.moveBlock.frozen = 4.5;
        this.pushToast("石块时间已凝固");
      } else this.pushToast("附近没有可凝之物。");
    }
  }

  hintOnce(id: string, msg: string) {
    if (this.tutorialSeen.has(id)) return;
    this.tutorialSeen.add(id);
    this.tutorial = msg;
    this.pushToast(msg);
  }

  explode(x: number, y: number, z: number) {
    sfx("explode");
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.7 * this.settings.shake);
    this.burst(x, y, z, 28, 1, 0.45, 0.2, 1.6);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.y - y, e.z - z);
      if (d < 6) this.damageEnemy(e, 2.4, (e.x - x) / (d || 1), (e.z - z) / (d || 1));
    }
    if (this.shrine !== null && SHRINES[this.shrine]?.puzzle === "burst") {
      const o = shrineWorldOrigin(this.shrine);
      if (Math.hypot(x - o.x, z - (o.z + 12.4)) < 5) {
        this.crackedBroken[this.shrine] = true;
        this.rebuildSolids();
        this.pushToast("岩壁碎裂了");
      }
    }
  }

  handleInteract(a: Actions) {
    this.prompt = "";
    this.shrineHint = "";
    if (this.interactLock > 0) return;
    const p = this.player;

    if (this.worldKind === "graybox") {
      this.prompt = "灰盒 · 互动重置";
      if (a.interact) {
        p.x = GRAYBOX_RESET.x;
        p.z = GRAYBOX_RESET.z;
        p.y = GRAYBOX_RESET.y;
      }
      return;
    }

    if (this.shrine !== null) {
      const o = shrineWorldOrigin(this.shrine);
      const shrine = SHRINES[this.shrine]!;
      this.shrineHint = shrine.hint || "";
      const altarZ = o.z + 23;
      if (Math.hypot(p.x - o.x, p.z - altarZ) < 2.2) {
        this.prompt = this.shrinesOn.has(shrine.id) ? "离开灵祠" : "领取灵核";
        if (a.interact) {
          if (!this.shrinesOn.has(shrine.id)) {
            this.shrinesOn.add(shrine.id);
            this.orbs += 1;
            this.player.hp = this.player.heartsMax;
            sfx("orb");
            this.pushToast(`获得灵核（${this.orbs}/4）`);
            if (this.orbs >= 4) {
              this.player.heartsMax = Math.min(8, this.player.heartsMax + 1);
              this.player.hp = this.player.heartsMax;
              if (this.towersOn.size >= 3) this.pushToast("三塔与四祠已齐。残堡封印打开。");
              else this.pushToast("四枚灵核已齐。还须点亮三座天瞭塔。");
            }
          }
          this.exitShrine();
        }
        return;
      }
      if (p.z < o.z + 3.2) {
        this.prompt = "离开灵祠";
        if (a.interact) this.exitShrine();
      }
      return;
    }

    for (const tw of TOWERS) {
      const d = Math.hypot(p.x - tw.x, p.z - tw.z);
      const onTop = d < 5.2 && p.y > tw.y + TOWER_HEIGHT - 2.2;
      if (onTop) {
        this.prompt = this.towersOn.has(tw.id) ? `${tw.name}已点亮` : `启动 ${tw.name}`;
        if (a.interact && !this.towersOn.has(tw.id)) {
          this.towersOn.add(tw.id);
          this.surveyT = 2.4;
          this.spawn = { id: `tower-${tw.id}`, x: p.x, y: p.y, z: p.z };
          sfx("tower");
          this.pushToast(`${tw.name} 点亮了这片土地`);
          this.save();
        }
        return;
      }
    }

    for (let i = 0; i < SHRINES.length; i++) {
      const s = SHRINES[i]!;
      if (Math.hypot(p.x - s.x, p.z - s.z) < 4.2 && Math.abs(p.y - s.y) < 8) {
        this.prompt = this.shrinesOn.has(s.id) ? `进入 ${s.name}` : `叩响 ${s.name}`;
        if (a.interact) this.enterShrine(i);
        return;
      }
    }

    if (Math.hypot(p.x - SAGE.x, p.z - SAGE.z) < 2.4) {
      this.prompt = "与守塔人交谈";
      if (a.interact) {
        this.mode = "dialogue";
        this.dialogue =
          "风醒者。登上三座天瞭塔，集齐四枚灵核，残堡封印才会打开。对着峭壁按互动攀爬，空中再按跳跃滑翔。石板现有五术：引风、爆鸣、霜息、牵引、凝时。";
      }
      return;
    }

    for (const f of FIRES) {
      if (Math.hypot(p.x - f.x, p.z - f.z) < 2.1) {
        this.prompt = "在篝火烹饪 / 休息";
        if (a.interact) {
          this.mode = "cooking";
          this.player.hp = this.player.heartsMax;
          this.spawn = { id: f.id, x: p.x, y: p.y, z: p.z };
          this.save();
        }
        return;
      }
    }

    for (const c of CHESTS) {
      if (this.chestsGot.has(c.id)) continue;
      if (Math.hypot(p.x - c.x, p.z - c.z) < 1.8) {
        this.prompt = "打开容器";
        if (a.interact) {
          this.chestsGot.add(c.id);
          if (c.id === "chest-start") {
            this.weapons.push(weapon("clay", "野木阔刀", 32, 14, "claymore"));
            this.pushToast("获得 野木阔刀");
          } else {
            this.arrows += 10;
            this.amber += 15;
            this.mats.meat = (this.mats.meat || 0) + 1;
            this.pushToast("获得箭矢、琥珀与兽肉");
          }
          sfx("pickup");
          this.save();
        }
        return;
      }
    }

    for (const w of WISPS) {
      if (this.wispsGot.has(w.id)) continue;
      if (Math.hypot(p.x - w.x, p.z - w.z) < 1.6) {
        this.prompt = "收集风之种";
        if (a.interact || Math.hypot(p.x - w.x, p.z - w.z) < 1.05) {
          this.wispsGot.add(w.id);
          this.player.staminaMax += WISP_STAMINA;
          this.player.stamina = this.player.staminaMax;
          this.amber += 8;
          sfx("pickup");
          this.pushToast(`风之种 ${this.wispsGot.size}/8  · 耐力提升`);
          this.save();
        }
        return;
      }
    }

    const ruinX = WIND_RUIN.x;
    const ruinZ = WIND_RUIN.z;
    const sideX = ruinX + 6.4;
    const sideZ = ruinZ - 3.2;
    if (!this.ruinSolved && Math.hypot(p.x - sideX, p.z - sideZ) < 2.4 && p.y > this.heightFn(ruinX, ruinZ) + 3.4) {
      this.ruinSolved = true;
      this.pushToast("从侧翼高台进入。回程捷径已开。");
      this.save();
    }
    if (Math.hypot(p.x - ruinX, p.z - ruinZ) < 6) {
      const lost = this.planks.some((pl) => Math.hypot(pl.x - pl.homeX, pl.z - pl.homeZ) > 18 || pl.y < this.heightFn(pl.x, pl.z) - 6);
      if (lost) {
        this.prompt = "复位风桥构件";
        if (a.interact) {
          this.planks = makeWindPlanks();
          this.pushToast("构件回到了原位。进度保留。");
        }
        return;
      }
      if (!this.ruinSolved && this.planksBridge()) {
        this.ruinSolved = true;
        this.pushToast("风桥合拢。回程捷径已开。");
        this.save();
      }
    }

    if (this.sealIsOpen() && Math.hypot(p.x - CITADEL_POI.x, p.z - CITADEL_POI.z) < 14) {
      this.prompt = this.bossDead ? "残堡已沉寂" : "挑战空王";
    } else if (!this.sealIsOpen() && Math.hypot(p.x - CITADEL_POI.x, p.z - CITADEL_POI.z) < 18) {
      this.prompt = `封印未开（塔 ${this.towersOn.size}/3 · 祠 ${this.shrinesOn.size}/4）`;
      const dx = p.x - CITADEL_POI.x;
      const dz = p.z - CITADEL_POI.z;
      const dist = Math.hypot(dx, dz) || 1;
      if (dist < 13) {
        p.x = CITADEL_POI.x + (dx / dist) * 13.2;
        p.z = CITADEL_POI.z + (dz / dist) * 13.2;
      }
    }

    for (const pk of this.pickups) {
      if (!pk.live) continue;
      if (Math.hypot(p.x - pk.x, p.z - pk.z) < 1.3) {
        pk.live = false;
        if (pk.kind === "apple") this.mats.apple = (this.mats.apple || 0) + 1;
        if (pk.kind === "pepper") this.mats.pepper = (this.mats.pepper || 0) + 1;
        if (pk.kind === "meat") this.mats.meat = (this.mats.meat || 0) + 1;
        if (pk.kind === "amber") this.amber += 5;
        if (pk.kind === "heart") p.hp = Math.min(p.heartsMax, p.hp + 1);
        sfx("pickup");
      }
    }
  }

  planksBridge() {
    const target = { x: 28, z: 74 };
    return this.planks.every((p) => Math.hypot(p.x - target.x, p.z - target.z) < 4.2);
  }

  dockSolvedPlanks() {
    const targetX = 28;
    const targetZ = 74;
    for (const p of this.planks) {
      p.x = targetX;
      p.z = targetZ;
      p.y = this.heightFn(p.x, p.z) + 0.4;
    }
  }

  enterShrine(i: number) {
    this.overworld = { x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.player.yaw };
    this.shrine = i;
    this.worldKind = "shrine";
    const o = shrineWorldOrigin(i);
    this.player.x = o.x;
    this.player.z = o.z + 4.4;
    this.player.y = o.y + 0.1;
    this.player.yaw = Math.PI;
    this.cam.yaw = Math.PI;
    this.clearTransients();
    this.interactLock = 0.85;
    this.metals = this.metals.filter((m) => !m.id.startsWith("metal-shrine"));
    this.metals.push({ id: `metal-shrine-${i}`, x: o.x + 6.2, y: o.y + 0.5, z: o.z + 8, held: false, vx: 0, vy: 0, vz: 0 });
    this.moveBlock.t = 0;
    this.moveBlock.frozen = 0;
    this.moveBlock.x = o.x;
    this.moveBlock.z = o.z + STILL_BLOCK.zOff;
    this.rebuildSolids();
    this.pushToast(SHRINES[i]?.hint || "解开灵祠");
    sfx("ui");
  }

  exitShrine() {
    this.shrine = null;
    this.worldKind = "overworld";
    this.player.x = this.overworld.x;
    this.player.z = this.overworld.z;
    this.player.y = this.overworld.y + 0.4;
    this.player.yaw = this.overworld.yaw;
    this.ices = [];
    this.metals = this.metals.filter((m) => !m.id.startsWith("metal-shrine"));
    this.heldMetal = -1;
    this.interactLock = 0.5;
    this.rebuildSolids();
    this.clearTransients();
    this.save();
  }

  updateEnemies(dt: number) {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) {
        e.brain.phase = "dead";
        continue;
      }
      e.flash = Math.max(0, e.flash - dt);
      e.hurt = Math.max(0, e.hurt - dt);
      e.telegraph = Math.max(0, e.telegraph - dt);
      if (e.frozen > 0) {
        e.frozen -= dt;
        continue;
      }
      e.y = this.surfaceY(e.x, e.z, e.y + 1);
      if (e.kind === "boss" && !this.sealIsOpen()) continue;
      // Review20: pre-move arena clamp. Never snap-teleport the boss home —
      // that is a visible pop and is not a legal clear. If already off the
      // courtyard (north gap / low west), walk back at approach speed.
      let bossOffArena = false;
      if (e.kind === "boss" && e.alive && this.sealIsOpen()) {
        const floorY = heightAt(CITADEL_POI.x, CITADEL_POI.z + 7.2);
        const westBound = CITADEL_POI.x - 10.5;
        const eastBound = CITADEL_POI.x + 11.5;
        const northBound = CITADEL_POI.z + 13.5;
        const southBound = CITADEL_POI.z - 3;
        bossOffArena =
          e.x < westBound ||
          e.x > eastBound ||
          e.z > northBound ||
          e.z < southBound ||
          e.y < floorY - 2.8;
        if (bossOffArena) {
          // Bee-line home hits the west wall. Walk north past the wall end
          // (z ≈ POI.z-1), then east through the +Z gate gap. No teleport.
          let homeX = CITADEL_POI.x;
          let homeZ = CITADEL_POI.z + 7.2;
          if (e.x < CITADEL_POI.x - 4.5) {
            if (e.z < CITADEL_POI.z + 2.5) {
              // Pure north along the west of the wall until past its north end.
              homeX = e.x;
              homeZ = CITADEL_POI.z + 5;
            } else {
              homeX = CITADEL_POI.x;
              homeZ = CITADEL_POI.z + 8.5;
            }
          }
          const hx = homeX - e.x;
          const hz = homeZ - e.z;
          const hd = Math.hypot(hx, hz) || 1;
          const step = 3.2 * dt;
          const nx = e.x + (hx / hd) * step;
          const nz = e.z + (hz / hd) * step;
          const wall = queryWall(nx, nz, e.y, this.solids);
          if (!wall) {
            e.x = nx;
            e.z = nz;
          } else {
            // Overlapping the west wall: slide out, then next tick walks north.
            const r = resolveHorizontal(e.x, e.z, e.y + 0.5, this.solids, 0.7);
            e.x = r.x;
            e.z = r.z;
          }
          e.y = this.surfaceY(e.x, e.z, e.y + 1);
          // P0-1: off-arena walk-home must not steal an in-flight chain.
          const offBrain = e.brain.phase;
          if (offBrain === "windup") {
            e.brain.t -= dt;
            if (e.brain.t <= 0) {
              e.brain.phase = "strike";
              e.brain.t = 0.18;
            }
          } else if (offBrain === "strike") {
            e.brain.phase = "recover";
            e.brain.t = e.kind === "boss" ? 1.1 : 0.7;
          } else if (offBrain === "recover") {
            e.brain.t -= dt;
            if (e.brain.t <= 0) e.brain.phase = "approach";
          } else if (offBrain !== "dead" && offBrain !== "hurt") {
            e.brain.phase = "approach";
          }
          continue;
        }
      }
      if (this.shrine !== null) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const dist = Math.hypot(dx, dz);
      const aggro = e.kind === "boss" ? 28 : e.kind === "sentinel" ? 22 : 14;
      const blocked = losBlocked(e.x, e.z, p.x, p.z, (x, z) => Boolean(queryWall(x, z, e.y + 0.8, this.solids)));
      const dy = Math.abs(p.y - e.y);
      e.timer -= dt;
      const brain = e.brain;
      if (brain.phase === "hurt") {
        // Clear exit rule: hurt ends → approach if still in aggro LOS, else lost.
        if (e.hurt <= 0) brain.phase = dist < aggro && !blocked ? "approach" : "lost";
        continue;
      }
      const inChain =
        brain.phase === "windup" || brain.phase === "strike" || brain.phase === "recover";
      // P0-1 leave-field rule: an in-flight attack chain always finishes its
      // own timer. Distance, LOS, dy, or off-arena walk-home must not steal
      // or freeze recover. Strike may miss; recover still ends → approach.
      if (inChain) {
        if (brain.phase === "windup") {
          brain.t -= dt;
          if (brain.t <= 0) {
            brain.phase = "strike";
            brain.t = 0.18;
          }
        } else if (brain.phase === "strike") {
          // Chain continues even if LOS breaks; the hit itself still needs a
          // clear line so a wall cannot deal damage through geometry.
          if (!blocked && dist < (e.kind === "boss" ? 3.8 : 2.1) && dy < 2.2) {
            this.hurt(e.kind === "boss" ? 1.25 : e.kind === "sentinel" ? 1 : 0.5, e.kind === "boss" ? "空王" : "敌人");
            this.cam.trauma = Math.min(1, this.cam.trauma + 0.4 * this.settings.shake);
          }
          brain.phase = "recover";
          brain.t = e.kind === "boss" ? 1.1 : 0.7;
        } else {
          brain.t -= dt;
          if (brain.t <= 0) brain.phase = "approach";
        }
        continue;
      }
      if (dist < aggro && !blocked && dy < 4.5) {
        e.yaw = Math.atan2(-dx, -dz);
        if (brain.phase === "patrol" || brain.phase === "lost") {
          brain.phase = "detect";
          brain.t = 0.35;
        }
        if (brain.phase === "detect") {
          brain.t -= dt;
          if (brain.t <= 0) brain.phase = "approach";
          continue;
        }
        const meleeR = e.kind === "boss" ? 3.4 : 1.7;
        if (dist > meleeR) {
          brain.phase = "approach";
          const sp = e.kind === "boss" ? 3.2 : e.kind === "sentinel" ? 2.1 : 4.4;
          let nx = e.x + (dx / dist) * sp * dt;
          let nz = e.z + (dz / dist) * sp * dt;
          if (e.kind === "boss") {
            const westBound = CITADEL_POI.x - 10.5;
            const eastBound = CITADEL_POI.x + 11.5;
            const northBound = CITADEL_POI.z + 13.5;
            const southBound = CITADEL_POI.z - 3;
            nx = Math.min(eastBound, Math.max(westBound, nx));
            nz = Math.min(northBound, Math.max(southBound, nz));
          }
          const wall = queryWall(nx, nz, e.y, this.solids);
          if (!wall) {
            e.x = nx;
            e.z = nz;
          }
          if (e.kind === "sentinel" && e.timer <= 0 && dist > 4) {
            e.timer = 2.4;
            e.telegraph = 0.4;
            brain.phase = "windup";
          }
          if (e.kind === "boss" && e.hp < e.max * 0.5 && e.timer <= 0 && dist > 5) {
            e.timer = 1.6;
            const inv = 1 / dist;
            this.projs.push({ x: e.x, y: e.y + 2.2, z: e.z, vx: dx * inv * 14, vy: 0.2, vz: dz * inv * 14, life: 2, kind: "beam", dmg: 1 });
          }
        } else {
          brain.phase = "windup";
          brain.t = e.kind === "boss" ? 0.7 : 0.45;
          e.telegraph = brain.t;
        }
      } else if (e.kind !== "boss") {
        brain.phase = dist > aggro + 4 ? "lost" : "patrol";
        if (brain.phase === "lost" || brain.phase === "patrol") {
          const hx = e.homeX - e.x;
          const hz = e.homeZ - e.z;
          const hd = Math.hypot(hx, hz);
          if (hd > 0.4) {
            e.x += (hx / hd) * 1.6 * dt;
            e.z += (hz / hd) * 1.6 * dt;
          } else {
            e.x += Math.sin(this.t + e.x) * 0.5 * dt;
            e.z += Math.cos(this.t + e.z) * 0.5 * dt;
          }
        }
      }
    }
  }

  updateProjs(dt: number) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const q = this.projs[i]!;
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      if (q.kind === "arrow") q.vy -= 18 * dt;
      const gy = this.surfaceY(q.x, q.z, q.y);
      const wall = queryWall(q.x, q.z, q.y, this.solids, 0.08);
      if (q.y < gy || q.life <= 0 || wall) {
        this.projs.splice(i, 1);
        continue;
      }
      if (q.kind === "arrow") {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (e.kind === "boss" && !this.sealIsOpen()) continue;
          if (Math.hypot(e.x - q.x, e.y + 0.8 - q.y, e.z - q.z) < 1.1) {
            this.damageEnemy(e, q.dmg, q.vx, q.vz);
            this.projs.splice(i, 1);
            break;
          }
        }
      } else {
        const p = this.player;
        if (Math.hypot(p.x - q.x, p.y + 1 - q.y, p.z - q.z) < 0.9) {
          this.hurt(q.dmg, "射线");
          this.projs.splice(i, 1);
        }
      }
    }
  }

  updateMetals(dt: number) {
    const look = this.lookDir();
    for (let i = 0; i < this.metals.length; i++) {
      const m = this.metals[i]!;
      if (m.held) {
        m.x = this.player.x + look.x * 2.4;
        m.y = this.player.y + 1.3;
        m.z = this.player.z + look.z * 2.4;
        m.vx = 0;
        m.vy = 0;
        m.vz = 0;
      } else {
        m.vy -= 18 * dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.z += m.vz * dt;
        m.vx *= 0.98;
        m.vz *= 0.98;
        const g = this.surfaceY(m.x, m.z, m.y + 1, m.id);
        if (m.y < g + 0.45) {
          m.y = g + 0.45;
          m.vy = 0;
        }
      }
    }
  }

  updatePlanks(dt: number) {
    const w = this.wind;
    if (!w.gust) return;
    const dock = WIND_RUIN;
    for (const p of this.planks) {
      const s = sampleWind(w, p.x, p.y + 0.8, p.z, this.t);
      const toDockX = dock.x - p.x;
      const toDockZ = dock.z - p.z;
      const dockDist = Math.hypot(toDockX, toDockZ) || 1;
      const inPulse = Math.hypot(p.x - w.gust.ox, p.z - w.gust.oz) < w.gust.radius;
      if (!inPulse && Math.hypot(s.x, s.z) < 0.2) continue;
      p.x += (s.x * 1.35 + (toDockX / dockDist) * 4.8) * dt;
      p.z += (s.z * 1.35 + (toDockZ / dockDist) * 4.8) * dt;
      p.y = this.heightFn(p.x, p.z) + 0.4;
    }
  }

  updateIces(dt: number) {
    for (let i = this.ices.length - 1; i >= 0; i--) {
      this.ices[i]!.life -= dt;
      if (this.ices[i]!.life <= 0) this.ices.splice(i, 1);
    }
  }

  updateShrineBlock(dt: number) {
    if (this.shrine === null || SHRINES[this.shrine]?.puzzle !== "still") return;
    const o = shrineWorldOrigin(this.shrine);
    if (this.moveBlock.frozen > 0) this.moveBlock.frozen -= dt;
    else this.moveBlock.t += dt;
    this.moveBlock.x = o.x + Math.sin(this.moveBlock.t * STILL_BLOCK.omega) * STILL_BLOCK.xAmp;
    this.moveBlock.z = o.z + STILL_BLOCK.zOff;
    const slab = this.solids.find((s) => s.id === "move-block");
    if (slab) {
      slab.x = this.moveBlock.x;
      slab.z = this.moveBlock.z;
    }
  }

  damageEnemy(e: Enemy, dmg: number, kx: number, kz: number) {
    if (!e.alive) return;
    if (e.kind === "boss" && !this.sealIsOpen()) return;
    e.hp -= dmg;
    e.flash = 0.15;
    e.hurt = 0.3;
    e.brain.phase = "hurt";
    const l = Math.hypot(kx, kz) || 1;
    e.x += (kx / l) * 1.1;
    e.z += (kz / l) * 1.1;
    const pushed = resolveHorizontal(e.x, e.z, e.y + 0.5, this.solids, e.kind === "boss" ? 0.7 : 0.4);
    e.x = pushed.x;
    e.z = pushed.z;
    // Review20: knockback must not shove the boss through the north gap.
    if (e.kind === "boss") {
      const westBound = CITADEL_POI.x - 10.5;
      const eastBound = CITADEL_POI.x + 11.5;
      const northBound = CITADEL_POI.z + 13.5;
      const southBound = CITADEL_POI.z - 3;
      e.x = Math.min(eastBound, Math.max(westBound, e.x));
      e.z = Math.min(northBound, Math.max(southBound, e.z));
    }
    this.burst(e.x, e.y + 1, e.z, 8, 1, 0.35, 0.2, 1);
    if (e.hp <= 0) {
      e.alive = false;
      e.brain.phase = "dead";
      if (!e.brain.rewarded) {
        e.brain.rewarded = true;
        sfx("hit");
        this.amber += e.kind === "boss" ? 80 : e.kind === "sentinel" ? 20 : 8;
        this.pickups.push({ id: `drop-${e.id}`, kind: e.kind === "boss" ? "heart" : "meat", x: e.x, y: e.y + 0.5, z: e.z, live: true });
      }
      if (e.kind === "boss") {
        this.bossDead = true;
        this.mode = "ending";
        this.endingT = 0;
        this.save();
      }
    }
  }

  hurt(amount: number, _why: string) {
    const p = this.player;
    if (p.invuln > 0 || this.mode !== "playing") return;
    p.hp -= amount;
    p.invuln = 0.9;
    sfx("hurt");
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.45 * this.settings.shake);
    if (p.hp <= 0) this.die("力竭");
  }

  die(_why: string) {
    this.setMove("dead");
    this.player.hp = 0;
    this.pushToast("你倒下了");
    this.syncHud();
  }

  respawn() {
    this.mode = "playing";
    this.player.x = this.spawn.x;
    this.player.z = this.spawn.z;
    this.player.y = this.heightFn(this.spawn.x, this.spawn.z) + 0.2;
    this.player.hp = this.player.heartsMax;
    this.player.stamina = this.player.staminaMax;
    this.shrine = null;
    this.worldKind = this.spawn.id === "graybox" ? "graybox" : "overworld";
    this.rebuildSolids();
    this.clearTransients();
    this.setMove("grounded");
    this.syncHud();
  }

  cook(matId: string) {
    const n = this.mats[matId] || 0;
    if (n <= 0) return;
    this.mats[matId] = n - 1;
    if (matId === "pepper") this.meals.push({ id: `m-${this.t}`, name: "辣炒椒", hearts: 2, spicy: true });
    else if (matId === "meat") this.meals.push({ id: `m-${this.t}`, name: "烤肉", hearts: 3 });
    else this.meals.push({ id: `m-${this.t}`, name: "烤苹果", hearts: 1.5 });
    sfx("cook");
    this.pushToast("烹饪完成");
  }

  eat(id: string) {
    const i = this.meals.findIndex((m) => m.id === id);
    if (i < 0) return;
    const m = this.meals[i]!;
    this.meals.splice(i, 1);
    this.player.hp = Math.min(this.player.heartsMax, this.player.hp + m.hearts);
    if (m.spicy) this.player.spicy = 90;
    sfx("pickup");
  }

  closeOverlay() {
    if (this.mode === "dialogue" || this.mode === "cooking" || this.mode === "inventory" || this.mode === "map" || this.mode === "paused") {
      this.mode = "playing";
    }
  }

  get equipped() {
    return Math.max(0, this.weapons.findIndex((w) => w.id === this.equippedId));
  }
  set equipped(i: number) {
    const w = this.weapons[i];
    if (w && w.kind !== "bow") this.equippedId = w.id;
  }
  get bowIdx() {
    return Math.max(0, this.weapons.findIndex((w) => w.id === this.bowId));
  }
  set bowIdx(i: number) {
    const w = this.weapons[i];
    if (w?.kind === "bow") this.bowId = w.id;
  }

  updateCamera(dt: number) {
    const p = this.player;
    this.cam.trauma = Math.max(0, this.cam.trauma - dt * 1.8);
    const lookY = p.y + EYE_HEIGHT;
    let dist = CAM_DIST;
    if (this.surveyT > 0) dist = lerp(CAM_DIST, 22, Math.min(1, this.surveyT / 1.2));
    else if (p.aiming) dist = CAM_DIST_AIM;
    else if (p.gliding) dist = CAM_DIST_GLIDE;
    else if (p.climbing) dist = CAM_DIST_CLIMB;
    if (this.mode === "title") dist = 16;
    this.cam.dist = lerp(this.cam.dist, dist, 1 - Math.exp(-3 * dt));
    const pitch = this.mode === "title" ? 0.22 : this.cam.pitch;
    const yaw = this.cam.yaw;
    const ox = Math.sin(yaw) * Math.cos(pitch) * this.cam.dist;
    const oy = Math.sin(pitch) * this.cam.dist + 0.35;
    const oz = Math.cos(yaw) * Math.cos(pitch) * this.cam.dist;
    const cast = sphereCast(p.x, lookY, p.z, ox, oy, oz, this.heightFn, this.solids, 0.28, 12);
    const cx = cast.x;
    const cy = cast.y;
    const cz = cast.z;
    if (cast.hit) {
      const pull = Math.max(1.8, this.cam.dist * cast.t);
      this.cam.dist = lerp(this.cam.dist, pull, 0.6);
    }
    const k = 1 - Math.exp(-8 * dt);
    this.cam.x = lerp(this.cam.x, cx, k);
    this.cam.y = lerp(this.cam.y, cy, k);
    this.cam.z = lerp(this.cam.z, cz, k);
    this.cam.lx = p.x;
    this.cam.ly = lookY;
    this.cam.lz = p.z;
  }

  presentFx(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i]!;
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.vy -= 4 * dt;
      if (q.life <= 0) this.particles.splice(i, 1);
    }
  }

  burst(x: number, y: number, z: number, n: number, r: number, g: number, b: number, sp: number) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 160) this.particles.shift();
      this.particles.push({
        x,
        y,
        z,
        vx: (Math.random() - 0.5) * sp,
        vy: Math.random() * sp,
        vz: (Math.random() - 0.5) * sp,
        life: 0.35 + Math.random() * 0.4,
        max: 0.7,
        r,
        g,
        b,
      });
    }
  }

  objective() {
    if (this.bossDead) return "原野暂时平静了";
    if (this.worldKind === "graybox") return "灰盒：走跑跳攀滑";
    if (!this.towersOn.has("dawn")) return "登上晨光塔，眺望这片原野";
    if (this.towersOn.size < 3) return `点亮天瞭塔  ${this.towersOn.size}/3`;
    if (this.orbs < 4) return `集齐灵核  ${this.orbs}/4`;
    return "前往残堡，挑战空王";
  }

  syncHud() {
    const we = this.weapons.find((w) => w.id === this.equippedId) ?? this.weapons.find((w) => w.kind !== "bow") ?? null;
    const bow = this.weapons.find((w) => w.kind === "bow") ?? null;
    const markers: Marker[] = [
      ...TOWERS.map((t) => ({ id: t.id, name: t.name, done: this.towersOn.has(t.id), x: t.x, z: t.z, kind: "tower" as const })),
      ...SHRINES.map((t) => ({ id: t.id, name: t.name, done: this.shrinesOn.has(t.id), x: t.x, z: t.z, kind: "shrine" as const })),
      { id: "citadel", name: "残堡", done: this.bossDead, x: CITADEL_POI.x, z: CITADEL_POI.z, kind: "citadel" },
    ];
    const materials = Object.entries(this.mats)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => ({
        id,
        name: id === "apple" ? "野苹果" : id === "pepper" ? "火棘椒" : id === "meat" ? "兽肉" : id,
        n,
      }));
    useHud.setState({
      mode: this.mode,
      hearts: this.player.heartsMax,
      heartsMax: this.player.heartsMax,
      hp: this.player.hp,
      stamina: this.player.stamina,
      staminaMax: this.player.staminaMax,
      climbing: this.player.climbing,
      gliding: this.player.gliding,
      swimming: this.player.swimming,
      cold: this.player.cold,
      spicy: this.player.spicy,
      raining: this.raining,
      timeOfDay: this.timeOfDay,
      weapon: we,
      bow,
      arrows: this.arrows,
      art: this.art,
      artNames: [...ART_NAMES],
      artsOn: [true, true, true, true, true],
      prompt: this.prompt,
      toast: this.toastT > 0 ? this.toast : "",
      objective: this.objective(),
      amber: this.amber,
      orbs: this.orbs,
      px: this.player.x,
      pz: this.player.z,
      py: this.player.y,
      yaw: this.player.yaw,
      camYaw: this.cam.yaw,
      markers,
      meals: this.meals,
      materials,
      weapons: this.weapons,
      dialogue: this.dialogue,
      shrineHint: this.shrineHint,
      hasSave: hasSaveFile() || Boolean(this.storage.getItem("aetherwake-save-v2")),
      temp: this.player.cold ? 0 : 1,
      aiming: this.player.aiming,
      saveError: this.saveError,
      glLost: this.glLost,
      glRestoredAt: this.glRestoredAt,
      portrait: this.portrait,
      windCd: this.gustCd,
      quality: this.settings.quality,
      tutorial: this.tutorial,
    });
  }
}

function wishStep(a: Actions) {
  return Math.hypot(a.moveX, a.moveY) > 0.3;
}

export const sim = new Sim();

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys: (codes: string[]) => void;
    };
    __sim?: Sim;
  }
}

if (typeof window !== "undefined") window.__sim = sim;
