import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindInput, pendingCommandCount, resetInput, takeSimActions } from "./input.ts";
import { inputDomFixture } from "./input-dom.test-support.ts";
import { memoryStorage } from "./persistence.ts";
import { Sim } from "./sim.ts";
import { bindTouchInput, bindTouchOrientation } from "./touch-input.ts";

const actions = () => takeSimActions({ consumeCommands: true, consumeLook: true });

function simTransitionWithoutAudio(transition: () => void) {
  // Use Sim's normal Node/no-audio path during the transition. Registered DOM
  // targets and reset listeners stay intact; no game/input state is replaced.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  Reflect.deleteProperty(globalThis, "window");
  try { transition(); } finally { Object.defineProperty(globalThis, "window", descriptor); }
}

function boundFixture() {
  const f = inputDomFixture();
  const unbindInput = bindInput(f.canvas.asElement());
  const bindTouch = () => bindTouchInput({
    stick: f.stick.asElement(),
    look: f.look.asElement(),
    buttons: Object.values(f.buttons).map((button) => button.asElement()),
  });
  let unbindTouch = bindTouch();
  return {
    ...f,
    unbindTouch: () => unbindTouch(),
    rebindTouch: () => { unbindTouch = bindTouch(); },
    dispose: () => { unbindTouch(); unbindInput(); f.restore(); },
    walk: () => { f.pointer(f.stick, "pointerdown", 1); f.pointer(f.stick, "pointermove", 1, 0, -27); },
  };
}

