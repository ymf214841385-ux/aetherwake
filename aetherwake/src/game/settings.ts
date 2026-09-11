import { SETTINGS_KEY } from "./params.ts";

export type Quality = "auto" | "low" | "mid" | "high";

export type Settings = {
  lookSens: number;
  invertY: boolean;
  shake: number;
  masterVol: number;
  sfxVol: number;
  musicVol: number;
  quality: Quality;
  lockDay: boolean;
};

export const defaultSettings = (): Settings => ({
  lookSens: 1,
  invertY: false,
  shake: 1,
  masterVol: 0.7,
  sfxVol: 0.9,
  musicVol: 0.22,
  quality: "auto",
  lockDay: true,
});

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return base;
    const d = JSON.parse(raw) as Partial<Settings>;
    return { ...base, ...d };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}
