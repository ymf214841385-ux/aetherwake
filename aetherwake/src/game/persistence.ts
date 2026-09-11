import {
  SAVE_BACKUP,
  SAVE_KEY_V1,
  SAVE_KEY_V2,
  SCHEMA_VERSION,
  WORLD_VERSION,
} from "./params.ts";
import type { InvMeal, InvWeapon } from "./store.ts";

export type SaveStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type Checkpoint = { id: string; x: number; y: number; z: number };

export type SaveEnvelope = {
  schemaVersion: number;
  worldVersion: number;
  savedAt: number;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    camYaw: number;
    hp: number;
    heartsMax: number;
    staminaMax: number;
    arrows: number;
    amber: number;
    art: number;
    spicy: number;
  };
  inventory: {
    weapons: InvWeapon[];
    meals: InvMeal[];
    mats: Record<string, number>;
    equippedId: string | null;
    bowId: string | null;
  };
  progress: {
    towers: string[];
    shrines: string[];
    wisps: string[];
    chests: string[];
    orbs: number;
    bossDead: boolean;
    ruinSolved: boolean;
    sealRule: "legacy-orbs" | "towers-and-shrines";
    graybox?: boolean;
  };
  checkpoint: Checkpoint;
};

export type LoadResult =
  | { ok: true; data: SaveEnvelope; migrated: boolean; source: "v2" | "v1" }
  | { ok: false; reason: "missing" | "corrupt"; backupKept: boolean; raw: string | null };

function finite(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function str(n: unknown, fallback: string): string {
  return typeof n === "string" && n.length > 0 ? n : fallback;
}

function strings(n: unknown): string[] {
  return Array.isArray(n) ? n.filter((x): x is string => typeof x === "string") : [];
}

function weaponList(n: unknown): InvWeapon[] {
  if (!Array.isArray(n)) return [];
  const out: InvWeapon[] = [];
  for (const w of n) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    const kind = o.kind;
    if (kind !== "sword" && kind !== "claymore" && kind !== "bow") continue;
    out.push({
      id: str(o.id, `w-${out.length}`),
      name: str(o.name, "无名武器"),
      dmg: finite(o.dmg, 10),
      dur: finite(o.dur, 1),
      max: finite(o.max, 1),
      kind,
    });
  }
  return out;
}

export function createDefaultSave(partial?: Partial<SaveEnvelope>): SaveEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    worldVersion: WORLD_VERSION,
    savedAt: Date.now(),
    player: {
      x: 16,
      y: 12,
      z: 102,
      yaw: 0,
      camYaw: 0,
      hp: 3,
      heartsMax: 3,
      staminaMax: 100,
      arrows: 24,
      amber: 0,
      art: 0,
      spicy: 0,
    },
    inventory: {
      weapons: [
        { id: "blade", name: "旅人短剑", dmg: 18, dur: 24, max: 24, kind: "sword" },
        { id: "bow", name: "林间长弓", dmg: 12, dur: 20, max: 20, kind: "bow" },
      ],
      meals: [],
      mats: { apple: 2, pepper: 1 },
      equippedId: "blade",
      bowId: "bow",
    },
    progress: {
      towers: [],
      shrines: [],
      wisps: [],
      chests: [],
      orbs: 0,
      bossDead: false,
      ruinSolved: false,
      sealRule: "towers-and-shrines",
    },
    checkpoint: { id: "spawn", x: 16, y: 12, z: 102 },
    ...partial,
  };
}

export function parseSave(raw: string): SaveEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const d = parsed as Record<string, unknown>;

  if (d.schemaVersion == null && (d.x != null || d.hp != null)) {
    return migrateV1(d);
  }

  const playerIn = (d.player && typeof d.player === "object" ? d.player : {}) as Record<string, unknown>;
  const invIn = (d.inventory && typeof d.inventory === "object" ? d.inventory : {}) as Record<string, unknown>;
  const progIn = (d.progress && typeof d.progress === "object" ? d.progress : {}) as Record<string, unknown>;
  const cpIn = (d.checkpoint && typeof d.checkpoint === "object" ? d.checkpoint : {}) as Record<string, unknown>;
  const weapons = weaponList(invIn.weapons);
  const equippedId =
    typeof invIn.equippedId === "string" && weapons.some((w) => w.id === invIn.equippedId)
      ? invIn.equippedId
      : weapons.find((w) => w.kind !== "bow")?.id ?? null;
  const bowId =
    typeof invIn.bowId === "string" && weapons.some((w) => w.id === invIn.bowId && w.kind === "bow")
      ? invIn.bowId
      : weapons.find((w) => w.kind === "bow")?.id ?? null;

  const orbs = finite(progIn.orbs, 0);
  const towers = strings(progIn.towers);
  const shrines = strings(progIn.shrines);
  const bossDead = Boolean(progIn.bossDead);
  const ruinSolved = Boolean(progIn.ruinSolved);
  const schema = finite(d.schemaVersion, 1);
  let sealRule: "legacy-orbs" | "towers-and-shrines" =
    progIn.sealRule === "legacy-orbs" ? "legacy-orbs" : "towers-and-shrines";
  if (schema < 2) {
    sealRule = bossDead || orbs >= 4 ? "legacy-orbs" : "towers-and-shrines";
  }

  const artRaw = finite(playerIn.art, 0);
  const art = schema < 2 ? Math.min(4, artRaw + 1) : Math.max(0, Math.min(4, artRaw));

  return {
    schemaVersion: SCHEMA_VERSION,
    worldVersion: finite(d.worldVersion, WORLD_VERSION),
    savedAt: finite(d.savedAt, Date.now()),
    player: {
      x: finite(playerIn.x, 16),
      y: finite(playerIn.y, 12),
      z: finite(playerIn.z, 102),
      yaw: finite(playerIn.yaw, 0),
      camYaw: finite(playerIn.camYaw, 0),
      hp: finite(playerIn.hp, 3),
      heartsMax: finite(playerIn.heartsMax, 3),
      staminaMax: finite(playerIn.staminaMax, 100),
      arrows: finite(playerIn.arrows, 0),
      amber: finite(playerIn.amber, 0),
      art,
      spicy: finite(playerIn.spicy, 0),
    },
    inventory: {
      weapons,
      meals: Array.isArray(invIn.meals) ? (invIn.meals as InvMeal[]) : [],
      mats: invIn.mats && typeof invIn.mats === "object" ? (invIn.mats as Record<string, number>) : {},
      equippedId,
      bowId,
    },
    progress: {
      towers,
      shrines,
      wisps: strings(progIn.wisps),
      chests: strings(progIn.chests),
      orbs,
      bossDead,
      ruinSolved,
      sealRule,
      graybox: Boolean(progIn.graybox),
    },
    checkpoint: {
      id: str(cpIn.id, "spawn"),
      x: finite(cpIn.x, 16),
      y: finite(cpIn.y, 12),
      z: finite(cpIn.z, 102),
    },
  };
}