describe("P1-1 production touch DOM listeners", () => {
  for (const release of ["pointerup", "pointercancel", "lostpointercapture"]) {
    it(`${release} on look preserves another finger's movement and queued attack`, () => {
      const f = boundFixture();
      try {
        f.walk();
        f.pointer(f.look, "pointerdown", 2);
        f.pointer(f.look, "pointermove", 2, 10, 5);
        f.pointer(f.buttons.attack!, "pointerdown", 3);
        f.pointer(f.look, release, 2);
        const a = actions();
        assert.equal(a.moveY, 0.5);
        assert.equal(a.lookX, 9, "already emitted look delta is consumed once");
        assert.equal(a.attack, true);
        assert.equal(actions().attack, false);
        f.pointer(f.look, "pointermove", 2, 50, 50);
        assert.equal(actions().lookX, 0, "released pointer no longer owns look");
      } finally { f.dispose(); }
    });
  }

  it("first stick pointer remains owner when a second pointer lands and releases", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.pointer(f.stick, "pointerdown", 2, 100, 100);
      f.pointer(f.stick, "pointermove", 2, 154, 100);
      f.pointer(f.stick, "pointerup", 2);
      assert.equal(actions().moveY, 0.5);
      assert.equal(f.stick.captured.has(2), false);
      f.pointer(f.stick, "pointermove", 1, 0, -40.5);
      assert.equal(actions().moveY, 0.75);
    } finally { f.dispose(); }
  });

  it("repeat pointerdown cannot change the original anchor", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.pointer(f.stick, "pointerdown", 1, 100, 100);
      f.pointer(f.stick, "pointermove", 1, 0, -27);
      assert.equal(actions().moveY, 0.5);
    } finally { f.dispose(); }
  });

  it("a pointer owned by stick cannot also own look or release stick through look", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.pointer(f.look, "pointerdown", 1);
      f.pointer(f.look, "pointermove", 1, 20, 20);
      f.pointer(f.look, "pointercancel", 1);
      assert.equal(actions().moveY, 0.5);
      assert.equal(actions().lookX, 0);
      assert.equal(f.stick.captured.has(1), true);
    } finally { f.dispose(); }
  });

  it("unknown pointer cancellation does not erase keyboard, stick or queued commands", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.dispatch(f.win, "keydown", { code: "KeyW", repeat: false });
      f.pointer(f.buttons.attack!, "pointerdown", 3);
      f.pointer(f.look, "pointercancel", 77);
      f.pointer(f.look, "lostpointercapture", 77);
      const a = actions();
      assert.equal(a.moveY, 1);
      assert.equal(a.attack, true);
    } finally { f.dispose(); }
  });

  it("jump owns held state; another finger's release neither releases jump nor drops its command", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.pointer(f.buttons.jump!, "pointerdown", 3);
      f.pointer(f.look, "pointerdown", 2);
      f.pointer(f.look, "pointerup", 2);
      const first = actions();
      assert.equal(first.jumpHeld, true);
      assert.equal(first.jump, true);
      assert.equal(first.moveY, 0.5);
      f.pointer(f.buttons.jump!, "pointercancel", 3);
      const after = actions();
      assert.equal(after.jumpHeld, false);
      assert.equal(after.moveY, 0.5);
      assert.equal(after.jump, false);
    } finally { f.dispose(); }
  });

  it("second jump pointer cannot release or repeat the owner's accepted press", () => {
    const f = boundFixture();
    try {
      f.pointer(f.buttons.jump!, "pointerdown", 3);
      f.pointer(f.buttons.jump!, "pointerdown", 3);
      f.pointer(f.buttons.jump!, "pointerdown", 4);
      f.pointer(f.buttons.jump!, "pointerup", 4);
      assert.equal(pendingCommandCount(), 1);
      assert.equal(actions().jumpHeld, true);
      f.pointer(f.buttons.jump!, "lostpointercapture", 3);
      assert.equal(actions().jumpHeld, false);
    } finally { f.dispose(); }
  });

  it("a short jump released before a sim step is still consumed exactly once", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.pointer(f.buttons.jump!, "pointerdown", 3);
      f.pointer(f.buttons.jump!, "pointerup", 3);
      assert.equal(actions().jump, true);
      assert.equal(actions().jump, false);
      assert.equal(actions().moveY, 0.5);
    } finally { f.dispose(); }
  });

  it("cancel→lost→up is idempotent and cannot release a replacement owner", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.pointer(f.stick, "pointercancel", 1);
      f.pointer(f.stick, "pointerdown", 5);
      f.pointer(f.stick, "pointermove", 5, 0, -27);
      f.pointer(f.stick, "lostpointercapture", 1);
      f.pointer(f.stick, "pointerup", 1);
      assert.equal(actions().moveY, 0.5);
      assert.equal(f.stick.captured.has(5), true);
    } finally { f.dispose(); }
  });

  it("bow is a click toggle that survives pointer release, look and attack", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.pointer(f.buttons.bow!, "pointerdown", 4);
      f.pointer(f.buttons.bow!, "pointerup", 4);
      f.dispatch(f.buttons.bow!, "click", { pointerId: 4, pointerType: "touch", detail: 1 });
      f.pointer(f.look, "pointerdown", 2);
      f.pointer(f.look, "pointermove", 2, 20, 0);
      f.pointer(f.buttons.attack!, "pointerdown", 3);
      const a = actions();
      assert.equal(a.bow, true);
      assert.equal(a.lookX, 18);
      assert.equal(a.attack, true);
      assert.equal(a.moveY, 0.5);
      f.pointer(f.buttons.bow!, "pointerdown", 4);
      f.pointer(f.buttons.bow!, "pointerup", 4);
      f.dispatch(f.buttons.bow!, "click", { pointerId: 4, pointerType: "touch", detail: 1 });
      assert.equal(actions().bow, false);
    } finally { f.dispose(); }
  });

  it("a canceled bow gesture without click does not change the latch", () => {
    const f = boundFixture();
    try {
      f.pointer(f.buttons.bow!, "pointerdown", 4);
      assert.equal(actions().bow, false);
      f.pointer(f.buttons.bow!, "pointercancel", 4);
      assert.equal(actions().bow, false);
    } finally { f.dispose(); }
  });

  for (const reset of ["blur", "hidden", "world-reset"]) {
    it(`${reset} invalidates owners so old moves cannot resurrect input`, () => {
      const f = boundFixture();
      try {
        f.walk();
        f.pointer(f.look, "pointerdown", 2);
        f.pointer(f.buttons.jump!, "pointerdown", 3);
        f.pointer(f.buttons.bow!, "pointerdown", 4);
        f.pointer(f.buttons.bow!, "pointerup", 4);
        f.dispatch(f.buttons.bow!, "click", { pointerId: 4, pointerType: "touch", detail: 1 });
        if (reset === "blur") f.dispatch(f.win, "blur");
        else if (reset === "hidden") { f.doc.hidden = true; f.dispatch(f.doc, "visibilitychange"); }
        else resetInput(); // The existing public API used by pause/world changes.
        f.pointer(f.stick, "pointermove", 1, 0, -54);
        f.pointer(f.look, "pointermove", 2, 40, 40);
        const a = actions();
        assert.equal(a.moveY, 0);
        assert.equal(a.lookX, 0);
        assert.equal(a.jumpHeld, false);
        assert.equal(a.jump, false);
        assert.equal(a.bow, false);
        assert.equal(f.stick.captured.size, 0);
        assert.equal(f.look.captured.size, 0);
        f.pointer(f.stick, "pointerdown", 5);
        f.pointer(f.stick, "pointermove", 5, 0, -27);
        assert.equal(actions().moveY, 0.5);
      } finally { f.dispose(); }
    });
  }

  it("visible document events do not reset an ongoing gesture", () => {
    const f = boundFixture();
    try {
      f.walk();
      f.doc.hidden = false;
      f.dispatch(f.doc, "visibilitychange");
      assert.equal(actions().moveY, 0.5);
    } finally { f.dispose(); }
  });

  it("all button actions use the existing one-shot queue once per accepted pointer", () => {
    const f = boundFixture();
    try {
      for (const action of ["interact", "art", "climb", "attack", "dodge", "pause"] as const) {
        const button = f.buttons[action]!;
        f.pointer(button, "pointerdown", 10);
        f.pointer(button, "pointerdown", 10);
        f.pointer(button, "pointerup", 10);
        assert.equal(actions()[action], true, action);
        assert.equal(actions()[action], false, action);
      }
    } finally { f.dispose(); }
  });

  it("disposing releases only owned touch state and every listener; remount has one writer", () => {
    const f = boundFixture();
    try {
      f.dispatch(f.win, "keydown", { code: "KeyW", repeat: false });
      for (let i = 0; i < 4; i++) {
        f.pointer(f.buttons.jump!, "pointerdown", 3);
        f.unbindTouch();
        assert.equal(f.stick.listenerCount(), 0);
        assert.equal(f.look.listenerCount(), 0);
        assert.ok(Object.values(f.buttons).every((button) => button.listenerCount() === 0));
        assert.equal(actions().jumpHeld, false);
        assert.equal(actions().moveY, 1, "touch unmount must not release keyboard W");
        f.pointer(f.stick, "pointerdown", 77);
        assert.equal(f.stick.captured.size, 0);
        f.rebindTouch();
        f.pointer(f.buttons.attack!, "pointerdown", 4);
        assert.equal(pendingCommandCount(), 1);
        assert.equal(actions().attack, true);
        f.pointer(f.buttons.attack!, "pointerup", 4);
      }
    } finally { f.dispose(); }
  });

  for (const transition of ["pause", "enter-shrine", "exit-shrine"]) {
    it(`${transition} actual Sim entry invalidates pointer ownership`, () => {
      const f = boundFixture();
      try {
        const sim = new Sim(memoryStorage());
        sim.freshRuntime(false);
        if (transition === "exit-shrine") simTransitionWithoutAudio(() => sim.enterShrine(0));
        f.walk();
        f.pointer(f.buttons.jump!, "pointerdown", 3);
        if (transition === "pause") {
          f.pointer(f.buttons.pause!, "pointerdown", 4);
          sim.step(1 / 60, actions());
          assert.equal(sim.mode, "paused");
        } else if (transition === "enter-shrine") {
          simTransitionWithoutAudio(() => sim.enterShrine(0));
          assert.equal(sim.worldKind, "shrine");
        } else {
          simTransitionWithoutAudio(() => sim.exitShrine());
          assert.equal(sim.worldKind, "overworld");
        }
        f.pointer(f.stick, "pointermove", 1, 0, -54);
        const a = actions();
        assert.equal(a.moveY, 0);
        assert.equal(a.jumpHeld, false);
        assert.equal(a.jump, false);
      } finally { f.dispose(); }
    });
  }

  it("actual resize listener clears owners on portrait pause and does not revive them on landscape", () => {
    const f = boundFixture();
    const view = Object.assign(f.win, { innerWidth: 1200, innerHeight: 700 });
    const presentation = { portrait: false, syncHud: () => {} };
    const unbindOrientation = bindTouchOrientation(view as unknown as Window, presentation);
    try {
      f.walk();
      view.innerWidth = 700;
      view.innerHeight = 1200;
      f.dispatch(view, "resize");
      assert.equal(presentation.portrait, true);
      f.pointer(f.stick, "pointermove", 1, 0, -54);
      assert.equal(actions().moveY, 0);
      view.innerWidth = 1200;
      view.innerHeight = 700;
      f.dispatch(view, "resize");
      assert.equal(presentation.portrait, false);
      f.pointer(f.stick, "pointermove", 1, 0, -27);
      assert.equal(actions().moveY, 0);
      f.pointer(f.stick, "pointerdown", 5);
      f.pointer(f.stick, "pointermove", 5, 0, -27);
      assert.equal(actions().moveY, 0.5);
      unbindOrientation();
      view.innerHeight = 1800;
      f.dispatch(view, "resize");
      assert.equal(presentation.portrait, false, "disposed orientation callback must be removed");
    } finally { unbindOrientation(); f.dispose(); }
  });

  it("landscape resize leaves active touch input bound and uninterrupted", () => {
    const f = boundFixture();
    const view = Object.assign(f.win, { innerWidth: 1200, innerHeight: 500 });
    const presentation = { portrait: false, syncHud: () => {} };
    const unbindOrientation = bindTouchOrientation(view as unknown as Window, presentation);
    try {
      f.walk();
      view.innerWidth = 700;
      f.dispatch(view, "resize");
      assert.equal(presentation.portrait, false);
      assert.equal(actions().moveY, 0.5);
    } finally { unbindOrientation(); f.dispose(); }
  });
});

