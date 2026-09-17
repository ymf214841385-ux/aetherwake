/**
 * E02 storage failure: save throws — player must be told progress is in memory only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Sim } from "./sim.ts";
import type { SaveStorage } from "./persistence.ts";

describe("E02 storage failure honesty", () => {
  it("setItem throw surfaces saveError and does not claim disk save", () => {
    const storage: SaveStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const sim = new Sim(storage);
    sim.mode = "playing";
    sim.save();
    assert.ok(sim.saveError.length > 0, "must set saveError");
    assert.match(sim.saveError, /内存|保存|失败|进度/i);
  });
});

describe("D07 rotation / portrait", () => {
  it("portrait flag set by bindTouchOrientation contract", async () => {
    const { bindTouchOrientation } = await import("./touch-input.ts");
    const listeners: Record<string, (() => void)[]> = {};
    const win = {
      innerWidth: 400,
      innerHeight: 800,
      addEventListener: (k: string, fn: () => void) => {
        (listeners[k] ||= []).push(fn);
      },
      removeEventListener: () => {},
    } as unknown as Window;
    const sim = { portrait: false, syncHud: () => {} };
    const unbind = bindTouchOrientation(win, sim);
    assert.equal(sim.portrait, true, "portrait height > width");
    unbind();
  });
});
