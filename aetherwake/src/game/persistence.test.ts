import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultSave,
  loadSave,
  memoryStorage,
  parseSave,
  resolveWeaponIds,
  sealOpen,
  writeSave,
} from "./persistence.ts";
import { SAVE_BACKUP, SAVE_KEY_V1, SAVE_KEY_V2 } from "./params.ts";

describe("B10 save protection", () => {
  it("keeps legal zeros for position and arrows", () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      worldVersion: 2,
      player: { x: 0, y: 0, z: 0, arrows: 0, hp: 3, heartsMax: 3, staminaMax: 100, yaw: 0, camYaw: 0, amber: 0, art: 0 },
      inventory: { weapons: [], meals: [], mats: {}, equippedId: null, bowId: null },
      progress: { towers: [], shrines: [], wisps: [], chests: [], orbs: 0, bossDead: false, sealRule: "towers-and-shrines" },
      checkpoint: { id: "c", x: 0, y: 0, z: 0 },
    });
    const s = parseSave(raw);
    assert.ok(s);
    assert.equal(s.player.x, 0);
    assert.equal(s.player.y, 0);
    assert.equal(s.player.z, 0);
    assert.equal(s.player.arrows, 0);
  });

  it("does not overwrite v1 when continue reads a missing v2", () => {
    const v1 = JSON.stringify({ x: 8, y: 4, z: 9, arrows: 0, hp: 2, towers: ["dawn"], orbs: 0 });
    const store = memoryStorage({ [SAVE_KEY_V1]: v1 });
    const loaded = loadSave(store);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.data.player.x, 8);
    assert.equal(loaded.data.player.arrows, 0);
    assert.equal(store.getItem(SAVE_KEY_V1), v1);
    assert.equal(store.getItem(SAVE_BACKUP), v1);
  });

  it("corrupt save keeps original bytes and does not write a new game", () => {
    const bad = "{not json";
    const store = memoryStorage({ [SAVE_KEY_V1]: bad });
    const loaded = loadSave(store);
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.reason, "corrupt");
    assert.equal(store.getItem(SAVE_KEY_V1), bad);
    assert.equal(store.getItem(SAVE_BACKUP), bad);
    assert.equal(store.getItem(SAVE_KEY_V2), null);
  });

  it("ruinSolved persists across writeSave/loadSave (not a designed reset)", () => {
    const store = memoryStorage();
    const env = createDefaultSave();
    env.progress.ruinSolved = true;
    env.progress.towers = ["dawn"];
    const w = writeSave(store, env);
    assert.equal(w.ok, true);
    const loaded = loadSave(store);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.data.progress.ruinSolved, true);
    assert.deepEqual(loaded.data.progress.towers, ["dawn"]);
    const omitted = parseSave(
      JSON.stringify({
        schemaVersion: 2,
        worldVersion: 2,
        player: { x: 1, y: 2, z: 3, hp: 3, heartsMax: 3, staminaMax: 100 },
        inventory: { weapons: [], meals: [], mats: {}, equippedId: null, bowId: null },
        progress: { towers: [], shrines: [], wisps: [], chests: [], orbs: 0, bossDead: false, sealRule: "towers-and-shrines" },
        checkpoint: { id: "c", x: 0, y: 0, z: 0 },
      }),
    );
    assert.equal(omitted?.progress.ruinSolved, false);
  });

  it("writeSave only touches v2", () => {
    const v1 = '{"x":1}';
    const store = memoryStorage({ [SAVE_KEY_V1]: v1 });
    const env = createDefaultSave();
    env.player.x = 42;
    const w = writeSave(store, env);
    assert.equal(w.ok, true);
    assert.equal(store.getItem(SAVE_KEY_V1), v1);
    assert.ok(store.getItem(SAVE_KEY_V2)?.includes('"x":42'));
  });
});

describe("B11 weapon ids", () => {
  it("removing a broken sword keeps a valid melee and bow", () => {
    const weapons = [
      { id: "blade", name: "旅人短剑", dmg: 18, dur: 0, max: 24, kind: "sword" as const },
      { id: "bow", name: "林间长弓", dmg: 12, dur: 20, max: 20, kind: "bow" as const },
      { id: "clay", name: "野木阔刀", dmg: 32, dur: 14, max: 14, kind: "claymore" as const },
    ];
    const left = weapons.filter((w) => w.id !== "blade");
    const ids = resolveWeaponIds(left, "blade", "bow");
    assert.equal(ids.equippedId, "clay");
    assert.equal(ids.bowId, "bow");
  });
});

describe("seal rules", () => {
  it("new games need three towers and four shrines", () => {
    const p = createDefaultSave().progress;
    p.towers = ["dawn", "mere", "crown"];
    p.shrines = ["rime", "burst", "pull"];
    p.orbs = 3;
    assert.equal(sealOpen(p), false);
    p.shrines.push("still");
    p.orbs = 4;
    assert.equal(sealOpen(p), true);
  });

  it("legacy orbs rule is kept for old clears", () => {
    const p = createDefaultSave().progress;
    p.sealRule = "legacy-orbs";
    p.orbs = 4;
    p.towers = [];
    assert.equal(sealOpen(p), true);
  });
});
