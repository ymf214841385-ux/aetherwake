import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindInput,
  dispatchWorldClick,
  enqueueCommand,
  pendingCommandCount,
  resetInput,
  sampleActions,
  setWorldClickHandler,
  takeSimActions,
} from "./input.ts";
import { inputDomFixture } from "./input-dom.test-support.ts";

describe("B01 world click is not unconditional attack", () => {
  it("handler can convert click to interact when a target exists", () => {
    resetInput();
    setWorldClickHandler(() => enqueueCommand("interact"));
    dispatchWorldClick({ clientX: 10, clientY: 10, pointerLocked: false, source: "mouse" });
    const a = takeSimActions({ consumeCommands: true, consumeLook: false });
    assert.equal(a.interact, true);
    assert.equal(a.attack, false);
    setWorldClickHandler(null);
  });

  it("without handler, mouse path still falls back to attack", () => {
    resetInput();
    setWorldClickHandler(null);
    dispatchWorldClick({ clientX: 1, clientY: 1, pointerLocked: true, source: "mouse" });
    const a = takeSimActions({ consumeCommands: true, consumeLook: false });
    assert.equal(a.attack, true);
    assert.equal(a.interact, false);
  });

  it("UI clicks never reach the world handler", () => {
    const fx = inputDomFixture();
    try {
      resetInput();
      let calls = 0;
      setWorldClickHandler(() => {
        calls += 1;
      });
      bindInput(fx.canvas.asElement());
      const btn = new Event("mousedown", { bubbles: true });
      Object.assign(btn, { button: 0, clientX: 5, clientY: 5 });
      // Closest on a real UI ancestor: emulate via target closest returning truthy.
      const ui = Object.create(fx.canvas);
      ui.closest = () => fx.canvas;
      Object.defineProperty(btn, "target", { value: ui });
      fx.canvas.dispatchEvent(btn);
      assert.equal(calls, 0);
      assert.equal(pendingCommandCount(), 0);
      setWorldClickHandler(null);
    } finally {
      fx.restore();
    }
  });

  it("sampleActions still drains one-shots once", () => {
    resetInput();
    enqueueCommand("interact");
    const a = sampleActions();
    assert.equal(a.interact, true);
    const b = sampleActions();
    assert.equal(b.interact, false);
  });
});
