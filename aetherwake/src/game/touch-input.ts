import { enqueueCommand, resetInput, subscribeInputReset, touch } from "./input.ts";
import type { CommandKind } from "./input.ts";

const BUTTON_COMMANDS: Readonly<Record<string, CommandKind>> = {
  interact: "interact",
  art: "art",
  climb: "climb",
  jump: "jump",
  attack: "attack",
  dodge: "dodge",
  pause: "pause",
};

type PointerOwner = { element: HTMLElement; kind: string; pointerId: number; pointerType: string; x: number; y: number };
type ActivationKey = "Space" | "Enter";
type BowActivation = {
  releasedPointer: { pointerId: number; pointerType: string } | null;
  keyDown: ActivationKey | null;
  keyReady: boolean;
  cancelledSpaceRelease: boolean;
};

/** The same resize listener used by GameClient's portrait pause presentation. */
export function bindTouchOrientation(view: Window, presentation: { portrait: boolean; syncHud: () => void }) {
  const orient = () => {
    const portrait = view.innerHeight > view.innerWidth + 40;
    if (portrait && !presentation.portrait) resetInput();
    presentation.portrait = portrait;
    presentation.syncHud();
  };
  orient();
  view.addEventListener("resize", orient);
  return () => view.removeEventListener("resize", orient);
}

/**
 * Actual TouchPad DOM bindings. The first pointer owns a control until release;
 * another pointer cannot overwrite it. Commands use the existing input queue.
 * CSS controls visibility, so resizing never reveals unbound controls.
 */