function migrateV1(d: Record<string, unknown>): SaveEnvelope {
  const weapons = weaponList(d.weapons);
  const orbs = finite(d.orbs, 0);
  const bossDead = Boolean(d.bossDead);
  return {
    schemaVersion: SCHEMA_VERSION,
    worldVersion: WORLD_VERSION,
    savedAt: Date.now(),
    player: {
      x: finite(d.x, 16),
      y: finite(d.y, 12),
      z: finite(d.z, 102),
      yaw: finite(d.yaw, 0),
      camYaw: finite(d.camYaw, 0),
      hp: finite(d.hp, 3),
      heartsMax: finite(d.heartsMax, 3),
      staminaMax: finite(d.staminaMax, 100),
      arrows: finite(d.arrows, 0),
      amber: finite(d.amber, 0),
      art: Math.min(4, finite(d.art, 0) + 1),
      spicy: 0,
    },
    inventory: {
      weapons,
      meals: Array.isArray(d.meals) ? (d.meals as InvMeal[]) : [],
      mats: d.mats && typeof d.mats === "object" ? (d.mats as Record<string, number>) : {},
      equippedId: weapons.find((w) => w.kind !== "bow")?.id ?? null,
      bowId: weapons.find((w) => w.kind === "bow")?.id ?? null,
    },
    progress: {
      towers: strings(d.towers),
      shrines: strings(d.shrines),
      wisps: strings(d.wisps),
      chests: strings(d.chests),
      orbs,
      bossDead,
      ruinSolved: Boolean(d.ruinSolved),
      sealRule: bossDead || orbs >= 4 ? "legacy-orbs" : "towers-and-shrines",
    },
    checkpoint: { id: "legacy", x: finite(d.x, 16), y: finite(d.y, 12), z: finite(d.z, 102) },
  };
}

export function memoryStorage(initial: Record<string, string> = {}): SaveStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

export function browserStorage(): SaveStorage {
  return {
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      localStorage.setItem(key, value);
    },
    removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export function loadSave(storage: SaveStorage): LoadResult {
  const v2 = storage.getItem(SAVE_KEY_V2);
  const v1 = storage.getItem(SAVE_KEY_V1);
  const raw = v2 ?? v1;
  if (!raw) return { ok: false, reason: "missing", backupKept: false, raw: null };
  const data = parseSave(raw);
  if (!data) {
    try {
      if (v1 && !storage.getItem(SAVE_BACKUP)) storage.setItem(SAVE_BACKUP, v1);
    } catch {
      /* keep going */
    }
    return { ok: false, reason: "corrupt", backupKept: Boolean(v1), raw };
  }
  if (v1 && !v2) {
    try {
      if (!storage.getItem(SAVE_BACKUP)) storage.setItem(SAVE_BACKUP, v1);
    } catch {
      /* ignore */
    }
  }
  return { ok: true, data, migrated: !v2 && Boolean(v1), source: v2 ? "v2" : "v1" };
}

export function writeSave(storage: SaveStorage, env: SaveEnvelope): { ok: true } | { ok: false; error: string } {
  const payload = JSON.stringify({ ...env, schemaVersion: SCHEMA_VERSION, savedAt: Date.now() });
  try {
    storage.setItem(SAVE_KEY_V2, payload);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "write failed" };
  }
}

export function resolveWeaponIds(weapons: InvWeapon[], equippedId: string | null, bowId: string | null) {
  const melee = weapons.find((w) => w.id === equippedId && w.kind !== "bow") ?? weapons.find((w) => w.kind !== "bow") ?? null;
  const bow = weapons.find((w) => w.id === bowId && w.kind === "bow") ?? weapons.find((w) => w.kind === "bow") ?? null;
  return { equippedId: melee?.id ?? null, bowId: bow?.id ?? null, melee, bow };
}

export function sealOpen(progress: SaveEnvelope["progress"]): boolean {
  if (progress.bossDead) return true;
  if (progress.sealRule === "legacy-orbs") return progress.orbs >= 4 || progress.shrines.length >= 4;
  return progress.towers.length >= 3 && progress.shrines.length >= 4;
}
