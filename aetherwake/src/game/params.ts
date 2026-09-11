/** Central gameplay numbers. 1 world unit ≈ 1 meter. */

export const FIXED_DT = 1 / 60;
export const MAX_SIM_STEPS = 4;

export const PLAYER_HEIGHT = 1.76;
export const PLAYER_RADIUS = 0.32;
export const EYE_HEIGHT = 1.18;

export const WALK_SPEED = 4.4;
export const SPRINT_SPEED = 7.2;
export const SWIM_SPEED = 3.6;
export const ACCEL_TIME = 0.18;
export const BRAKE_TIME = 0.14;
export const AIR_CONTROL = 0.55;

export const GRAVITY = 22;
export const JUMP_VELOCITY = 7.7;
export const JUMP_BUFFER = 0.13;
export const COYOTE_TIME = 0.1;
export const STEP_UP = 0.55;
export const FOOT_SNAP = 0.62;

export const CLIMB_SPEED = 3.4;
export const CLIMB_STAMINA = 15;
/** Closest-point reach for a climb-to-ledge mantle. Center-to-center 12 m snaps are forbidden. */
export const MANTLE_REACH_XZ = 1.85;
export const MANTLE_REACH_Y = 2.1;
export const MANTLE_STEP_XZ = 0.12;
export const MANTLE_STEP_Y = 0.18;
export const CLIMB_SHIMMY = 2.2;
export const SPRINT_STAMINA = 14;
export const GLIDE_STAMINA = 6;
export const STAMINA_REGEN = 28;
export const BASE_STAMINA = 100;
export const WISP_STAMINA = 8;

export const GLIDE_SINK = -2.2;
export const GLIDE_MAX_XZ = 11;
export const GLIDE_TURN = 2.4;

export const DODGE_SPEED = 11;
export const DODGE_TIME = 0.28;
export const DODGE_IFRAMES = 0.18;
export const DODGE_COOLDOWN = 0.7;
export const DODGE_STAMINA = 18;

export const CAM_FOV = 54;
export const CAM_DIST = 6.2;
export const CAM_DIST_GLIDE = 8.4;
export const CAM_DIST_CLIMB = 5.4;
export const CAM_DIST_AIM = 4.4;
export const CAM_PITCH_MIN = 0.04;
export const CAM_PITCH_MAX = 1.22;
export const LOOK_SENS = 0.0022;

export const ATTACK_WINDUP = 0.1;
export const ATTACK_ACTIVE = 0.14;
export const ATTACK_RECOVER = 0.16;
export const ATTACK_RANGE = 2.15;
export const ATTACK_RANGE_HEAVY = 2.85;
export const ATTACK_ARC = 0.72;
export const ATTACK_HEIGHT = 1.35;

export const TOUCH_SPRINT = 0.92;
export const TOUCH_DEADZONE = 0.12;

export const SAVE_KEY_V1 = "aetherwake-save-v1";
export const SAVE_KEY_V2 = "aetherwake-save-v2";
export const SAVE_BACKUP = "aetherwake-save-v1-backup";
export const SETTINGS_KEY = "aetherwake-settings-v1";
export const SCHEMA_VERSION = 2;
export const WORLD_VERSION = 2;

export const DAY_SECONDS = 1200;
export const BENCHMARK_TOD = 0.22;

export const ART_NAMES = ["引风", "爆鸣", "霜息", "牵引", "凝时"] as const;
export const ART_BURST = 1;
export const ART_RIME = 2;
export const ART_PULL = 3;
export const ART_STILL = 4;
export const ART_WIND = 0;

export const GUST_DURATION = 1.35;
export const GUST_COOLDOWN = 2.8;
export const GUST_RADIUS = 9.5;
export const GUST_STRENGTH = 18;
export const GUST_STAMINA = 12;
