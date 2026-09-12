import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClock, pauseClock, resumeClock, tickClock } from "./clock.ts";
import {
  bindInput,
  enqueueCommand,
  injectLookForTest,
  pendingCommandCount,
  pressKeyForTest,
  releaseKeyForTest,
  resetInput,
  sampleActions,
  takeSimActions,
  touch,
} from "./input.ts";
import { inputDomFixture } from "./input-dom.test-support.ts";
import { FIXED_DT } from "./params.ts";

describe("B01 keyboard / touch sprint isolation", () => {
  it("W alone walks, Shift+W sprints", () => {
    resetInput();
    pressKeyForTest("KeyW");
    const walk = takeSimActions({ consumeCommands: false, consumeLook: false });
    assert.equal(walk.sprint, false);
    assert.ok(walk.moveY > 0.9);
    pressKeyForTest("ShiftLeft");
    const run = takeSimActions({ consumeCommands: false, consumeLook: false });
    assert.equal(run.sprint, true);
    releaseKeyForTest("KeyW");
    releaseKeyForTest("ShiftLeft");
  });

  it("touch outer-ring sprint does not force keyboard W to sprint", () => {
    resetInput();
    pressKeyForTest("KeyW");
    touch.stickX = 0;
    touch.stickY = 0.5;
    const a = takeSimActions({ consumeCommands: false, consumeLook: false });
    assert.equal(a.sprint, false);
    touch.stickY = 1;
    const b = takeSimActions({ consumeCommands: false, consumeLook: false });
    assert.equal(b.sprint, true);
    resetInput();
    pressKeyForTest("KeyW");
    const c = takeSimActions({ consumeCommands: false, consumeLook: false });
    assert.equal(c.sprint, false);
  });

  it("diagonal keyboard input is normalized", () => {
    resetInput();
    pressKeyForTest("KeyW");
    pressKeyForTest("KeyD");
    const a = takeSimActions({ consumeCommands: false, consumeLook: false });
    assert.ok(Math.abs(Math.hypot(a.moveX, a.moveY) - 1) < 1e-6);
  });
});

describe("B02 one-shot commands stay queued until a sim step", () => {
  it("does not drop or duplicate 100 short presses across mixed rates", () => {
    const rates = [30, 60, 90, 120, 144];
    for (const hz of rates) {
      resetInput();
      let consumed = 0;
      const frame = 1 / hz;
      let acc = 0;
      for (let i = 0; i < 100; i++) {
        enqueueCommand("jump");
        acc += frame;
        while (acc >= FIXED_DT) {
          const a = takeSimActions({ consumeCommands: true, consumeLook: true });
          if (a.jump) consumed += 1;
          acc -= FIXED_DT;
        }
      }
      while (pendingCommandCount() > 0 || acc >= FIXED_DT) {
        const a = takeSimActions({ consumeCommands: true, consumeLook: true });
        if (a.jump) consumed += 1;
        acc = Math.max(0, acc - FIXED_DT);
        if (pendingCommandCount() === 0 && acc < FIXED_DT) break;
      }
      assert.equal(consumed, 100, `hz=${hz} consumed ${consumed}`);
    }
  });

  it("random frame jitter still consumes each event once", () => {
    resetInput();
    let consumed = 0;
    let acc = 0;
    for (let i = 0; i < 120; i++) {
      enqueueCommand("attack");
      acc += 0.004 + (i % 7) * 0.003;
      while (acc >= FIXED_DT) {
        const a = takeSimActions({ consumeCommands: true, consumeLook: false });
        if (a.attack) consumed += 1;
        acc -= FIXED_DT;
      }
    }
    while (pendingCommandCount() > 0) {
      const a = takeSimActions({ consumeCommands: true, consumeLook: false });
      if (a.attack) consumed += 1;
    }
    assert.equal(consumed, 120);
  });

  it("sampleActions leftover path still works", () => {
    resetInput();
    enqueueCommand("interact");
    const a = sampleActions();
    assert.equal(a.interact, true);
    const b = sampleActions();
    assert.equal(b.interact, false);
  });
});

