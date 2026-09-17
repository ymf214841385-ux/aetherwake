import { create } from "zustand";

export type Mode =
  | "title"
  | "playing"
  | "paused"
  | "inventory"
  | "map"
  | "dead"
  | "ending"
  | "cooking"
  | "dialogue";

export type InvWeapon = {
  id: string;
  name: string;
  dmg: number;
  dur: number;
  max: number;
  kind: "sword" | "claymore" | "bow";
};

export type InvMeal = {
  id: string;
  name: string;
  hearts: number;
  spicy?: boolean;
};

export type Marker = {
  id: string;
  name: string;
  done: boolean;
  x: number;
  z: number;
  kind: "tower" | "shrine" | "camp" | "citadel" | "wisp";
};

export type HudState = {
  mode: Mode;
  hearts: number;
  heartsMax: number;
  hp: number;
  stamina: number;
  staminaMax: number;
  climbing: boolean;
  gliding: boolean;
  swimming: boolean;
  cold: boolean;
  spicy: number;
  raining: boolean;
  timeOfDay: number;
  weapon: InvWeapon | null;
  bow: InvWeapon | null;
  arrows: number;
  art: number;
  artNames: string[];
  artsOn: boolean[];
  prompt: string;
  toast: string;
  objective: string;
  amber: number;
  orbs: number;
  px: number;
  pz: number;
  py: number;
  yaw: number;
  camYaw: number;
  markers: Marker[];
  meals: InvMeal[];
  materials: { id: string; name: string; n: number }[];
  weapons: InvWeapon[];
  dialogue: string;
  shrineHint: string;
  hasSave: boolean;
  temp: number;
  aiming: boolean;
  saveError: string;
  portrait: boolean;
  windCd: number;
  quality: string;
  tutorial: string;
  glLost: boolean;
  glRestoredAt: number;
  questTitle: string;
  questNext: string;
  questPhase: string;
  questDistance: number | null;
  questRouteCost: number | null;
  questRouteStatus: string | null;
  questRouteHint: string | null;
  routeWorldId: string | null;
  routeGuidance: string;
  routeNextAction: string;
  routeRequiredArt: string | null;
  routeTargetId: string | null;
  /** Validated walk polylines for map/world render (x,y,z per point). */
  routePolylines: { id: string; kind: string; points: { x: number; y: number; z: number }[] }[];
  /** Stable map selection until completed/invalid/world change. */
  selectedMarkerId: string | null;
};

const ART_NAMES = ["引风", "爆鸣", "霜息", "牵引", "凝时"];

export const useHud = create<HudState>(() => ({
  mode: "title",
  hearts: 3,
  heartsMax: 3,
  hp: 3,
  stamina: 100,
  staminaMax: 100,
  climbing: false,
  gliding: false,
  swimming: false,
  cold: false,
  spicy: 0,
  raining: false,
  timeOfDay: 0.22,
  weapon: null,
  bow: null,
  arrows: 20,
  art: 0,
  artNames: ART_NAMES,
  artsOn: [true, true, true, true, true],
  prompt: "",
  toast: "",
  objective: "登上晨光塔，眺望这片原野",
  amber: 0,
  orbs: 0,
  px: 16,
  pz: 100,
  py: 28,
  yaw: 0,
  camYaw: 0,
  markers: [],
  meals: [],
  materials: [],
  weapons: [],
  dialogue: "",
  shrineHint: "",
  hasSave: false,
  temp: 1,
  aiming: false,
  saveError: "",
  portrait: false,
  windCd: 0,
  quality: "auto",
  tutorial: "",
  glLost: false,
  glRestoredAt: 0,
  questTitle: "点亮晨光塔",
  questNext: "沿指引前往晨光塔塔脚攀爬点",
  questPhase: "approach",
  questDistance: null,
  questRouteCost: null,
  questRouteStatus: null,
  questRouteHint: null,
  routeWorldId: null,
  routeGuidance: "",
  routeNextAction: "",
  routeRequiredArt: null,
  routeTargetId: null,
  routePolylines: [],
  selectedMarkerId: null,
}));

export function hasSaveFile() {
  try {
    return Boolean(localStorage.getItem("aetherwake-save-v2") || localStorage.getItem("aetherwake-save-v1"));
  } catch {
    return false;
  }
}
