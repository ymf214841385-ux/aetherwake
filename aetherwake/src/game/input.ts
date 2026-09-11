/** Device sampling, held state, and one-shot command queue. */

import { TOUCH_DEADZONE, TOUCH_SPRINT } from "./params.ts";

export type Actions = {
  moveX: number;
  moveY: number;
  jump: boolean;
  jumpHeld: boolean;
  sprint: boolean;
  attack: boolean;
  bow: boolean;
  interact: boolean;
  art: boolean;
  pause: boolean;
  map: boolean;
  bag: boolean;
  dodge: boolean;
  artSlot: number;
  lookX: number;
  lookY: number;
  climb: boolean;
};

export type CommandKind =
  | "jump"
  | "attack"
  | "interact"
  | "art"
  | "pause"
  | "map"
  | "bag"
  | "dodge"
  | "climb"
  | "artSlot";

type Command = { id: number; kind: CommandKind; t: number; slot?: number };

const hardware = new Set<string>();
let override: Set<string> | null = null;
let lookX = 0;
let lookY = 0;
let cmdSeq = 1;
const commandQueue: Command[] = [];
let prevTouchJump = false;
let prevJump = false;

export const touch = {
  stickX: 0,
  stickY: 0,
  lookX: 0,
  lookY: 0,
  jump: false,
  attack: false,
  art: false,
  interact: false,
  sprint: false,
  bow: false,
  dodge: false,
  climb: false,
  pause: false,
  map: false,
  bag: false,
};

const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "KeyE",
  "KeyF",
  "KeyQ",
  "KeyM",
  "Tab",
  "Escape",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "KeyC",
  "ControlLeft",
  "ControlRight",
]);

function activeSet() {
  return override ?? hardware;
}

function enqueue(kind: CommandKind, slot?: number) {
  commandQueue.push({ id: cmdSeq++, kind, t: now(), slot });
}

export function enqueueCommand(kind: CommandKind, slot?: number) {
  enqueue(kind, slot);
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function setKeys(codes: string[]) {
  if (codes.length === 0) {
    override = null;
    return;
  }
  override = new Set(codes);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat) {
    if (GAME_CODES.has(e.code)) e.preventDefault();
    return;
  }
  hardware.add(e.code);
  if (GAME_CODES.has(e.code)) e.preventDefault();
  if (e.code === "Space") enqueue("jump");
  if (e.code === "KeyE") enqueue("interact");
  if (e.code === "KeyF") enqueue("art");
  if (e.code === "KeyM") enqueue("map");
  if (e.code === "Tab") {
    e.preventDefault();
    enqueue("bag");
  }
  if (e.code === "Escape") enqueue("pause");
  if (e.code === "KeyC" || e.code === "ControlLeft" || e.code === "ControlRight") enqueue("dodge");
  if (e.code === "Digit1") enqueue("artSlot", 0);
  if (e.code === "Digit2") enqueue("artSlot", 1);
  if (e.code === "Digit3") enqueue("artSlot", 2);
  if (e.code === "Digit4") enqueue("artSlot", 3);
  if (e.code === "Digit5") enqueue("artSlot", 4);
}

function onKeyUp(e: KeyboardEvent) {
  hardware.delete(e.code);
}

function onMouseMove(e: MouseEvent) {
  const locked = typeof document !== "undefined" && document.pointerLockElement;
  const dragging = (e.buttons & 2) !== 0;
  if (locked || dragging) {
    lookX += e.movementX;
    lookY += e.movementY;
  }
}

function onMouseDown(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (t?.closest?.("button, a, input, textarea, [data-ui]")) return;
  if (e.button === 0) enqueue("attack");
  if (e.button === 2) hardware.add("MouseRight");
}

function onMouseUp(e: MouseEvent) {
  if (e.button === 2) hardware.delete("MouseRight");
}

function onLostPointer() {
  resetHeld();
}

export function resetInput() {
  hardware.clear();
  commandQueue.length = 0;
  lookX = 0;
  lookY = 0;
  prevJump = false;
  prevTouchJump = false;
  touch.stickX = 0;
  touch.stickY = 0;
  touch.lookX = 0;
  touch.lookY = 0;
  touch.jump = false;
  touch.attack = false;
  touch.art = false;
  touch.interact = false;
  touch.sprint = false;
  touch.bow = false;
  touch.dodge = false;
  touch.climb = false;
  touch.pause = false;
  touch.map = false;
  touch.bag = false;
}

function resetHeld() {
  hardware.clear();
  touch.stickX = 0;
  touch.stickY = 0;
  touch.jump = false;
  touch.sprint = false;
  touch.bow = false;
  lookX = 0;
  lookY = 0;
  touch.lookX = 0;
  touch.lookY = 0;
  commandQueue.length = 0;
}

export function bindInput(el: HTMLElement) {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", resetInput);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetInput();
  });
  window.addEventListener("mousemove", onMouseMove);
  el.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("pointercancel", onLostPointer);
  window.addEventListener("lostpointercapture", onLostPointer);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", resetInput);
    window.removeEventListener("mousemove", onMouseMove);
    el.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("pointercancel", onLostPointer);
    window.removeEventListener("lostpointercapture", onLostPointer);
  };
}