describe("clock + look", () => {
  it("look is applied once per render catch-up", () => {
    resetInput();
    injectLookForTest(20, -6);
    const clock = createClock();
    const looks: number[] = [];
    tickClock(clock, FIXED_DT * 3.2, (_dt, a) => looks.push(a.lookX));
    assert.equal(looks[0], 20);
    assert.ok(looks.slice(1).every((v) => v === 0));
  });

  it("arrow keys look without pointer lock", () => {
    resetInput();
    pressKeyForTest("ArrowRight");
    const a = takeSimActions({ consumeCommands: false, consumeLook: true });
    assert.ok(a.lookX > 10, `lookX=${a.lookX}`);
    assert.ok(Math.abs(a.moveX) < 0.01 && Math.abs(a.moveY) < 0.01, "arrows must not strafe");
    releaseKeyForTest("ArrowRight");
  });

  it("pause clears accumulator", () => {
    const clock = createClock();
    clock.acc = 30;
    pauseClock(clock);
    assert.equal(clock.acc, 0);
    resumeClock(clock);
    const n: number[] = [];
    tickClock(clock, 0.016, () => n.push(1));
    assert.ok(n.length <= 2);
  });
});

describe("resetInput", () => {
  it("clears held keys, queue, look and touch", () => {
    pressKeyForTest("KeyW");
    enqueueCommand("attack");
    injectLookForTest(4, 1);
    touch.stickX = 1;
    resetInput();
    const a = takeSimActions({ consumeCommands: true, consumeLook: true });
    assert.equal(a.moveX, 0);
    assert.equal(a.attack, false);
    assert.equal(a.lookX, 0);
    assert.equal(pendingCommandCount(), 0);
  });
});

describe("P1-1 real bindInput listener lifecycle", () => {
  it("unrelated touch cancellation preserves held keyboard and queued dodge", () => {
    const f = inputDomFixture();
    const unbind = bindInput(f.canvas.asElement());
    try {
      f.dispatch(f.win, "keydown", { code: "KeyW", repeat: false });
      f.dispatch(f.win, "keydown", { code: "KeyC", repeat: false });
      f.pointer(f.canvas, "pointercancel", 91);
      f.pointer(f.canvas, "lostpointercapture", 91);
      const a = sampleActions();
      assert.equal(a.moveY, 1);
      assert.equal(a.dodge, true);
    } finally { unbind(); f.restore(); }
  });

  it("bind-dispose removes document/window/canvas listeners and permits one clean rebind", () => {
    const f = inputDomFixture();
    let unbind = () => {};
    try {
      for (let i = 0; i < 4; i++) {
        unbind = bindInput(f.canvas.asElement());
        f.dispatch(f.win, "keydown", { code: "KeyC", repeat: false });
        assert.equal(pendingCommandCount(), 1);
        assert.equal(sampleActions().dodge, true);
        unbind();
        assert.equal(f.win.listenerCount(), 0);
        assert.equal(f.doc.listenerCount(), 0);
        assert.equal(f.canvas.listenerCount(), 0);
        assert.equal(f.dispatch(f.canvas, "contextmenu").defaultPrevented, false);
      }
    } finally { unbind(); f.restore(); }
  });

  it("real repeat/keyup and right-mouse listeners retain keyboard and mouse semantics", () => {
    const f = inputDomFixture();
    const unbind = bindInput(f.canvas.asElement());
    try {
      f.dispatch(f.win, "keydown", { code: "Space", repeat: false });
      f.dispatch(f.win, "keydown", { code: "Space", repeat: true });
      assert.equal(pendingCommandCount(), 1);
      assert.equal(sampleActions().jumpHeld, true);
      f.dispatch(f.win, "keyup", { code: "Space" });
      assert.equal(sampleActions().jumpHeld, false);
      f.dispatch(f.canvas, "mousedown", { button: 2 });
      f.dispatch(f.win, "mousemove", { buttons: 2, movementX: 6, movementY: -2 });
      const a = sampleActions();
      assert.equal(a.bow, true);
      assert.equal(a.lookX, 6);
      assert.equal(a.lookY, -2);
      f.dispatch(f.win, "mouseup", { button: 2 });
      assert.equal(sampleActions().bow, false);
    } finally { unbind(); f.restore(); }
  });
});