describe("P1-1 bow activation provenance through production listeners", () => {
  const pointerClick = (f: ReturnType<typeof boundFixture>, pointerId = 4, detail = 1, pointerType = "touch") =>
    f.dispatch(f.buttons.bow!, "click", { pointerId, pointerType, detail });
  const releaseBow = (f: ReturnType<typeof boundFixture>, pointerId = 4) => {
    f.pointer(f.buttons.bow!, "pointerdown", pointerId);
    f.pointer(f.buttons.bow!, "pointerup", pointerId);
  };
  const key = (f: ReturnType<typeof boundFixture>, type: string, code: string, repeat = false) =>
    f.dispatch(f.buttons.bow!, type, { code, key: code === "Space" ? " " : "Enter", repeat });
  const keyClick = (f: ReturnType<typeof boundFixture>, pointerFields = true) =>
    f.dispatch(f.buttons.bow!, "click", pointerFields ? { detail: 0, pointerId: -1, pointerType: "" } : { detail: 0 });

  it("normal pointerup→lostcapture→click consumes one valid release, not repeated clicks", () => {
    const f = boundFixture();
    try {
      f.walk();
      releaseBow(f);
      f.pointer(f.buttons.bow!, "lostpointercapture", 4);
      pointerClick(f);
      assert.equal(actions().bow, true);
      pointerClick(f);
      assert.equal(actions().bow, true, "repeat click cannot consume a release twice");
      assert.equal(actions().moveY, 0.5);
      releaseBow(f);
      pointerClick(f);
      assert.equal(actions().bow, false, "a fresh gesture can toggle again");
    } finally { f.dispose(); }
  });

  for (const stage of ["held", "released"]) {
    for (const reset of ["reset", "pause", "hidden", "blur"]) {
      it(`${reset} after bow ${stage} rejects that old gesture's click`, () => {
        const f = boundFixture();
        try {
          const sim = new Sim(memoryStorage());
          sim.freshRuntime(false);
          f.pointer(f.buttons.bow!, "pointerdown", 4);
          if (stage === "released") f.pointer(f.buttons.bow!, "pointerup", 4);
          if (reset === "pause") {
            f.pointer(f.buttons.pause!, "pointerdown", 5);
            sim.step(1 / 60, actions());
            assert.equal(sim.mode, "paused");
          } else if (reset === "hidden") {
            f.doc.hidden = true;
            f.dispatch(f.doc, "visibilitychange");
          } else if (reset === "blur") f.dispatch(f.win, "blur");
          else resetInput();
          f.pointer(f.buttons.bow!, "pointerup", 4);
          pointerClick(f);
          assert.equal(actions().bow, false);
          releaseBow(f, 8);
          pointerClick(f, 8);
          assert.equal(actions().bow, true, "fresh gestures remain usable after reset");
        } finally { f.dispose(); }
      });
    }
  }

  for (const afterUp of [false, true]) {
    it(`cancel ${afterUp ? "after" : "before"} pointerup invalidates the delayed click`, () => {
      const f = boundFixture();
      try {
        f.pointer(f.buttons.bow!, "pointerdown", 4);
        if (afterUp) f.pointer(f.buttons.bow!, "pointerup", 4);
        f.pointer(f.buttons.bow!, "pointercancel", 4);
        f.pointer(f.buttons.bow!, "pointerup", 4);
        pointerClick(f);
        assert.equal(actions().bow, false);
      } finally { f.dispose(); }
    });
  }

  it("lost capture before pointerup cancels the gesture", () => {
    const f = boundFixture();
    try {
      f.pointer(f.buttons.bow!, "pointerdown", 4);
      f.pointer(f.buttons.bow!, "lostpointercapture", 4);
      f.pointer(f.buttons.bow!, "pointerup", 4);
      pointerClick(f);
      assert.equal(actions().bow, false);
    } finally { f.dispose(); }
  });

  it("first bow pointer owns the button; wrong identity cannot use or consume its token", () => {
    const f = boundFixture();
    try {
      f.pointer(f.buttons.bow!, "pointerdown", 4);
      assert.equal(f.buttons.bow!.captured.has(4), true);
      f.pointer(f.buttons.bow!, "pointerdown", 9);
      f.pointer(f.buttons.bow!, "pointerup", 9);
      pointerClick(f, 9);
      assert.equal(actions().bow, false);
      f.pointer(f.buttons.bow!, "pointerup", 4);
      pointerClick(f, 4, 1, "mouse");
      pointerClick(f, 9);
      assert.equal(actions().bow, false);
      pointerClick(f, 4);
      assert.equal(actions().bow, true);
    } finally { f.dispose(); }
  });

  it("a stick pointer cannot acquire bow ownership", () => {
    const f = boundFixture();
    try {
      f.walk();
      releaseBow(f, 1);
      pointerClick(f, 1);
      assert.equal(actions().bow, false);
      assert.equal(actions().moveY, 0.5);
    } finally { f.dispose(); }
  });

  it("dispose/remount invalidates released and held old gestures", () => {
    const f = boundFixture();
    try {
      releaseBow(f);
      f.unbindTouch();
      f.rebindTouch();
      pointerClick(f);
      assert.equal(actions().bow, false);
      f.pointer(f.buttons.bow!, "pointerdown", 5);
      f.unbindTouch();
      f.rebindTouch();
      f.pointer(f.buttons.bow!, "pointerup", 5);
      pointerClick(f, 5);
      assert.equal(actions().bow, false);
    } finally { f.dispose(); }
  });

  for (const pointerFields of [true, false]) {
    for (const code of ["Space", "Enter"]) {
      it(`${code} activation supports ${pointerFields ? "non-pointer PointerEvent" : "legacy MouseEvent"} click without gameplay jump`, () => {
        const f = boundFixture();
        try {
          key(f, "keydown", code);
          if (code === "Space") key(f, "keyup", code);
          keyClick(f, pointerFields);
          const first = actions();
          assert.equal(first.bow, true);
          assert.equal(first.jump, false, "focused bow Space must not enqueue gameplay jump");
          assert.equal(pendingCommandCount(), 0);
          if (!pointerFields) {
            keyClick(f, false);
            assert.equal(actions().bow, true, "ambiguous legacy click needs a fresh keyboard token");
          }
          if (code === "Enter") key(f, "keyup", code);
          key(f, "keydown", code);
          if (code === "Space") key(f, "keyup", code);
          keyClick(f, pointerFields);
          assert.equal(actions().bow, false);
        } finally { f.dispose(); }
      });
    }
  }

  it("detail zero alone cannot revive a reset pointer gesture or bypass keyboard provenance", () => {
    const f = boundFixture();
    try {
      f.pointer(f.buttons.bow!, "pointerdown", 4);
      resetInput();
      f.pointer(f.buttons.bow!, "pointerup", 4);
      pointerClick(f, 4, 0);
      assert.equal(actions().bow, false);
      keyClick(f, false);
      assert.equal(actions().bow, false);
      key(f, "keydown", "Enter");
      pointerClick(f, 4, 0);
      assert.equal(actions().bow, false, "pointer identity cannot consume a keyboard token");
      keyClick(f, false);
      assert.equal(actions().bow, true);
    } finally { f.dispose(); }
  });

  it("reset cancels held Space and ready Enter keyboard activation tokens", () => {
    const f = boundFixture();
    try {
      key(f, "keydown", "Space");
      resetInput();
      key(f, "keyup", "Space");
      keyClick(f, false);
      assert.equal(actions().bow, false);
      key(f, "keydown", "Enter");
      resetInput();
      keyClick(f, false);
      assert.equal(actions().bow, false);
    } finally { f.dispose(); }
  });

  it("Space requires matching keyup; keyboard repeat and button blur do not activate", () => {
    const f = boundFixture();
    try {
      key(f, "keydown", "Space");
      keyClick(f, false);
      assert.equal(actions().bow, false);
      key(f, "keyup", "Space");
      keyClick(f, false);
      assert.equal(actions().bow, true);
      key(f, "keydown", "Enter");
      keyClick(f, false);
      assert.equal(actions().bow, false);
      assert.equal(key(f, "keydown", "Enter", true).defaultPrevented, true);
      keyClick(f, false);
      assert.equal(actions().bow, false);
      key(f, "keyup", "Enter");
      key(f, "keydown", "Space");
      f.dispatch(f.buttons.bow!, "blur");
      key(f, "keyup", "Space");
      keyClick(f, false);
      assert.equal(actions().bow, false);
    } finally { f.dispose(); }
  });

  for (const cancel of ["reset", "repeated reset", "pause", "hidden", "button blur"]) {
    it(`${cancel} cancels the native default of a known held Space release while retaining direct AT activation`, () => {
      const f = boundFixture();
      try {
        key(f, "keydown", "Space");
        if (cancel === "pause") {
          const sim = new Sim(memoryStorage());
          sim.mode = "playing";
          f.pointer(f.buttons.pause!, "pointerdown", 5);
          sim.step(1 / 60, actions());
          assert.equal(sim.mode, "paused");
        } else if (cancel === "hidden") {
          f.doc.hidden = true;
          f.dispatch(f.doc, "visibilitychange");
        } else if (cancel === "button blur") {
          f.dispatch(f.buttons.bow!, "blur");
        } else {
          resetInput();
          if (cancel === "repeated reset") resetInput();
        }
        const release = key(f, "keyup", "Space");
        assert.equal(release.defaultPrevented, true, "cancelled held Space must suppress its native click default");
        // Model the native default only when permitted. Force-dispatching a
        // click after a prevented default would not prove native generation.
        if (!release.defaultPrevented) keyClick(f);
        assert.equal(actions().bow, false);
        keyClick(f);
        assert.equal(actions().bow, true, "independent AT activation remains available");
        key(f, "keydown", "Space");
        const freshRelease = key(f, "keyup", "Space");
        assert.equal(freshRelease.defaultPrevented, false);
        if (!freshRelease.defaultPrevented) keyClick(f);
        assert.equal(actions().bow, false, "a new Space gesture still activates normally");
      } finally { f.dispose(); }
    });
  }

  it("explicit standard non-pointer activation remains accessible without physical key events", () => {
    const f = boundFixture();
    try {
      keyClick(f);
      assert.equal(actions().bow, true);
      resetInput();
      keyClick(f);
      assert.equal(actions().bow, true, "fresh AT activation is not a stale pointer gesture");
      keyClick(f);
      assert.equal(actions().bow, false);
      f.dispatch(f.buttons.bow!, "click", { pointerId: -1, pointerType: "touch", detail: 0 });
      assert.equal(actions().bow, false, "mixed pointer identity is not non-pointer activation");
    } finally { f.dispose(); }
  });
});