export function bindTouchInput({ stick, look, buttons }: { stick: HTMLElement; look: HTMLElement; buttons: Iterable<HTMLElement> }) {
  const pointers = new Map<number, PointerOwner>();
  const controls = new Map<HTMLElement, number>();
  const bowActivations = new Map<HTMLElement, BowActivation>();
  const removeListeners: Array<() => void> = [];
  let disposed = false;

  const releaseOwner = (owner: PointerOwner) => {
    // Invalidate first: releasing capture can itself dispatch a lost event.
    pointers.delete(owner.pointerId);
    controls.delete(owner.element);
    if (owner.kind === "stick") {
      touch.stickX = 0;
      touch.stickY = 0;
    } else if (owner.kind === "jump") touch.jump = false;
    try { owner.element.releasePointerCapture(owner.pointerId); } catch { /* capture already ended */ }
  };

  const clearOwnedTouch = () => {
    for (const activation of bowActivations.values()) {
      activation.releasedPointer = null;
      if (activation.keyDown === "Space") activation.cancelledSpaceRelease = true;
      activation.keyDown = null;
      activation.keyReady = false;
    }
    for (const owner of [...pointers.values()]) releaseOwner(owner);
    touch.stickX = 0;
    touch.stickY = 0;
    touch.lookX = 0;
    touch.lookY = 0;
    touch.jump = false;
    touch.bow = false;
  };
  const unsubscribeReset = subscribeInputReset(clearOwnedTouch);

  const release = (e: PointerEvent) => {
    const activation = bowActivations.get(e.currentTarget as HTMLElement);
    if (e.type === "pointercancel" && activation?.releasedPointer?.pointerId === e.pointerId) {
      activation.releasedPointer = null;
    }
    const owner = pointers.get(e.pointerId);
    if (!owner || owner.element !== e.currentTarget) return;
    if (activation) {
      activation.releasedPointer = e.type === "pointerup"
        ? { pointerId: owner.pointerId, pointerType: owner.pointerType }
        : null;
    }
    // The owner's normal pointerup creates its token before releasing capture.
    // A subsequent lostpointercapture has no owner and must retain that token.
    releaseOwner(owner);
  };

  const move = (e: PointerEvent) => {
    const owner = pointers.get(e.pointerId);
    if (!owner || owner.element !== e.currentTarget) return;
    const dx = e.clientX - owner.x;
    const dy = e.clientY - owner.y;
    if (owner.kind === "stick") {
      let x = dx / 54;
      let y = -dy / 54;
      const magnitude = Math.hypot(x, y);
      if (magnitude > 1) {
        x /= magnitude;
        y /= magnitude;
      }
      touch.stickX = x;
      touch.stickY = y;
    } else if (owner.kind === "look") {
      touch.lookX += dx * 0.9;
      touch.lookY += dy * 0.9;
      owner.x = e.clientX;
      owner.y = e.clientY;
    }
  };

  const bindControl = (element: HTMLElement, kind: string) => {
    const command = BUTTON_COMMANDS[kind];
    const down = (e: PointerEvent) => {
      if (command || kind === "bow") e.stopPropagation();
      else if ((e.target as HTMLElement).closest("[data-touch-btn]")) return;
      if (disposed || pointers.has(e.pointerId) || controls.has(element)) return;
      const activation = bowActivations.get(element);
      if (activation?.keyDown) return;
      try { element.setPointerCapture(e.pointerId); } catch { return; }
      if (activation) {
        activation.releasedPointer = null;
        activation.keyReady = false;
      }
      pointers.set(e.pointerId, { element, kind, pointerId: e.pointerId, pointerType: e.pointerType, x: e.clientX, y: e.clientY });
      controls.set(element, e.pointerId);
      if (kind === "jump") touch.jump = true;
      if (command) enqueueCommand(command);
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
    element.addEventListener("lostpointercapture", release);
    removeListeners.push(() => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", release);
      element.removeEventListener("pointercancel", release);
      element.removeEventListener("lostpointercapture", release);
    });
  };

  bindControl(stick, "stick");
  bindControl(look, "look");
  for (const button of buttons) {
    const action = button.dataset.touchAction;
    if (action === "bow") {
      const activation: BowActivation = { releasedPointer: null, keyDown: null, keyReady: false, cancelledSpaceRelease: false };
      bowActivations.set(button, activation);
      bindControl(button, "bow");
      const activationKey = (e: KeyboardEvent): ActivationKey | null =>
        e.code === "Space" || e.key === " " ? "Space" : e.key === "Enter" || e.code === "Enter" ? "Enter" : null;
      const keydown = (e: KeyboardEvent) => {
        const key = activationKey(e);
        if (!key) return;
        // Retain the native button default action, but do not also enqueue a
        // gameplay Space jump through the window listener.
        e.stopPropagation();
        if (e.repeat || activation.keyDown || controls.has(button)) {
          e.preventDefault();
          return;
        }
        activation.releasedPointer = null;
        if (key === "Space") activation.cancelledSpaceRelease = false;
        activation.keyDown = key;
        activation.keyReady = key === "Enter";
      };
      const keyup = (e: KeyboardEvent) => {
        const key = activationKey(e);
        if (key === "Space" && activation.cancelledSpaceRelease) {
          // Cancel the known old gesture's native button default, without
          // suppressing unrelated assistive-technology click activations.
          e.preventDefault();
          activation.cancelledSpaceRelease = false;
          return;
        }
        if (!key || activation.keyDown !== key) return;
        activation.keyDown = null;
        // Space activates a native button on release; Enter already activated
        // on keydown. An unconsumed Enter token expires at keyup.
        activation.keyReady = key === "Space";
      };
      const blur = () => {
        if (activation.keyDown === "Space") activation.cancelledSpaceRelease = true;
        activation.keyDown = null;
        activation.keyReady = false;
      };
      const click = (e: MouseEvent) => {
        e.stopPropagation();
        const pe = e as PointerEvent;
        const hasPointerFields = "pointerId" in e || "pointerType" in e;
        if (hasPointerFields && !(pe.pointerId === -1 && pe.pointerType === "" && e.detail === 0)) {
          const released = activation.releasedPointer;
          if (!released || released.pointerId !== pe.pointerId || released.pointerType !== pe.pointerType) return;
          activation.releasedPointer = null;
        } else if (hasPointerFields) {
          // Standard non-pointer identity includes direct assistive-technology
          // activation, which need not produce physical key events.
          activation.keyReady = false;
        } else {
          // Legacy MouseEvent detail=0 is ambiguous. Only a fresh keyboard
          // activation on this button can authorize it; detail alone cannot.
          if (e.detail !== 0 || !activation.keyReady) return;
          activation.keyReady = false;
        }
        touch.bow = !touch.bow;
      };
      button.addEventListener("keydown", keydown);
      button.addEventListener("keyup", keyup);
      button.addEventListener("blur", blur);
      button.addEventListener("click", click);
      removeListeners.push(() => {
        button.removeEventListener("keydown", keydown);
        button.removeEventListener("keyup", keyup);
        button.removeEventListener("blur", blur);
        button.removeEventListener("click", click);
      });
    } else if (action && BUTTON_COMMANDS[action]) bindControl(button, action);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeReset();
    for (const remove of removeListeners) remove();
    clearOwnedTouch();
  };
}
