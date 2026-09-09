import { sfx, setWind } from "./audio";
import { heightAt, normalAt, WATER_LEVEL, WORLD_SIZE } from "./height";
import { setKeys } from "./input";
import type { Actions } from "./input";
import { hasSaveFile, useHud } from "./store";
import type { InvMeal, InvWeapon, Marker, Mode } from "./store";
import {
  CAMPS,
  CITADEL_POI,
  CHESTS,
  FIRES,
  SAGE,
  SHRINES,
  TOWERS,
  TOWER_HEIGHT,
  TOWER_RADIUS,
  WISPS,
  initWorld,
  shrineWorldOrigin,
} from "./world";

const SAVE = "aetherwake-save-v1";
const GRAVITY = 26;
const WALK = 6.5;
const RUN = 10.4;
const JUMP_V = 8.4;
const CLIMB = 3.6;
const STEP = 0.72;

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
};

export type Pickup = {
  id: string;
  kind: "apple" | "meat" | "pepper" | "amber" | "heart";
  x: number;
  y: number;
  z: number;
  live: boolean;
};

export type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
};

export type Proj = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  kind: "arrow" | "beam";
  dmg: number;
};

export type Ice = { x: number; y: number; z: number; life: number };
export type Metal = { x: number; y: number; z: number; held: boolean; vx: number; vy: number; vz: number };

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpAng(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function weapon(id: string, name: string, dmg: number, max: number, kind: InvWeapon["kind"]): InvWeapon {
  return { id, name, dmg, dur: max, max, kind };
}

export class Sim {
  mode: Mode = "title";
  t = 0;
  player = {
    x: 16,
    y: 28,
    z: 102,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    stamina: 100,
    staminaMax: 100,
    hp: 3,
    heartsMax: 3,
    climbing: false,
    gliding: false,
    swimming: false,
    grounded: true,
    attackT: 0,
    aiming: false,
    invuln: 0,
    spicy: 0,
    cold: false,
  };
  cam = {
    yaw: 0,
    pitch: 0.42,
    dist: 7.2,
    x: 16,
    y: 34,
    z: 112,
    lx: 16,
    ly: 29,
    lz: 102,
    trauma: 0,
  };
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  particles: Particle[] = [];
  projs: Proj[] = [];
  ices: Ice[] = [];
  metals: Metal[] = [];
  bomb: { x: number; y: number; z: number } | null = null;
  wispsGot = new Set<string>();
  towersOn = new Set<string>();
  shrinesOn = new Set<string>();
  chestsGot = new Set<string>();
  timeOfDay = 0.21;
  raining = false;
  art = 0;
  arrows = 24;
  amber = 0;
  orbs = 0;
  weapons: InvWeapon[] = [];
  meals: InvMeal[] = [];
  mats: Record<string, number> = { apple: 2, pepper: 1 };
  equipped = 0;
  bowIdx = 1;
  prompt = "";
  toast = "";
  toastT = 0;
  dialogue = "";
  shrine: number | null = null;
  shrineHint = "";
  crackedBroken = [false, false, false, false];
  moveBlock = { t: 0, frozen: 0, x: 0, z: 0 };
  heldMetal = -1;
  overworld = { x: 16, y: 28, z: 102, yaw: 0 };
  surveyT = 0;
  stun = 0;
  bowWas = false;
  interactLock = 0;
  stepAcc = 0;
  wind = 0;
  bossDead = false;
  endingT = 0;
  spawn = { x: 16, z: 102 };
  hudAcc = 0;

  constructor() {
    initWorld();
    this.resetWorldEntities(false);
    this.player.y = heightAt(this.player.x, this.player.z);
    if (typeof window !== "undefined") {
      window.__controlsTest = {
        getYaw: () => this.player.yaw,
        getSpeed: () => Math.hypot(this.player.vx, this.player.vz),
        setKeys,
      };
    }
  }

  resetWorldEntities(keepProgress: boolean) {
    this.enemies = [];
    CAMPS.forEach((c, ci) => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const x = c.x + Math.cos(a) * 3.2;
        const z = c.z + Math.sin(a) * 3.2;
        this.enemies.push({
          id: `b-${ci}-${i}`,
          kind: "bramble",
          x,
          y: heightAt(x, z),
          z,
          yaw: a,
          hp: 3,
          max: 3,
          homeX: x,
          homeZ: z,
          flash: 0,
          frozen: 0,
          timer: Math.random() * 2,
          alive: true,
          hurt: 0,
        });
      }
    });
    const sent = [
      [22, -36],
      [52, -72],
    ];
    sent.forEach((p, i) => {
      const x = p[0]!;
      const z = p[1]!;
      this.enemies.push({
        id: `s-${i}`,
        kind: "sentinel",
        x,
        y: heightAt(x, z),
        z,
        yaw: 0,
        hp: 8,
        max: 8,
        homeX: x,
        homeZ: z,
        flash: 0,
        frozen: 0,
        timer: 1,
        alive: true,
        hurt: 0,
      });
    });
    const bx = CITADEL_POI.x;
    const bz = CITADEL_POI.z;
    this.enemies.push({
      id: "boss",
      kind: "boss",
      x: bx,
      y: heightAt(bx, bz) + 0.2,
      z: bz,
      yaw: 0,
      hp: 20,
      max: 20,
      homeX: bx,
      homeZ: bz,
      flash: 0,
      frozen: 0,
      timer: 0,
      alive: true,
      hurt: 0,
    });
    this.pickups = [];
    for (let i = 0; i < 14; i++) {
      const x = (Math.sin(i * 12.1) * 0.5 + 0.5) * 160 - 40;
      const z = (Math.cos(i * 7.7) * 0.5 + 0.5) * 80 + 40;
      this.pickups.push({
        id: `ap-${i}`,
        kind: i % 5 === 0 ? "pepper" : "apple",
        x,
        y: heightAt(x, z) + 0.4,
        z,
        live: true,
      });
    }
    this.metals = [
      { x: 34, y: heightAt(34, 10) + 0.5, z: 10, held: false, vx: 0, vy: 0, vz: 0 },
      { x: 90, y: heightAt(90, 20) + 0.5, z: 20, held: false, vx: 0, vy: 0, vz: 0 },
    ];
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
    }
  }

  startNew() {
    this.mode = "playing";
    this.shrine = null;
    this.player.x = 16;
    this.player.z = 102;
    this.player.y = heightAt(16, 102);
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
    this.player.yaw = 0;
    this.player.hp = 3;
    this.player.heartsMax = 3;
    this.player.stamina = 100;
    this.player.staminaMax = 100;
    this.player.climbing = false;
    this.player.gliding = false;
    this.cam.yaw = 0;
    this.cam.pitch = 0.42;
    this.weapons = [
      weapon("blade", "旅人短剑", 18, 24, "sword"),
      weapon("bow", "林间长弓", 12, 20, "bow"),
    ];
    this.equipped = 0;
    this.bowIdx = 1;
    this.meals = [];
    this.mats = { apple: 2, pepper: 1 };
    this.arrows = 24;
    this.amber = 0;
    this.art = 0;
    this.timeOfDay = 0.22;
    this.resetWorldEntities(false);
    this.spawn = { x: 16, z: 102 };
    this.pushToast("在空中按住跳跃即可滑翔。对着峭壁按住跳跃攀爬。");
    this.save();
    this.syncHud();
  }

  continueSave() {
    try {
      const raw = localStorage.getItem(SAVE);
      if (!raw) {
        this.startNew();
        return;
      }
      const d = JSON.parse(raw) as Record<string, unknown>;
      this.startNew();
      this.player.x = Number(d.x) || 16;
      this.player.z = Number(d.z) || 102;
      this.player.y = Number(d.y) || heightAt(this.player.x, this.player.z);
      this.player.yaw = Number(d.yaw) || 0;
      this.cam.yaw = Number(d.camYaw) || 0;
      this.player.hp = Number(d.hp) || 3;
      this.player.heartsMax = Number(d.heartsMax) || 3;
      this.player.staminaMax = Number(d.staminaMax) || 100;
      this.player.stamina = this.player.staminaMax;
      this.orbs = Number(d.orbs) || 0;
      this.amber = Number(d.amber) || 0;
      this.arrows = Number(d.arrows) || 20;
      this.timeOfDay = Number(d.timeOfDay) || 0.22;
      this.art = Number(d.art) || 0;
      this.towersOn = new Set((d.towers as string[]) || []);
      this.shrinesOn = new Set((d.shrines as string[]) || []);
      this.wispsGot = new Set((d.wisps as string[]) || []);
      this.chestsGot = new Set((d.chests as string[]) || []);
      this.bossDead = Boolean(d.bossDead);
      if (Array.isArray(d.weapons)) this.weapons = d.weapons as InvWeapon[];
      if (Array.isArray(d.meals)) this.meals = d.meals as InvMeal[];
      if (d.mats && typeof d.mats === "object") this.mats = d.mats as Record<string, number>;
      this.spawn = { x: this.player.x, z: this.player.z };
      this.mode = "playing";
    } catch {
      this.startNew();
    }
    this.syncHud();
  }

  save() {
    try {
      localStorage.setItem(
        SAVE,
        JSON.stringify({
          x: this.player.x,
          y: this.player.y,
          z: this.player.z,
          yaw: this.player.yaw,
          camYaw: this.cam.yaw,
          hp: this.player.hp,
          heartsMax: this.player.heartsMax,
          staminaMax: this.player.staminaMax,
          orbs: this.orbs,
          amber: this.amber,
          arrows: this.arrows,
          timeOfDay: this.timeOfDay,
          art: this.art,
          towers: [...this.towersOn],
          shrines: [...this.shrinesOn],
          wisps: [...this.wispsGot],
          chests: [...this.chestsGot],
          bossDead: this.bossDead,
          weapons: this.weapons,
          meals: this.meals,
          mats: this.mats,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  pushToast(msg: string) {
    this.toast = msg;
    this.toastT = 3.6;
  }

  surfaceY(x: number, z: number): number {
    if (this.shrine !== null) {
      const o = shrineWorldOrigin(this.shrine);
      const lx = x - o.x;
      const lz = z - o.z;
      let h = o.y;
      const puzzle = SHRINES[this.shrine]?.puzzle;
      if (puzzle === "rime" && lz > 8 && lz < 21 && Math.abs(lx) < 6.2) h = o.y - 4.6;
      if (puzzle === "pull" && lz > 10 && lz < 16.5 && Math.abs(lx) < 4.2) h = o.y - 4.4;
      if (puzzle === "still" && lz > 10 && lz < 16.5 && Math.abs(lx) < 5) h = o.y - 4.4;
      for (const ice of this.ices) {
        if (Math.hypot(x - ice.x, z - ice.z) < 1.2) h = Math.max(h, ice.y + 3.35);
      }
      for (const m of this.metals) {
        if (Math.hypot(x - m.x, z - m.z) < 1.35) h = Math.max(h, m.y + 0.55);
      }
      if (puzzle === "still") {
        const d = Math.hypot(x - this.moveBlock.x, z - this.moveBlock.z);
        if (d < 1.5) h = Math.max(h, o.y + 0.9);
      }
      return h;
    }
    let h = heightAt(x, z);
    for (const tw of TOWERS) {
      const d = Math.hypot(x - tw.x, z - tw.z);
      if (d < TOWER_RADIUS) h = Math.max(h, tw.y + TOWER_HEIGHT);
    }
    for (const ice of this.ices) {
      if (Math.hypot(x - ice.x, z - ice.z) < 1.2) h = Math.max(h, ice.y + 3.35);
    }
    for (const m of this.metals) {
      if (!m.held && Math.hypot(x - m.x, z - m.z) < 1.2) h = Math.max(h, m.y + 0.5);
    }
    return h;
  }

  lookDir() {
    const cy = this.cam.yaw;
    const cp = this.cam.pitch;
    const horiz = Math.cos(cp);
    return {
      x: -Math.sin(cy) * horiz,
      y: -Math.sin(cp) * 0.55,
      z: -Math.cos(cy) * horiz,
    };
  }

  step(dt: number, a: Actions) {
    const d = Math.min(dt, 0.1);
    this.t += d;
    if (this.mode === "title") {
      this.timeOfDay = 0.2 + Math.sin(this.t * 0.07) * 0.04;
      this.cam.yaw = this.t * 0.12;
      this.cam.pitch = 0.28;
      this.cam.dist = 18;
      this.player.x = 16;
      this.player.z = 102;
      this.player.y = heightAt(16, 102);
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

    if (a.pause) this.mode = "paused";
    if (a.bag) this.mode = "inventory";
    if (a.map) this.mode = "map";
    if (a.artSlot >= 0) this.art = a.artSlot;

    if (this.stun > 0) {
      this.stun -= d;
      this.updateCamera(d);
      this.presentFx(d);
      this.syncHud();
      return;
    }

    const slow = this.player.aiming ? 0.42 : 1;
    const hdt = d * slow;
    this.timeOfDay = (this.timeOfDay + hdt * 0.008) % 1;
    this.raining = Math.sin(this.timeOfDay * 6.2 + 1.2) > 0.72;
    this.toastT = Math.max(0, this.toastT - d);
    if (this.toastT <= 0) this.toast = "";
    this.interactLock = Math.max(0, this.interactLock - d);
    this.player.invuln = Math.max(0, this.player.invuln - d);
    this.player.spicy = Math.max(0, this.player.spicy - d);
    this.surveyT = Math.max(0, this.surveyT - d);
    this.player.attackT = Math.max(0, this.player.attackT - d);

    this.cam.yaw -= a.lookX * 0.0024;
    this.cam.pitch = clamp(this.cam.pitch + a.lookY * 0.002, 0.06, 1.18);

    const fx = -Math.sin(this.cam.yaw);
    const fz = -Math.cos(this.cam.yaw);
    const rx = Math.cos(this.cam.yaw);
    const rz = -Math.sin(this.cam.yaw);
    const wishX = fx * a.moveY + rx * a.moveX;
    const wishZ = fz * a.moveY + rz * a.moveX;
    const wishLen = Math.hypot(wishX, wishZ);

    this.handleLocomotion(hdt, a, wishX, wishZ, wishLen, fx, fz, rx, rz);
    this.handleCombat(a, fx, fz);
    this.handleArts(a);
    this.handleInteract(a);
    this.updateEnemies(hdt);
    this.updateProjs(hdt);
    this.updateMetals(hdt, fx, fz);
    this.updateIces(hdt);
    this.updateShrineBlock(hdt);
    this.presentFx(d);
    this.updateCamera(d);
    this.wind = lerp(this.wind, this.player.gliding ? 1 : wishLen * 0.25, 1 - Math.exp(-3 * d));
    setWind(this.wind);

    this.hudAcc += d;
    if (this.hudAcc > 0.05) {
      this.hudAcc = 0;
      this.syncHud();
    }
  }

  handleLocomotion(
    dt: number,
    a: Actions,
    wishX: number,
    wishZ: number,
    wishLen: number,
    fx: number,
    fz: number,
    rx: number,
    rz: number,
  ) {
    const p = this.player;
    const aheadX = p.x + fx * 0.7;
    const aheadZ = p.z + fz * 0.7;
    const hHere = this.surfaceY(p.x, p.z);
    const hAhead = this.surfaceY(aheadX, aheadZ);
    const wall = hAhead > p.y + 0.85;
    const inWater = p.y < WATER_LEVEL - 0.05 && this.shrine === null;
    p.swimming = inWater && !p.climbing;

    if ((a.jumpHeld || p.climbing) && wall && p.stamina > 1 && !p.gliding) {
      p.climbing = true;
      p.gliding = false;
      p.grounded = false;
      p.vy = 0;
      const up = a.moveY > 0.05 || a.jumpHeld ? 1 : a.moveY < -0.15 ? -0.7 : 0.2;
      p.y += CLIMB * up * dt;
      p.x += rx * a.moveX * 2.4 * dt;
      p.z += rz * a.moveX * 2.4 * dt;
      p.stamina -= 17 * dt;
      if (p.y >= hAhead - 0.15) {
        p.x = aheadX;
        p.z = aheadZ;
        p.y = hAhead;
        p.climbing = false;
        p.grounded = true;
      }
      if (wishLen > 0.15) p.yaw = lerpAng(p.yaw, Math.atan2(-wishX, -wishZ), 1 - Math.exp(-10 * dt));
      this.clampWorld();
      return;
    }
    p.climbing = false;

    if (!p.grounded && a.jumpHeld && p.vy < 1.2 && p.stamina > 1) {
      if (!p.gliding) sfx("jump");
      p.gliding = true;
    }
    if (!a.jumpHeld) p.gliding = false;
    if (p.grounded || p.swimming) p.gliding = false;

    let speed = WALK;
    if (a.sprint && p.stamina > 1 && p.grounded && wishLen > 0.2) {
      speed = RUN;
      p.stamina -= 16 * dt;
    } else if (p.grounded && !p.climbing) {
      p.stamina = Math.min(p.staminaMax, p.stamina + 26 * dt);
    }
    if (p.gliding) p.stamina -= 7 * dt;
    if (p.stamina <= 0) {
      p.stamina = 0;
      p.gliding = false;
      speed = WALK * 0.7;
    }

    if (p.swimming) {
      speed = 4.2;
      p.vy += (WATER_LEVEL - 0.4 - p.y) * 3.2 * dt;
      p.vy *= 0.92;
      if (a.jump) p.vy = 5.5;
    }

    if (wishLen > 0.08 && !p.aiming) {
      const inv = 1 / Math.max(wishLen, 1);
      p.vx = wishX * inv * speed;
      p.vz = wishZ * inv * speed;
      p.yaw = lerpAng(p.yaw, Math.atan2(-wishX, -wishZ), 1 - Math.exp(-12 * dt));
    } else if (p.aiming && wishLen > 0.08) {
      const inv = 1 / Math.max(wishLen, 1);
      p.vx = wishX * inv * speed * 0.45;
      p.vz = wishZ * inv * speed * 0.45;
    } else {
      p.vx *= Math.pow(0.0002, dt);
      p.vz *= Math.pow(0.0002, dt);
    }

    if (p.gliding) {
      p.vy = lerp(p.vy, -2.35, 1 - Math.exp(-4 * dt));
      p.vx += fx * 2.8 * dt;
      p.vz += fz * 2.8 * dt;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 12) {
        p.vx *= 12 / sp;
        p.vz *= 12 / sp;
      }
    } else if (!p.swimming) {
      p.vy -= GRAVITY * dt;
    }

    if (a.jump && p.grounded && !p.climbing) {
      p.vy = JUMP_V;
      p.grounded = false;
      sfx("jump");
    }

    const nx = p.x + p.vx * dt;
    const nz = p.z + p.vz * dt;
    const hN = this.surfaceY(nx, nz);
    if (hN <= p.y + STEP || p.vy > 0) {
      p.x = nx;
      p.z = nz;
    } else {
      const hx = this.surfaceY(nx, p.z);
      const hz = this.surfaceY(p.x, nz);
      if (hx <= p.y + STEP) p.x = nx;
      else p.vx = 0;
      if (hz <= p.y + STEP) p.z = nz;
      else p.vz = 0;
    }

    p.y += p.vy * dt;
    const g = this.surfaceY(p.x, p.z);
    if (p.y <= g) {
      if (!p.grounded && p.vy < -15) this.hurt(p.vy < -22 ? 1.5 : 0.75, "坠落");
      if (!p.grounded && p.vy < -4) this.burst(p.x, g + 0.1, p.z, 6, 0.45, 0.4, 0.32, 0.8);
      p.y = g;
      p.vy = 0;
      p.grounded = true;
      p.gliding = false;
    } else {
      p.grounded = false;
    }

    if (this.shrine !== null) {
      const o = shrineWorldOrigin(this.shrine);
      p.x = clamp(p.x, o.x - 9.2, o.x + 9.2);
      p.z = clamp(p.z, o.z + 0.8, o.z + 26);
      const puzzle = SHRINES[this.shrine]?.puzzle;
      const lx = p.x - o.x;
      const lz = p.z - o.z;
      if (puzzle === "burst" && !this.crackedBroken[this.shrine] && lz > 11.1 && lz < 13.6 && Math.abs(lx) < 4.6) {
        p.z = o.z + 11.1;
      }
    } else {
      const lim = WORLD_SIZE * 0.48;
      p.x = clamp(p.x, -lim, lim);
      p.z = clamp(p.z, -lim, lim);
      if (p.y < -8) this.die("沉入深海");
    }

    const n = this.shrine === null ? normalAt(p.x, p.z) : { x: 0, y: 1, z: 0 };
    p.cold = p.y > 44 && this.shrine === null && p.spicy <= 0;
    if (p.cold) {
      this.coldAcc = (this.coldAcc ?? 0) + dt;
      if (this.coldAcc > 3.2) {
        this.coldAcc = 0;
        this.hurt(0.25, "严寒");
        this.pushToast("太冷了。烤火棘椒可以驱寒。");
      }
    } else this.coldAcc = 0;

    if (wishLen > 0.3 && p.grounded) {
      this.stepAcc += dt * (a.sprint ? 1.6 : 1);
      if (this.stepAcc > 0.38) {
        this.stepAcc = 0;
        sfx("step");
      }
    }
    void n;
  }

  coldAcc = 0;

  handleCombat(a: Actions, fx: number, fz: number) {
    const p = this.player;
    const we = this.weapons[this.equipped];
    p.aiming = a.bow && (this.weapons[this.bowIdx]?.kind === "bow");

    if (a.attack && p.attackT <= 0 && !p.aiming && we && we.kind !== "bow") {
      p.attackT = 0.34;
      sfx("swing");
      const range = we.kind === "claymore" ? 3.1 : 2.35;
      let hit = false;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > range + (e.kind === "boss" ? 1.2 : 0)) continue;
        const dir = dx * fx + dz * fz;
        if (dir < 0.15) continue;
        this.damageEnemy(e, we.dmg / 10 + (e.frozen > 0 ? 1.6 : 0), fx, fz);
        hit = true;
      }
      if (hit) {
        we.dur -= 1;
        this.stun = 0.045;
        this.cam.trauma = Math.min(1, this.cam.trauma + 0.35);
        sfx("hit");
        if (we.dur <= 0) {
          this.pushToast(`${we.name} 损坏了`);
          this.weapons.splice(this.equipped, 1);
          this.equipped = 0;
        }
      }
    }

    if (this.bowWas && !a.bow && p.aiming === false && this.bowWas) {
      /* release handled below */
    }
    if (this.bowWas && !a.bow && this.arrows > 0) {
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
    this.bowWas = a.bow;
  }

  handleArts(a: Actions) {
    if (!a.art) return;
    const p = this.player;
    const look = this.lookDir();
    if (this.art === 0) {
      if (!this.bomb) {
        this.bomb = { x: p.x + look.x * 2.2, y: p.y + 0.7, z: p.z + look.z * 2.2 };
        this.pushToast("爆鸣已放置。再按使用以引爆。");
      } else {
        this.explode(this.bomb.x, this.bomb.y, this.bomb.z);
        this.bomb = null;
      }
    } else if (this.art === 1) {
      const tx = p.x + look.x * 4.5;
      const tz = p.z + look.z * 4.5;
      const hy = this.shrine !== null ? this.surfaceY(tx, tz) : heightAt(tx, tz);
      const wet = this.shrine !== null ? hy < shrineWorldOrigin(this.shrine!).y - 1 : hy < WATER_LEVEL + 0.4;
      if (wet || this.shrine !== null) {
        const y = this.shrine !== null ? shrineWorldOrigin(this.shrine).y - 4.6 : WATER_LEVEL;
        this.ices.push({ x: tx, y, z: tz, life: 40 });
        if (this.ices.length > 6) this.ices.shift();
        sfx("ui");
      } else this.pushToast("霜息需要水面。");
    } else if (this.art === 2) {
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
    } else if (this.art === 3) {
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

  explode(x: number, y: number, z: number) {
    sfx("explode");
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.7);
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
        this.pushToast("岩壁碎裂了");
      }
    }
    for (const rk of this.pickups) {
      if (rk.live && Math.hypot(rk.x - x, rk.z - z) < 5) {
        /* keep */
      }
    }
  }

  handleInteract(a: Actions) {
    this.prompt = "";
    this.shrineHint = "";
    if (this.interactLock > 0) return;
    const p = this.player;

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
              this.pushToast("四枚灵核共鸣。残堡封印已开。");
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

    for (let i = 0; i < TOWERS.length; i++) {
      const tw = TOWERS[i]!;
      const d = Math.hypot(p.x - tw.x, p.z - tw.z);
      const onTop = d < 4.6 && p.y > tw.y + TOWER_HEIGHT - 2.5;
      if (onTop) {
        this.prompt = this.towersOn.has(tw.id) ? `${tw.name}已点亮` : `启动 ${tw.name}`;
        if (a.interact && !this.towersOn.has(tw.id)) {
          this.towersOn.add(tw.id);
          this.surveyT = 2.4;
          this.spawn = { x: p.x, z: p.z };
          sfx("tower");
          this.pushToast(`${tw.name} 点亮了这片土地`);
          this.save();
        }
        return;
      }
    }

    for (let i = 0; i < SHRINES.length; i++) {
      const s = SHRINES[i]!;
      if (Math.hypot(p.x - s.x, p.z - s.z) < 3.2 && Math.abs(p.y - s.y) < 4) {
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
          "风醒者。灾厄仍锁在残堡深处。登上三座天瞭塔，集齐四枚灵核，封印才会打开。对着峭壁攀爬，自高处滑翔。石板四术：爆鸣、霜息、牵引、凝时。";
      }
      return;
    }

    for (const f of FIRES) {
      if (Math.hypot(p.x - f.x, p.z - f.z) < 2.1) {
        this.prompt = "在篝火烹饪 / 休息";
        if (a.interact) {
          this.mode = "cooking";
          this.player.hp = this.player.heartsMax;
          this.spawn = { x: p.x, z: p.z };
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
          this.player.staminaMax += 8;
          this.player.stamina = this.player.staminaMax;
          this.amber += 8;
          sfx("pickup");
          this.pushToast(`风之种 ${this.wispsGot.size}/8  · 耐力提升`);
          this.save();
        }
        return;
      }
    }

    if (this.orbs >= 4 && Math.hypot(p.x - CITADEL_POI.x, p.z - CITADEL_POI.z) < 14) {
      this.prompt = this.bossDead ? "残堡已沉寂" : "挑战空王";
    } else if (this.orbs < 4 && Math.hypot(p.x - CITADEL_POI.x, p.z - CITADEL_POI.z) < 18) {
      this.prompt = "封印未开（灵核 " + this.orbs + "/4）";
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

  enterShrine(i: number) {
    this.overworld = { x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.player.yaw };
    this.shrine = i;
    const o = shrineWorldOrigin(i);
    this.player.x = o.x;
    this.player.z = o.z + 2.4;
    this.player.y = o.y + 0.1;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
    this.interactLock = 0.4;
    this.metals = this.metals.filter((m) => m.x < 180);
    this.metals.push({ x: o.x + 6.2, y: o.y + 0.5, z: o.z + 8, held: false, vx: 0, vy: 0, vz: 0 });
    this.moveBlock.t = 0;
    this.moveBlock.frozen = 0;
    this.moveBlock.x = o.x;
    this.moveBlock.z = o.z + 13;
    this.pushToast(SHRINES[i]?.hint || "解开灵祠");
    sfx("ui");
  }

  exitShrine() {
    this.shrine = null;
    this.player.x = this.overworld.x;
    this.player.z = this.overworld.z;
    this.player.y = this.overworld.y + 0.4;
    this.player.yaw = this.overworld.yaw;
    this.player.vx = 0;
    this.player.vy = 0;
    this.ices = this.ices.filter((i) => i.y < 200);
    this.metals = this.metals.filter((m) => m.x < 180);
    this.heldMetal = -1;
    this.interactLock = 0.5;
    this.save();
  }

  updateEnemies(dt: number) {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.hurt = Math.max(0, e.hurt - dt);
      if (e.frozen > 0) {
        e.frozen -= dt;
        continue;
      }
      e.y = this.surfaceY(e.x, e.z);
      if (e.kind === "boss" && this.orbs < 4) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const dist = Math.hypot(dx, dz);
      const aggro = e.kind === "boss" ? 28 : e.kind === "sentinel" ? 22 : 14;
      e.timer -= dt;
      if (dist < aggro && this.shrine === null) {
        e.yaw = Math.atan2(-dx, -dz);
        const sp = e.kind === "boss" ? 3.2 : e.kind === "sentinel" ? 2.1 : 4.4;
        if (dist > (e.kind === "boss" ? 3.4 : 1.7)) {
          e.x += (dx / dist) * sp * dt;
          e.z += (dz / dist) * sp * dt;
        } else if (e.timer <= 0) {
          e.timer = e.kind === "boss" ? 2.2 : 1.1;
          this.hurt(e.kind === "boss" ? 1.25 : e.kind === "sentinel" ? 1 : 0.5, e.kind === "boss" ? "空王" : "敌人");
          this.cam.trauma = Math.min(1, this.cam.trauma + 0.4);
        }
        if (e.kind === "sentinel" && e.timer <= 0.05 && dist > 4) {
          e.timer = 2.4;
          const inv = 1 / dist;
          this.projs.push({
            x: e.x,
            y: e.y + 1.6,
            z: e.z,
            vx: dx * inv * 16,
            vy: 0.4,
            vz: dz * inv * 16,
            life: 2,
            kind: "beam",
            dmg: 1,
          });
        }
      } else if (e.kind !== "boss") {
        e.timer -= dt;
        if (e.timer < -2) {
          e.x += Math.sin(this.t + e.x) * 0.6 * dt;
          e.z += Math.cos(this.t + e.z) * 0.6 * dt;
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
      const gy = this.surfaceY(q.x, q.z);
      if (q.y < gy || q.life <= 0) {
        this.projs.splice(i, 1);
        continue;
      }
      if (q.kind === "arrow") {
        for (const e of this.enemies) {
          if (!e.alive) continue;
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

  updateMetals(dt: number, fx: number, fz: number) {
    for (let i = 0; i < this.metals.length; i++) {
      const m = this.metals[i]!;
      if (m.held) {
        m.x = this.player.x + fx * 2.4;
        m.y = this.player.y + 1.3;
        m.z = this.player.z + fz * 2.4;
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
        const g = this.surfaceY(m.x, m.z);
        if (m.y < g + 0.45) {
          m.y = g + 0.45;
          m.vy = 0;
        }
      }
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
    this.moveBlock.x = o.x + Math.sin(this.moveBlock.t * 0.9) * 5.4;
    this.moveBlock.z = o.z + 13;
  }

  damageEnemy(e: Enemy, dmg: number, kx: number, kz: number) {
    if (!e.alive) return;
    e.hp -= dmg;
    e.flash = 0.15;
    e.hurt = 0.3;
    const l = Math.hypot(kx, kz) || 1;
    e.x += (kx / l) * 1.1;
    e.z += (kz / l) * 1.1;
    this.burst(e.x, e.y + 1, e.z, 8, 1, 0.35, 0.2, 1);
    if (e.hp <= 0) {
      e.alive = false;
      sfx("hit");
      this.amber += e.kind === "boss" ? 80 : e.kind === "sentinel" ? 20 : 8;
      this.pickups.push({
        id: `drop-${e.id}`,
        kind: e.kind === "boss" ? "heart" : "meat",
        x: e.x,
        y: e.y + 0.5,
        z: e.z,
        live: true,
      });
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
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.45);
    if (p.hp <= 0) this.die("力竭");
  }

  die(_why: string) {
    this.mode = "dead";
    this.player.hp = 0;
    this.pushToast("你倒下了");
    this.syncHud();
  }

  respawn() {
    this.mode = "playing";
    this.player.x = this.spawn.x;
    this.player.z = this.spawn.z;
    this.player.y = heightAt(this.spawn.x, this.spawn.z) + 0.2;
    this.player.hp = this.player.heartsMax;
    this.player.stamina = this.player.staminaMax;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
    this.shrine = null;
    this.syncHud();
  }

  cook(matId: string) {
    const n = this.mats[matId] || 0;
    if (n <= 0) return;
    this.mats[matId] = n - 1;
    if (matId === "pepper") {
      this.meals.push({ id: `m-${this.t}`, name: "辣炒椒", hearts: 2, spicy: true });
    } else if (matId === "meat") {
      this.meals.push({ id: `m-${this.t}`, name: "烤肉", hearts: 3 });
    } else {
      this.meals.push({ id: `m-${this.t}`, name: "烤苹果", hearts: 1.5 });
    }
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

  updateCamera(dt: number) {
    const p = this.player;
    this.cam.trauma = Math.max(0, this.cam.trauma - dt * 1.8);
    const lookY = p.y + 1.18;
    let dist = this.surveyT > 0 ? lerp(7.2, 26, Math.min(1, this.surveyT / 1.2)) : this.player.gliding ? 9.5 : 7.2;
    if (this.mode === "title") dist = 16;
    this.cam.dist = lerp(this.cam.dist, dist, 1 - Math.exp(-3 * dt));
    const pitch = this.mode === "title" ? 0.22 : this.cam.pitch;
    const yaw = this.cam.yaw;
    const ox = Math.sin(yaw) * Math.cos(pitch) * this.cam.dist;
    const oy = Math.sin(pitch) * this.cam.dist + 0.35;
    const oz = Math.cos(yaw) * Math.cos(pitch) * this.cam.dist;
    let cx = p.x + ox;
    let cy = lookY + oy;
    let cz = p.z + oz;
    const gh = this.surfaceY(cx, cz) + 0.9;
    if (cy < gh) cy = gh;
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

  clampWorld() {
    const lim = WORLD_SIZE * 0.48;
    this.player.x = clamp(this.player.x, -lim, lim);
    this.player.z = clamp(this.player.z, -lim, lim);
  }

  objective() {
    if (this.bossDead) return "原野暂时平静了";
    if (!this.towersOn.has("dawn")) return "登上晨光塔，眺望这片原野";
    if (this.orbs < 4) return `集齐灵核  ${this.orbs}/4`;
    return "前往残堡，挑战空王";
  }

  syncHud() {
    const we = this.weapons[this.equipped] ?? null;
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
      artsOn: [true, true, true, true],
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
      hasSave: hasSaveFile(),
      temp: this.player.cold ? 0 : 1,
      aiming: this.player.aiming,
    });
  }
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