function keyboardMove(keys: Set<string>) {
  let x = 0;
  let y = 0;
  if (keys.has("KeyA")) x -= 1;
  if (keys.has("KeyD")) x += 1;
  if (keys.has("KeyW")) y += 1;
  if (keys.has("KeyS")) y -= 1;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return { x, y, sprint: keys.has("ShiftLeft") || keys.has("ShiftRight") };
}

function touchMove() {
  let x = touch.stickX;
  let y = touch.stickY;
  const m = Math.hypot(x, y);
  if (m < TOUCH_DEADZONE) return { x: 0, y: 0, sprint: false, mag: 0 };
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return { x, y, sprint: touch.sprint || m > TOUCH_SPRINT, mag: m };
}

function drainCommands(into: Actions) {
  const used = new Set<CommandKind>();
  const keep: Command[] = [];
  for (const c of commandQueue) {
    if (used.has(c.kind)) {
      keep.push(c);
      continue;
    }
    used.add(c.kind);
    if (c.kind === "jump") into.jump = true;
    else if (c.kind === "attack") into.attack = true;
    else if (c.kind === "interact") into.interact = true;
    else if (c.kind === "art") into.art = true;
    else if (c.kind === "pause") into.pause = true;
    else if (c.kind === "map") into.map = true;
    else if (c.kind === "bag") into.bag = true;
    else if (c.kind === "dodge") into.dodge = true;
    else if (c.kind === "climb") into.climb = true;
    else if (c.kind === "artSlot" && c.slot != null) into.artSlot = c.slot;
  }
  commandQueue.length = 0;
  commandQueue.push(...keep);
}

function consumeTouchEdges(into: Actions) {
  if (touch.attack) {
    into.attack = true;
    touch.attack = false;
  }
  if (touch.interact) {
    into.interact = true;
    touch.interact = false;
  }
  if (touch.art) {
    into.art = true;
    touch.art = false;
  }
  if (touch.dodge) {
    into.dodge = true;
    touch.dodge = false;
  }
  if (touch.climb) {
    into.climb = true;
    touch.climb = false;
  }
  if (touch.pause) {
    into.pause = true;
    touch.pause = false;
  }
  if (touch.map) {
    into.map = true;
    touch.map = false;
  }
  if (touch.bag) {
    into.bag = true;
    touch.bag = false;
  }
  const jumpEdge = touch.jump && !prevTouchJump;
  prevTouchJump = touch.jump;
  if (jumpEdge) into.jump = true;
}

function heldBase(): Actions {
  const keys = activeSet();
  const kb = keyboardMove(keys);
  const tc = touchMove();
  let x = kb.x + tc.x;
  let y = kb.y + tc.y;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  const jumpHeld = keys.has("Space") || touch.jump;
  const sprint = kb.sprint || tc.sprint;
  const bow = keys.has("MouseRight") || keys.has("KeyQ") || touch.bow;
  return {
    moveX: x,
    moveY: y,
    jump: false,
    jumpHeld,
    sprint,
    attack: false,
    bow,
    interact: false,
    art: false,
    pause: false,
    map: false,
    bag: false,
    dodge: false,
    climb: false,
    artSlot: -1,
    lookX: 0,
    lookY: 0,
  };
}

export function peekHeld(): Actions {
  return heldBase();
}

export function takeSimActions(opts: { consumeCommands: boolean; consumeLook: boolean }): Actions {
  const a = heldBase();
  if (opts.consumeCommands) {
    drainCommands(a);
    consumeTouchEdges(a);
  }
  if (opts.consumeLook) {
    const keys = activeSet();
    let arrowX = 0;
    let arrowY = 0;
    if (keys.has("ArrowLeft")) arrowX -= 22;
    if (keys.has("ArrowRight")) arrowX += 22;
    if (keys.has("ArrowUp")) arrowY -= 14;
    if (keys.has("ArrowDown")) arrowY += 14;
    a.lookX = lookX + touch.lookX + arrowX;
    a.lookY = lookY + touch.lookY + arrowY;
    lookX = 0;
    lookY = 0;
    touch.lookX = 0;
    touch.lookY = 0;
  }
  return a;
}

/** Legacy helper used by tests and any leftover callers. Consumes one-shots. */
export function sampleActions(): Actions {
  return takeSimActions({ consumeCommands: true, consumeLook: true });
}

export function pendingCommandCount() {
  return commandQueue.length;
}

export function injectLookForTest(x: number, y: number) {
  lookX += x;
  lookY += y;
}

export function pressKeyForTest(code: string) {
  hardware.add(code);
  if (code === "Space") enqueue("jump");
  if (code === "KeyE") enqueue("interact");
  if (code === "KeyF") enqueue("art");
  if (code === "Escape") enqueue("pause");
  if (code === "Digit1") enqueue("artSlot", 0);
  if (code === "Digit2") enqueue("artSlot", 1);
  if (code === "Digit3") enqueue("artSlot", 2);
  if (code === "Digit4") enqueue("artSlot", 3);
  if (code === "Digit5") enqueue("artSlot", 4);
}

export function releaseKeyForTest(code: string) {
  hardware.delete(code);
}

export function hasOverride() {
  return override !== null;
}
