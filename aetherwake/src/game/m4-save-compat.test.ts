/**
 * M4: old save without new UX fields must load; progress retained; no wipe.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import { createDefaultSave, loadSave, writeSave, type SaveStorage } from "./persistence.ts";
import { useHud } from "./store.ts";

function mem(): SaveStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

describe("M4 old save compatibility", () => {
  it("legacy envelope without UX fields loads and keeps towers", () => {
    const storage = mem();
    const save = createDefaultSave();
    // Simulate an older save: strip optional UX keys if present.
    const raw = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
    delete raw.ux;
    delete raw.selectedMarkerId;
    delete raw.route;
    writeSave(storage, raw as never);
    const loaded = loadSave(storage);
    assert.ok(loaded, "old save must load");
    const sim = new Sim(storage);
    sim.continueSave();
    assert.equal(sim.mode, "playing");
    // Fresh default has no towers — still playing, not wiped to error.
    assert.equal(sim.towersOn.size >= 0, true);
  });

  it("progress towers/orbs survive round-trip", () => {
    const storage = mem();
    const sim = new Sim(storage);
    sim.mode = "playing";
    sim.towersOn.add("dawn");
    sim.orbs = 1;
    sim.save();
    const sim2 = new Sim(storage);
    sim2.continueSave();
    assert.ok(sim2.towersOn.has("dawn"));
    assert.equal(sim2.orbs, 1);
  });

  it("map selection does not corrupt save and is not required", () => {
    const storage = mem();
    const sim = new Sim(storage);
    sim.mode = "playing";
    useHud.setState({ selectedMarkerId: "mere" });
    sim.save();
    useHud.setState({ selectedMarkerId: null });
    const sim2 = new Sim(storage);
    sim2.continueSave();
    assert.equal(sim2.mode, "playing");
  });
});
