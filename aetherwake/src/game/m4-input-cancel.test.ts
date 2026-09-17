/**
 * M4 input cancellation / multi-pointer / mode-clear regressions (production binders).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindInput, resetInput, setWorldClickHandler, touch } from "./input.ts";
import { bindTouchInput as bindTouch } from "./touch-input.ts";
import { inputDomFixture } from "./input-dom.test-support.ts";

describe("M4 multi-pointer and cancel", () => {
  it("second finger cannot steal stick ownership", () => {
    const fx = inputDomFixture();
    try {
      resetInput();
      const unbind = bindTouch({ stick: fx.stick.asElement(), look: fx.look.asElement(), buttons: [] });
      fx.pointer(fx.stick, "pointerdown", 1, 10, 10);
      fx.pointer(fx.stick, "pointermove", 1, 10, -40);
      const held = { x: touch.stickX, y: touch.stickY };
      fx.pointer(fx.stick, "pointerdown", 2, 12, 12);
      fx.pointer(fx.stick, "pointermove", 2, 12, 50);
      assert.equal(touch.stickX, held.x, "finger 2 must not overwrite stick");
      fx.pointer(fx.stick, "pointerup", 1);
      fx.pointer(fx.stick, "pointerup", 2);
      assert.equal(touch.stickX, 0);
      unbind();
    } finally {
      fx.restore();
    }
  });

  it("pointercancel clears stick without leftover motion", () => {
    const fx = inputDomFixture();
    try {
      resetInput();
      const unbind = bindTouch({ stick: fx.stick.asElement(), look: fx.look.asElement(), buttons: [] });
      fx.pointer(fx.stick, "pointerdown", 1, 0, 0);
      fx.pointer(fx.stick, "pointermove", 1, 0, -30);
      assert.notEqual(touch.stickX + touch.stickY, 0);
      fx.pointer(fx.stick, "pointercancel", 1);
      assert.equal(touch.stickX, 0);
      assert.equal(touch.stickY, 0);
      unbind();
    } finally {
      fx.restore();
    }
  });

  it("window blur / visibility reset clears held stick (bindInput)", () => {
    const fx = inputDomFixture();
    try {
      resetInput();
      const unbind = bindInput(fx.canvas.asElement());
      const unbindTouch = bindTouch({ stick: fx.stick.asElement(), look: fx.look.asElement(), buttons: [] });
      fx.pointer(fx.stick, "pointerdown", 1, 0, 0);
      fx.pointer(fx.stick, "pointermove", 1, 20, -20);
      assert.notEqual(touch.stickX, 0);
      fx.win.dispatchEvent(new Event("blur"));
      assert.equal(touch.stickX, 0);
      unbind();
      unbindTouch();
    } finally {
      fx.restore();
    }
  });

  it("look short-tap vs drag: drag does not enqueue interact/attack", () => {
    const fx = inputDomFixture();
    try {
      resetInput();
      let clicks = 0;
      setWorldClickHandler(() => {
        clicks += 1;
      });
      const unbind = bindTouch({ stick: fx.stick.asElement(), look: fx.look.asElement(), buttons: [] });
      // Drag look
      fx.pointer(fx.look, "pointerdown", 1, 0, 0);
      fx.pointer(fx.look, "pointermove", 1, 40, 10);
      fx.pointer(fx.look, "pointerup", 1);
      assert.equal(clicks, 0, "drag must not world-click");
      unbind();
      setWorldClickHandler(null);
    } finally {
      fx.restore();
    }
  });

  it("three pointers: stick + look + button can be owned simultaneously", () => {
    const fx = inputDomFixture();
    try {
      resetInput();
      const unbind = bindTouch({
        stick: fx.stick.asElement(),
        look: fx.look.asElement(),
        buttons: [fx.buttons.jump.asElement(), fx.buttons.attack.asElement()],
      });
      fx.pointer(fx.stick, "pointerdown", 1, 0, 0);
      fx.pointer(fx.stick, "pointermove", 1, 0, -20);
      fx.pointer(fx.look, "pointerdown", 2, 0, 0);
      fx.pointer(fx.look, "pointermove", 2, 15, 5);
      fx.pointer(fx.buttons.attack, "pointerdown", 3, 0, 0);
      assert.notEqual(touch.stickY, 0);
      assert.notEqual(touch.lookX, 0);
      // Release only stick — look ownership remains until its release
      fx.pointer(fx.stick, "pointerup", 1);
      assert.equal(touch.stickX, 0);
      assert.notEqual(touch.lookX, 0, "look must survive stick release");
      fx.pointer(fx.look, "pointerup", 2);
      fx.pointer(fx.buttons.attack, "pointerup", 3);
      unbind();
    } finally {
      fx.restore();
    }
  });
});
