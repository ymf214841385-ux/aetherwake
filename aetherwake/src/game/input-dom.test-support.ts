/**
 * Node EventTarget adapter for production listener tests. It dispatches through
 * actual addEventListener registrations; capture release/bubbling are explicit
 * fixtures, not evidence of browser capture, layout, gestures or device input.
 */
import { resetInput } from "./input.ts";

export class InputEventTarget extends EventTarget {
  private registered = new Map<string, Set<EventListenerOrEventListenerObject>>();

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (callback) {
      const set = this.registered.get(type) ?? new Set();
      set.add(callback);
      this.registered.set(type, set);
    }
    super.addEventListener(type, callback, options);
  }

  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (callback) this.registered.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }

  listenerCount() {
    return [...this.registered.values()].reduce((count, set) => count + set.size, 0);
  }
}

export class InputElement extends InputEventTarget {
  dataset: Record<string, string> = {};
  captured = new Set<number>();
  failCapture = false;
  onRelease: ((pointerId: number) => void) | undefined;

  closest(selector: string) {
    return this.dataset.touchAction && (selector.includes("button") || selector.includes("data-touch-btn")) ? this : null;
  }

  setPointerCapture(pointerId: number) {
    if (this.failCapture) throw new Error("capture fixture rejected pointer");
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId: number) {
    if (this.captured.delete(pointerId)) this.onRelease?.(pointerId);
  }

  hasPointerCapture(pointerId: number) {
    return this.captured.has(pointerId);
  }

  asElement() {
    return this as unknown as HTMLElement;
  }
}

export function inputDomFixture() {
  const win = new InputEventTarget();
  const doc = Object.assign(new InputEventTarget(), { hidden: false, pointerLockElement: null });
  const canvas = new InputElement();
  const stick = new InputElement();
  const look = new InputElement();
  const buttons = Object.fromEntries(["interact", "art", "climb", "jump", "attack", "bow", "dodge", "pause"].map((action) => {
    const element = new InputElement();
    element.dataset.touchAction = action;
    return [action, element];
  })) as Record<string, InputElement>;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });

  const dispatch = (target: InputEventTarget, type: string, fields: Record<string, unknown> = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, fields);
    target.dispatchEvent(event);
    if (target !== win && target !== doc && !event.cancelBubble) win.dispatchEvent(event);
    return event;
  };
  for (const element of [canvas, stick, look, ...Object.values(buttons)]) {
    element.onRelease = (pointerId) => dispatch(element, "lostpointercapture", { pointerId, pointerType: "touch" });
  }
  const pointer = (target: InputElement, type: string, pointerId: number, x = 0, y = 0) =>
    dispatch(target, type, { pointerId, pointerType: "touch", clientX: x, clientY: y, button: 0 });
  const restore = () => {
    resetInput();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  };
  resetInput();
  return { win, doc, canvas, stick, look, buttons, dispatch, pointer, restore };
}
